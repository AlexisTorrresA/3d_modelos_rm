"""Local-only study storage. Never send identifiable clinical data to GitHub."""
import json
import os
import re
import shutil
import stat
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data")).resolve()
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "1024")) * 1024 * 1024
MAX_EXPANDED_BYTES = int(os.environ.get("MAX_EXPANDED_MB", "3072")) * 1024 * 1024
MAX_REPORT_BYTES = 25 * 1024 * 1024
MAX_FILES = 10000
CHUNK = 1024 * 1024


def study_path(study_id: str) -> Path:
    try:
        parsed = uuid.UUID(study_id)
    except (ValueError, AttributeError):
        raise HTTPException(404, "Estudio no encontrado")
    return DATA_DIR / "studies" / str(parsed)


def load_study(study_id: str) -> dict:
    path = study_path(study_id) / "study.json"
    if not path.is_file():
        raise HTTPException(404, "Estudio no encontrado")
    return json.loads(path.read_text(encoding="utf-8"))


def save_study(study_id: str, payload: dict) -> None:
    path = study_path(study_id) / "study.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def list_studies() -> list[dict]:
    base = DATA_DIR / "studies"
    if not base.exists():
        return []
    records = []
    for path in base.glob("*/study.json"):
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
            records.append(public_study(obj))
        except (OSError, ValueError, KeyError):
            continue
    return sorted(records, key=lambda item: item["created_at"], reverse=True)


def public_study(obj: dict) -> dict:
    return {
        "id": obj["id"],
        "created_at": obj["created_at"],
        "series_count": len(obj.get("series", [])),
        "file_count": obj.get("file_count", 0),
        "has_report": obj.get("has_report", False),
        "series": [
            {
                "id": s["id"], "description": s["description"], "number": s["number"],
                "modality": s["modality"], "count": s["count"]
            } for s in obj.get("series", [])
        ],
    }


async def store_stream(upload: UploadFile, target: Path, byte_limit: int) -> int:
    total = 0
    with target.open("wb") as output:
        while True:
            part = await upload.read(CHUNK)
            if not part:
                break
            total += len(part)
            if total > byte_limit:
                raise HTTPException(413, "Archivo demasiado grande")
            output.write(part)
    await upload.close()
    return total


def extract_dicom_zip(archive_path: Path, dicom_dir: Path) -> int:
    """Discard archive paths and use UUID names; reject traversal, symlinks and bombs."""
    total = 0
    count = 0
    try:
        with zipfile.ZipFile(archive_path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_FILES * 2:
                raise HTTPException(413, "El ZIP contiene demasiadas entradas")
            for info in entries:
                if info.is_dir():
                    continue
                normalized = info.filename.replace("\\", "/")
                pieces = normalized.split("/")
                if normalized.startswith("/") or any(p in ("..", "") for p in pieces) or re.match(r"^[A-Za-z]:", normalized):
                    raise HTTPException(400, "Ruta insegura en el archivo ZIP")
                mode = (info.external_attr >> 16) & 0xFFFF
                if stat.S_ISLNK(mode):
                    raise HTTPException(400, "El ZIP contiene enlaces simbólicos")
                if info.flag_bits & 1:
                    raise HTTPException(400, "ZIP cifrado no compatible")
                if info.file_size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "Archivo individual demasiado grande")
                total += info.file_size
                if total > MAX_EXPANDED_BYTES:
                    raise HTTPException(413, "El ZIP excede el límite descomprimido")
                if info.filename.upper().endswith(("DICOMDIR", ".DS_STORE", "THUMBS.DB")):
                    continue
                count += 1
                if count > MAX_FILES:
                    raise HTTPException(413, "Demasiados archivos DICOM")
                target = dicom_dir / (str(uuid.uuid4()) + ".dcm")
                written = 0
                with archive.open(info) as source, target.open("wb") as out:
                    while True:
                        part = source.read(CHUNK)
                        if not part:
                            break
                        written += len(part)
                        if written > info.file_size or written > MAX_UPLOAD_BYTES:
                            raise HTTPException(413, "Tamaño descomprimido inválido")
                        out.write(part)
    except (zipfile.BadZipFile, RuntimeError, OSError) as exc:
        raise HTTPException(400, "ZIP inválido o dañado") from exc
    return count


def new_study() -> tuple[str, Path]:
    study_id = str(uuid.uuid4())
    path = study_path(study_id)
    (path / "dicom").mkdir(parents=True, exist_ok=False)
    return study_id, path


def remove_study(study_id: str) -> None:
    shutil.rmtree(study_path(study_id), ignore_errors=True)


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()
