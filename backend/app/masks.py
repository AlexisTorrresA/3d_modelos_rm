"""User-supplied binary NIfTI masks, checked against reference DICOM geometry.

This route does NOT identify or segment disease. Labels are supplied by users.
Mismatched spatial geometry is explicitly rejected, never guessed/warped.
"""
import io
import json
import math
import re
import uuid
import zlib
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel

from . import database
from .dicom_service import find_series
from .storage import load_study, study_path
from .volume import ensure_volume

router = APIRouter()
MAX_MASK_SIZE=64*1024*1024
CATEGORIES={"lesion","brain","ventricles","spinal_cord","vessels","other"}
HEX=re.compile(r"^#[0-9a-fA-F]{6}$")


def metadata(entry: dict):
    return {key:entry[key] for key in (
        "id","series_id","label","category","color","created_at","voxels","preview_dimensions","preview_meta"
    )}


def folder(study_id):
    path=study_path(study_id)/"masks"
    path.mkdir(parents=True,exist_ok=True)
    return path


def list_masks(study_id):
    load_study(study_id)
    if database.enabled():
        with database.connect() as conn:
            rows=conn.execute(
                "SELECT meta FROM rm_masks WHERE study_id=%s ORDER BY created_at",
                (study_id,),
            ).fetchall()
        return [metadata(row[0]) for row in rows]
    return [
        metadata(json.loads(p.read_text(encoding="utf-8")))
        for p in folder(study_id).glob("*.json")
    ]


@router.get("/api/studies/{study_id}/masks")
def get_masks(study_id:str):
    return list_masks(study_id)


