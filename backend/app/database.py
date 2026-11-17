"""PostgreSQL persistence for managed Y700: metadata + original DICOM chunks.

The Y700 manager currently cannot mount persistent application volumes, so originals
are durably stored in the already running PostgreSQL instance. Cached volumes in
/app/data are regenerable. Large deployments should migrate binary assets to a
persistent filesystem or object storage, keeping only metadata in PostgreSQL.
"""
import hashlib
import json
import os
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

CHUNK_SIZE = 4 * 1024 * 1024


def enabled():
    return bool(os.environ.get("DATABASE_URL"))


def connect():
    uri = os.environ["DATABASE_URL"].strip().replace("postgresql+psycopg://", "postgresql://", 1)
    return psycopg.connect(uri, connect_timeout=12)


def initialize():
    if not enabled():
        return
    with connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rm_studies (
                id UUID PRIMARY KEY,
                payload JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rm_assets (
                study_id UUID NOT NULL REFERENCES rm_studies(id) ON DELETE CASCADE,
                file_key TEXT NOT NULL,
                size_bytes BIGINT NOT NULL,
                sha256 TEXT NOT NULL,
                PRIMARY KEY(study_id,file_key)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rm_asset_chunks (
                study_id UUID NOT NULL,
                file_key TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                data BYTEA NOT NULL,
                PRIMARY KEY(study_id,file_key,ordinal),
                FOREIGN KEY(study_id,file_key)
                    REFERENCES rm_assets(study_id,file_key) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rm_annotations (
                id UUID PRIMARY KEY,
                study_id UUID NOT NULL REFERENCES rm_studies(id) ON DELETE CASCADE,
                series_id UUID NOT NULL,
                category TEXT NOT NULL,
                label TEXT NOT NULL,
                color TEXT NOT NULL,
                radius_mm REAL NOT NULL,
                x_mm REAL NOT NULL,
                y_mm REAL NOT NULL,
                z_mm REAL NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS rm_annotations_study_idx ON rm_annotations(study_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rm_masks (
                id UUID PRIMARY KEY,
                study_id UUID NOT NULL REFERENCES rm_studies(id) ON DELETE CASCADE,
                series_id UUID NOT NULL,
                label TEXT NOT NULL,
                category TEXT NOT NULL,
                color TEXT NOT NULL,
                meta JSONB NOT NULL,
                preview_zlib BYTEA NOT NULL,
                source_file BYTEA NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS rm_masks_study_idx ON rm_masks(study_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rm_report_analysis (
                study_id UUID PRIMARY KEY REFERENCES rm_studies(id) ON DELETE CASCADE,
                result JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)


def persist(study_id: str, payload: dict, root: Path):
    if not enabled():
        return
    with connect() as conn:
        conn.execute(
            "INSERT INTO rm_studies (id,payload) VALUES (%s,%s)",
            (study_id, Jsonb(payload)),
        )
        source_files = sorted((root / "dicom").glob("*.dcm"))
        if payload.get("has_report"):
            source_files.append(root / "report.pdf")
        for source in source_files:
            key = "report.pdf" if source.name == "report.pdf" else "dicom/" + source.name
            # SHA / size in the manifest allows exact integrity checks on rehydration.
            h = hashlib.sha256()
            size = 0
            with source.open("rb") as fh:
                while chunk := fh.read(CHUNK_SIZE):
                    h.update(chunk)
                    size += len(chunk)
            conn.execute(
                "INSERT INTO rm_assets(study_id,file_key,size_bytes,sha256) VALUES (%s,%s,%s,%s)",
                (study_id,key,size,h.hexdigest()),
            )
            with source.open("rb") as fh:
                ordinal = 0
                while chunk := fh.read(CHUNK_SIZE):
                    conn.execute(
                        "INSERT INTO rm_asset_chunks(study_id,file_key,ordinal,data) VALUES (%s,%s,%s,%s)",
                        (study_id,key,ordinal,chunk),
                    )
                    ordinal += 1


def list_payloads():
    if not enabled():
        return None
    with connect() as conn:
        rows = conn.execute(
            "SELECT payload FROM rm_studies ORDER BY created_at DESC"
        ).fetchall()
        return [row[0] for row in rows]


def restore(study_id: str, root: Path):
    """Restore files only when the local Docker cache is missing."""
    if not enabled():
        return False
    with connect() as conn:
        row = conn.execute(
            "SELECT payload FROM rm_studies WHERE id=%s", (study_id,)
        ).fetchone()
        if not row:
            return False
        payload = row[0]
        (root / "dicom").mkdir(parents=True, exist_ok=True)
        assets = conn.execute(
            "SELECT file_key,size_bytes,sha256 FROM rm_assets WHERE study_id=%s",
            (study_id,),
        ).fetchall()
        for key,size,sha in assets:
            # Restore only canonical internal paths, never caller-provided filenames.
            if key == "report.pdf":
                destination = root / "report.pdf"
            elif key.startswith("dicom/"):
                name = key[len("dicom/"):]
                from uuid import UUID
                try:
                    if not name.endswith(".dcm"):
                        return False
                    UUID(name[:-4])
                except ValueError:
                    return False
                destination = root / "dicom" / name
            else:
                return False
            temp = destination.with_name(destination.name + ".part")
            h = hashlib.sha256()
            count = 0
            with temp.open("wb") as output:
                for ordinal,content in conn.execute(
                    "SELECT ordinal,data FROM rm_asset_chunks "
                    "WHERE study_id=%s AND file_key=%s ORDER BY ordinal",
                    (study_id,key),
                ):
                    if ordinal * CHUNK_SIZE != count:
                        raise ValueError("Faltan fragmentos en el archivo médico")
                    output.write(content)
                    h.update(content)
                    count += len(content)
            if count != size or h.hexdigest() != sha:
                temp.unlink(missing_ok=True)
                raise ValueError("Falló la verificación SHA256 de un DICOM")
            temp.replace(destination)
        marker = root / "study.json"
        tmp = root / "study.json.part"
        tmp.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
        tmp.replace(marker)
    return True


def delete(study_id: str):
    if not enabled():
        return
    with connect() as conn:
        conn.execute("DELETE FROM rm_studies WHERE id=%s",(study_id,))


def replace_report(study_id: str, content: bytes):
    """Atomically replace the private PDF and its analysis without touching DICOMs."""
    from pathlib import Path
    import io
    import uuid
    from fastapi import HTTPException

    try:
        uuid.UUID(study_id)
    except (ValueError, TypeError):
        raise HTTPException(404,"Estudio no encontrado")
    with connect() as conn:
        found=conn.execute(
            "SELECT payload FROM rm_studies WHERE id=%s FOR UPDATE",(study_id,)
        ).fetchone()
        if not found:
            raise HTTPException(404,"Estudio no encontrado")
        payload=found[0]
        payload["has_report"]=True
        conn.execute(
            "UPDATE rm_studies SET payload=%s WHERE id=%s",
            (Jsonb(payload),study_id)
        )
        conn.execute(
            "DELETE FROM rm_assets WHERE study_id=%s AND file_key='report.pdf'",
            (study_id,),
        )
        conn.execute(
            """INSERT INTO rm_assets(study_id,file_key,size_bytes,sha256)
               VALUES(%s,'report.pdf',%s,%s)""",
            (study_id,len(content),hashlib.sha256(content).hexdigest()),
        )
        for index,offset in enumerate(range(0,len(content),CHUNK_SIZE)):
            conn.execute(
                """INSERT INTO rm_asset_chunks(study_id,file_key,ordinal,data)
                   VALUES(%s,'report.pdf',%s,%s)""",
                (study_id,index,content[offset:offset+CHUNK_SIZE]),
            )
        conn.execute(
            "DELETE FROM rm_report_analysis WHERE study_id=%s",(study_id,)
        )
