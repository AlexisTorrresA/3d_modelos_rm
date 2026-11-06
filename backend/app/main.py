"""Local-first MRI 3D MVP. Intentionally has no public networking or authentication."""
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from starlette.concurrency import run_in_threadpool

from .dicom_service import find_series, scan_series
from .storage import (
    DATA_DIR, MAX_REPORT_BYTES, MAX_UPLOAD_BYTES, extract_dicom_zip,
    list_studies, load_study, new_study, now_utc, public_study,
    remove_study, save_study, store_stream, study_path,
)
from .volume import ensure_volume, preview_dir, slice_png

app = FastAPI(
    title="Modelos RM 3D — API local",
    description="Visualización exploratoria de DICOM; no apta para uso diagnóstico.",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

NO_STORE = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "local"}


@app.get("/api/studies")
def studies():
    return list_studies()


@app.get("/api/studies/{study_id}")
def study(study_id: str):
    return public_study(load_study(study_id))


@app.post("/api/studies", status_code=201)
async def upload_study(
    files: list[UploadFile] = File(...),
    report: UploadFile | None = File(None),
):
    if not files or len(files) > 10000:
        raise HTTPException(400, "Seleccione archivos DICOM o ZIP")
    if any(f.filename and f.filename.lower().endswith(".zip") for f in files) and len(files) != 1:
        raise HTTPException(400, "Suba un ZIP o varios DICOM, no ambos")
    study_id, root = new_study()
    try:
        dicom_dir = root / "dicom"
        total = 0
        if len(files) == 1 and files[0].filename and files[0].filename.lower().endswith(".zip"):
            archive = root / "upload.zip"
            await store_stream(files[0], archive, MAX_UPLOAD_BYTES)
            await run_in_threadpool(extract_dicom_zip, archive, dicom_dir)
            archive.unlink(missing_ok=True)
        else:
            for upload in files:
                path = dicom_dir / (str(uuid.uuid4()) + ".dcm")
                total += await store_stream(upload, path, MAX_UPLOAD_BYTES - total)
        has_report = False
        if report and report.filename:
            if not report.filename.lower().endswith(".pdf"):
                raise HTTPException(400, "El informe debe ser PDF")
            target = root / "report.pdf"
            await store_stream(report, target, MAX_REPORT_BYTES)
            with target.open("rb") as input_file:
                if input_file.read(5) != b"%PDF-":
                    raise HTTPException(400, "El informe no parece un PDF")
            has_report = True

        series, file_count = await run_in_threadpool(scan_series, dicom_dir)
        if not series:
            raise HTTPException(422, "No se encontraron series DICOM de resonancia magnética (MR)")
        record = {
            "id": study_id, "created_at": now_utc(), "has_report": has_report,
            "file_count": file_count, "series": series,
        }
        save_study(study_id, record)
        return public_study(record)
    except Exception:
        remove_study(study_id)
        raise


@app.get("/api/studies/{study_id}/report")
def download_report(study_id: str):
    record = load_study(study_id)
    if not record["has_report"]:
        raise HTTPException(404, "Informe no encontrado")
    return FileResponse(
        study_path(study_id) / "report.pdf",
        filename="informe-rm.pdf",
        media_type="application/pdf",
        content_disposition_type="attachment",
        headers=NO_STORE,
    )


@app.get("/api/studies/{study_id}/series/{series_id}/volume.json")
def get_volume_metadata(study_id: str, series_id: str):
    record = load_study(study_id)
    find_series(record, series_id)
    return ensure_volume(study_path(study_id), record, series_id)


@app.get("/api/studies/{study_id}/series/{series_id}/volume.raw")
def get_volume_data(study_id: str, series_id: str):
    record = load_study(study_id)
    find_series(record, series_id)
    ensure_volume(study_path(study_id), record, series_id)
    return FileResponse(
        preview_dir(study_path(study_id), series_id) / "volume.raw",
        media_type="application/octet-stream",
        headers=NO_STORE,
    )


@app.get("/api/studies/{study_id}/series/{series_id}/slice")
def get_slice(study_id: str, series_id: str, plane: str = "axial", index: int = 0):
    record = load_study(study_id)
    find_series(record, series_id)
    meta = ensure_volume(study_path(study_id), record, series_id)
    return Response(
        content=slice_png(study_path(study_id), series_id, meta, plane, index),
        media_type="image/png",
        headers=NO_STORE,
    )


@app.delete("/api/studies/{study_id}", status_code=204)
def delete_study(study_id: str):
    load_study(study_id)
    remove_study(study_id)
    return Response(status_code=204)