@router.post("/api/studies/{study_id}/masks",status_code=201)
async def add_mask(
    study_id:str,
    file:UploadFile=File(...),
    series_id:str=Form(...),
    category:str=Form(...),
    label:str=Form(...),
    color:str=Form(...),
):
    study=load_study(study_id)
    find_series(study,series_id)
    if category not in CATEGORIES or not HEX.fullmatch(color):
        raise HTTPException(400,"Categoría o color inválidos")
    if not (1<=len(label.strip())<=70):
        raise HTTPException(400,"Nombre inválido")
    if not file.filename or not file.filename.lower().endswith((".nii",".nii.gz")):
        raise HTTPException(400,"Sube una máscara NIfTI .nii o .nii.gz")
    if len(list_masks(study_id))>=24:
        raise HTTPException(413,"Máximo 24 máscaras por estudio")

    content=await file.read(MAX_MASK_SIZE+1)
    await file.close()
    if len(content)>MAX_MASK_SIZE:
        raise HTTPException(413,"Máscara demasiado grande (máximo 64 MiB)")

    entry_id=str(uuid.uuid4())
    suffix=".nii.gz" if file.filename.lower().endswith(".nii.gz") else ".nii"
    source=folder(study_id)/(entry_id+suffix)
    source.write_bytes(content)
    try:
        meta=ensure_volume(study_path(study_id),study,series_id)
        target=meta["full_dimensions"]
        reader=sitk.ImageFileReader()
        reader.SetFileName(str(source))
        reader.ReadImageInformation()
        if reader.GetDimension()!=3:
            raise HTTPException(422,"Solo se admiten máscaras volumétricas 3D")
        if list(reader.GetSize())!=target:
            raise HTTPException(422,"La máscara no tiene la misma cantidad de vóxeles que la secuencia DICOM de referencia")
        # Guard against compressed NIfTI payloads that are tiny on disk but huge in memory.
        if math.prod(reader.GetSize())>150_000_000:
            raise HTTPException(413,"Máscara excesivamente grande")
        image=sitk.ReadImage(str(source))
        # NIfTI is read in the ITK physical LPS reference system. Exact grid
        # correspondence avoids silently assigning anatomy to wrong voxels.
        if list(image.GetSize())!=target:
            raise HTTPException(422,"La máscara no tiene la misma cantidad de vóxeles que la secuencia DICOM de referencia")
        for key,actual in (
            ("full_origin",image.GetOrigin()),("full_spacing",image.GetSpacing()),
            ("full_direction",image.GetDirection()),
        ):
            wanted=meta[key]
            tolerance=.75 if key=="full_origin" else (.02 if key=="full_spacing" else .008)
            if not np.allclose(actual,wanted,rtol=0,atol=tolerance):
                raise HTTPException(422,"Geometría NIfTI diferente de la secuencia DICOM; alinear y verificar antes de subirla")

        values=sitk.GetArrayFromImage(image)
        if not np.isfinite(values).all():
            raise HTTPException(422,"La máscara contiene valores inválidos")
        binary=(values>0).astype(np.uint8)
        count=int(binary.sum())
        if count<1:
            raise HTTPException(422,"La máscara está vacía")
        factors=meta["preview_downsample_factors"]
        fz,fy,fx=(factors[2],factors[1],factors[0])
        dz,dy,dx=(meta["dimensions"][2],meta["dimensions"][1],meta["dimensions"][0])
        # Max pooling, rather than nearest-point Shrink, prevents small segmented
        # regions disappearing when producing a lower-resolution preview.
        pixels=binary[:dz*fz,:dy*fy,:dx*fx].reshape(
            dz,fz,dy,fy,dx,fx
        ).max(axis=(1,3,5)).astype(np.uint8)
        if pixels.shape!=(dz,dy,dx):
            raise HTTPException(422,"No se pudo ajustar la máscara a la vista previa")

        from datetime import datetime,timezone
        record={
            "id":entry_id,"series_id":series_id,"category":category,
            "label":label.strip(),"color":color.lower(),
            "voxels":count, "preview_dimensions":list(meta["dimensions"]),
            "preview_meta":{key:meta[key] for key in (
                "dimensions","spacing","origin","direction",
                "full_dimensions","full_spacing","full_origin","full_direction",
                "study_reference","frame_reference"
            )},
            "created_at":datetime.now(timezone.utc).isoformat(),
        }
        compressed=zlib.compress(pixels.tobytes(order="C"),level=6)
        if database.enabled():
            from psycopg.types.json import Jsonb
            with database.connect() as conn:
                conn.execute(
                    """INSERT INTO rm_masks
                    (id,study_id,series_id,label,category,color,meta,preview_zlib,source_file)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (entry_id,study_id,series_id,record["label"],category,color.lower(),
                    Jsonb(record),compressed,content),
                )
            source.unlink(missing_ok=True)
        else:
            (folder(study_id)/(entry_id+".raw.zlib")).write_bytes(compressed)
            (folder(study_id)/(entry_id+".json")).write_text(
                json.dumps(record,ensure_ascii=False),encoding="utf-8"
            )
        return metadata(record)
    except HTTPException:
        source.unlink(missing_ok=True)
        raise
    except (RuntimeError,ValueError,TypeError,OSError) as exc:
        source.unlink(missing_ok=True)
        raise HTTPException(422,"No se pudo interpretar o validar la máscara NIfTI") from exc


@router.get("/api/studies/{study_id}/masks/{mask_id}/volume.raw")
def get_mask_raw(study_id:str,mask_id:str):
    load_study(study_id)
    try: uuid.UUID(mask_id)
    except ValueError: raise HTTPException(404,"Máscara no encontrada")
    if database.enabled():
        with database.connect() as conn:
            found=conn.execute(
                "SELECT preview_zlib FROM rm_masks WHERE study_id=%s AND id=%s",
                (study_id,mask_id),
            ).fetchone()
        if not found:raise HTTPException(404,"Máscara no encontrada")
        compressed=bytes(found[0])
    else:
        path=folder(study_id)/(mask_id+".raw.zlib")
        if not path.exists():raise HTTPException(404,"Máscara no encontrada")
        compressed=path.read_bytes()
    return Response(zlib.decompress(compressed),media_type="application/octet-stream",
        headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"})



class MaskAppearance(BaseModel):
    color: str


@router.patch("/api/studies/{study_id}/masks/{mask_id}")
def edit_mask(study_id:str,mask_id:str,payload:MaskAppearance):
    load_study(study_id)
    try:uuid.UUID(mask_id)
    except ValueError:raise HTTPException(404,"Máscara no encontrada")
    if not HEX.fullmatch(payload.color):
        raise HTTPException(400,"Color hexadecimal inválido")
    if database.enabled():
        from psycopg.types.json import Jsonb
        with database.connect() as conn:
            row=conn.execute(
                "SELECT meta FROM rm_masks WHERE study_id=%s AND id=%s",
                (study_id,mask_id),
            ).fetchone()
            if not row:raise HTTPException(404,"Máscara no encontrada")
            record=row[0]
            record["color"]=payload.color.lower()
            conn.execute(
                "UPDATE rm_masks SET color=%s,meta=%s WHERE study_id=%s AND id=%s",
                (payload.color.lower(),Jsonb(record),study_id,mask_id),
            )
    else:
        target=folder(study_id)/(mask_id+".json")
        if not target.is_file():raise HTTPException(404,"Máscara no encontrada")
        record=json.loads(target.read_text(encoding="utf-8"))
        record["color"]=payload.color.lower()
        target.write_text(json.dumps(record,ensure_ascii=False),encoding="utf-8")
    return metadata(record)


@router.delete("/api/studies/{study_id}/masks/{mask_id}",status_code=204)
def delete_mask(study_id:str,mask_id:str):
    load_study(study_id)
    try:uuid.UUID(mask_id)
    except ValueError:raise HTTPException(404,"Máscara no encontrada")
    if database.enabled():
        with database.connect() as conn:
            result=conn.execute("DELETE FROM rm_masks WHERE study_id=%s AND id=%s",
                (study_id,mask_id))
            if result.rowcount==0:raise HTTPException(404,"Máscara no encontrada")
    else:
        candidates=list(folder(study_id).glob(mask_id+".*"))
        if not candidates:raise HTTPException(404,"Máscara no encontrada")
        for p in candidates:p.unlink(missing_ok=True)
    return Response(status_code=204)
