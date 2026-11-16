"""Cloudflare-safe chunk upload, each request at most 16 MiB."""
import json
import os
import shutil
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from .storage import DATA_DIR, MAX_FILES, MAX_UPLOAD_BYTES, MAX_REPORT_BYTES

router = APIRouter()
UPLOAD_CHUNK = 16 * 1024 * 1024
STAGING = DATA_DIR / "staging"


class FileInfo(BaseModel):
    name: str = Field(min_length=1,max_length=255)
    size: int = Field(gt=0,le=MAX_UPLOAD_BYTES)


class StartUpload(BaseModel):
    files: list[FileInfo] = Field(min_length=1,max_length=MAX_FILES)
    report: FileInfo | None = None


def folder_for(upload_id):
    try:
        upload_id = str(uuid.UUID(upload_id))
    except (ValueError,AttributeError):
        raise HTTPException(404,"Subida no encontrada")
    return STAGING / upload_id


def read_manifest(upload_id):
    root = folder_for(upload_id)
    if not (root / "manifest.json").exists():
        raise HTTPException(404,"Subida no encontrada")
    return root,json.loads((root / "manifest.json").read_text(encoding="utf-8"))


@router.post("/api/uploads",status_code=201)
def begin(payload: StartUpload):
    files = payload.files
    if sum(f.size for f in files) > MAX_UPLOAD_BYTES:
        raise HTTPException(413,"La subida supera el tamaño permitido")
    zip_mode = len(files)==1 and files[0].name.lower().endswith(".zip")
    if any(f.name.lower().endswith(".zip") for f in files) and not zip_mode:
        raise HTTPException(400,"No combine ZIP con archivos individuales")
    if payload.report and (
        not payload.report.name.lower().endswith(".pdf")
        or payload.report.size > MAX_REPORT_BYTES
    ):
        raise HTTPException(400,"Informe PDF inválido")
    STAGING.mkdir(parents=True,exist_ok=True)
    for old in STAGING.glob("*"):
        if old.is_dir() and time.time()-old.stat().st_mtime > 24*3600:
            shutil.rmtree(old,ignore_errors=True)
    upload_id = str(uuid.uuid4())
    root = folder_for(upload_id)
    root.mkdir(mode=0o700)
    (root / "manifest.json").write_text(
        json.dumps(payload.model_dump()),encoding="utf-8"
    )
    return {"upload_id":upload_id,"chunk_bytes":UPLOAD_CHUNK}


@router.put("/api/uploads/{upload_id}/files/{file_index}/chunks/{chunk_index}")
async def write_chunk(upload_id: str,file_index: int,chunk_index:int,request:Request):
    root,manifest=read_manifest(upload_id)
    definitions=manifest["files"]+([manifest["report"]] if manifest.get("report") else [])
    if file_index<0 or file_index>=len(definitions):
        raise HTTPException(404,"Archivo no encontrado")
    maximum=definitions[file_index]["size"]
    if chunk_index<0 or chunk_index*UPLOAD_CHUNK>=maximum:
        raise HTTPException(400,"Índice de bloque inválido")
    size_expected=min(UPLOAD_CHUNK,maximum-chunk_index*UPLOAD_CHUNK)
    target=root / f"{file_index}.part"
    previous=target.stat().st_size if target.exists() else 0
    if previous!=chunk_index*UPLOAD_CHUNK:
        raise HTTPException(409,"Bloque fuera de orden")
    try:
        claimed=request.headers.get("content-length")
        if claimed is not None and int(claimed)!=size_expected:
            raise HTTPException(400,"Tamaño del bloque incorrecto")
    except ValueError:
        raise HTTPException(400,"Content-Length inválido")
    received=0
    with target.open("ab") as f:
        async for block in request.stream():
            received+=len(block)
            if received>size_expected:
                f.truncate(previous)
                raise HTTPException(413,"Bloque demasiado grande")
            f.write(block)
        if received!=size_expected:
            f.truncate(previous)
            raise HTTPException(400,"Tamaño del bloque incorrecto")
    return {"received":previous+received,"total":maximum}


@router.post("/api/uploads/{upload_id}/complete",status_code=201)
async def complete(upload_id:str):
    root,manifest=read_manifest(upload_id)
    files=manifest["files"]
    report_meta=manifest.get("report")
    descriptions=files+([report_meta] if report_meta else [])
    for i,desc in enumerate(descriptions):
        source=root / f"{i}.part"
        if not source.is_file() or source.stat().st_size!=desc["size"]:
            raise HTTPException(409,"Hay archivos incompletos en la subida")
    opened=[]
    try:
        for i,desc in enumerate(descriptions):
            opened.append(UploadFile(filename=desc["name"],file=(root / f"{i}.part").open("rb")))
        from .main import upload_study
        result=await upload_study(files=opened[:len(files)],report=opened[-1] if report_meta else None)
        return result
    finally:
        for handle in opened:
            await handle.close()
        shutil.rmtree(root,ignore_errors=True)
