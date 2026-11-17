"""Manual, voxel-space MRI segmentation editing and 3D surface extraction.

Edits are applied to the original 3D DICOM grid, never to screenshots or
downsampled 8-bit previews. All output is unverified educational/research data,
NOT automatic tumor detection. Keep original uploads untouched.
"""
from __future__ import annotations

import io
import json
import math
import tempfile
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import numpy as np
import SimpleITK as sitk
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse
from PIL import Image, ImageDraw
from pydantic import BaseModel, Field

from . import database
from .dicom_service import find_series
from .masks import CATEGORIES, HEX, folder, list_masks
from .storage import load_study, study_path
from .volume import ensure_volume, preview_dir, slice_png

router = APIRouter()
MAX_POINTS = 2048
MAX_EDIT_VOXELS = 80_000_000
MAX_HISTORY = 12
NO_CACHE = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
Plane = Literal["axial", "coronal", "sagital"]


class NewMask(BaseModel):
    series_id: str
    category: str
    label: str = Field(min_length=1, max_length=70)
    color: str = "#ff657e"


class Edit2D(BaseModel):
    plane: Plane
    index: int = Field(ge=0)
    tool: Literal["brush", "erase", "polygon", "polygon_erase"]
    points: list[tuple[float, float]] = Field(min_length=1, max_length=MAX_POINTS)
    radius: int = Field(default=5, ge=1, le=48)
    expected_revision: int | None = None


class Grow2D(BaseModel):
    plane: Plane
    index: int = Field(ge=0)
    seed: tuple[int, int]
    tolerance: int = Field(default=20, ge=1, le=120)
    radius: int = Field(default=35, ge=5, le=110)
    expected_revision: int | None = None


class Interpolate2D(BaseModel):
    plane: Plane
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    expected_revision: int | None = None


class Smooth2D(BaseModel):
    plane: Plane
    index: int = Field(ge=0)
    sigma: float = Field(default=1.0, ge=.3, le=2.0)
    expected_revision: int | None = None


def valid_uuid(value: str):
    try:
        return str(uuid.UUID(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(404, "Identificador inexistente") from exc


def require_grid(study_id: str, series_id: str):
    study = load_study(study_id)
    find_series(study, series_id)
    meta = ensure_volume(study_path(study_id), study, series_id)
    if math.prod(meta["full_dimensions"]) > MAX_EDIT_VOXELS:
        raise HTTPException(413, "Volumen demasiado grande para la edición manual")
    return meta


def record_and_bytes(study_id: str, mask_id: str, conn=None):
    valid_uuid(study_id)
    valid_uuid(mask_id)
    if database.enabled():
        if conn is None:
            with database.connect() as db:
                return record_and_bytes(study_id, mask_id, conn=db)
        row = conn.execute(
            "SELECT meta, source_file FROM rm_masks WHERE study_id=%s AND id=%s FOR UPDATE",
            (study_id, mask_id),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Máscara no encontrada")
        return row[0], bytes(row[1])
    root = folder(study_id)
    manifest = root / (mask_id + ".json")
    candidates = sorted(root.glob(mask_id + ".nii*"))
    if not manifest.is_file() or not candidates:
        raise HTTPException(404, "Máscara no encontrada")
    return json.loads(manifest.read_text(encoding="utf-8")), candidates[0].read_bytes()


def cached_array(study_id:str, mask_id:str):
    """Return a read-only mmap on the current mask revision for fast 3-plane scrolling."""
    import fcntl
    valid_uuid(study_id);valid_uuid(mask_id)
    load_study(study_id)
    if database.enabled():
        with database.connect() as conn:
            row=conn.execute(
                "SELECT meta FROM rm_masks WHERE study_id=%s AND id=%s",
                (study_id,mask_id),
            ).fetchone()
        if row is None:raise HTTPException(404,"Máscara no encontrada")
        entry=row[0]
    else:
        source=folder(study_id)/(mask_id+".json")
        if not source.exists():raise HTTPException(404,"Máscara no encontrada")
        entry=json.loads(source.read_text(encoding="utf-8"))
    rev=int(entry.get("revision",1))
    root=study_path(study_id)/"segmentation-cache"
    root.mkdir(parents=True,exist_ok=True)
    target=root/f"{mask_id}-r{rev}.npy"
    with (root/f"{mask_id}.lock").open("a+") as lock:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX)
        try:
            if not target.exists():
                _,raw=record_and_bytes(study_id,mask_id)
                arr=numpy_image(image_from_bytes(raw))
                tmp=target.with_suffix(".npy.part")
                with tmp.open("wb") as out:
                    np.save(out,arr,allow_pickle=False)
                tmp.replace(target)
                for stale in root.glob(f"{mask_id}-r*.npy"):
                    if stale!=target:
                        stale.unlink(missing_ok=True)
        finally:
            fcntl.flock(lock.fileno(),fcntl.LOCK_UN)
    return entry,np.load(target,mmap_mode="r",allow_pickle=False)


def image_from_bytes(content: bytes) -> sitk.Image:
    with tempfile.TemporaryDirectory(prefix="rm3d-mask-") as path:
        source = Path(path) / "mask.nii.gz"
        source.write_bytes(content)
        try:
            return sitk.ReadImage(str(source))
        except RuntimeError as exc:
            raise HTTPException(422, "Máscara NIfTI no válida") from exc


def bytes_from_image(image: sitk.Image) -> bytes:
    with tempfile.TemporaryDirectory(prefix="rm3d-mask-") as path:
        dest = Path(path) / "mask.nii.gz"
        sitk.WriteImage(image, str(dest), useCompression=True)
        return dest.read_bytes()


def numpy_image(image: sitk.Image):
    arr = sitk.GetArrayFromImage(image)
    if arr.ndim != 3 or arr.size > MAX_EDIT_VOXELS:
        raise HTTPException(413, "Máscara demasiado grande")
    return (arr > 0).astype(np.uint8)


def sitk_from_array(arr: np.ndarray, meta: dict):
    img = sitk.GetImageFromArray(np.asarray(arr, dtype=np.uint8))
    img.SetOrigin(tuple(meta["full_origin"]))
    img.SetSpacing(tuple(meta["full_spacing"]))
    img.SetDirection(tuple(meta["full_direction"]))
    return img


def preview(arr: np.ndarray, meta: dict):
    fz, fy, fx = reversed(meta["preview_downsample_factors"])
    dz, dy, dx = reversed(meta["dimensions"])
    # Max-pooling retains narrow features in the preview; source grid is unchanged.
    compact = arr[:dz * fz, :dy * fy, :dx * fx].reshape(
        dz, fz, dy, fy, dx, fx,
    ).max(axis=(1, 3, 5)).astype(np.uint8)
    return zlib.compress(compact.tobytes(order="C"), level=5)


def meta_for_mask(series_id: str, category: str, label: str, color: str,
                  grid: dict, source_type="manual_editable", source_mask_id=None):
    return {
        "id": str(uuid.uuid4()),
        "series_id": series_id, "category": category,
        "label": label.strip(), "color": color.lower(),
        "source_type": source_type, "review_status": "unverified",
        "voxels": 0, "revision": 1, "source_mask_id": source_mask_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "preview_dimensions": list(grid["dimensions"]),
        "preview_meta": {k: grid[k] for k in (
            "dimensions", "spacing", "origin", "direction",
            "full_dimensions", "full_spacing", "full_origin", "full_direction",
            "study_reference", "frame_reference", "preview_downsample_factors",
        )},
    }


def insert_mask(study_id: str, record: dict, content: bytes, preview_bytes: bytes):
    if database.enabled():
        from psycopg.types.json import Jsonb
        with database.connect() as conn:
            conn.execute(
                """INSERT INTO rm_masks
                (id,study_id,series_id,label,category,color,meta,preview_zlib,source_file)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (record["id"], study_id, record["series_id"], record["label"],
                 record["category"], record["color"], Jsonb(record),
                 preview_bytes, content),
            )
    else:
        root = folder(study_id)
        (root / (record["id"] + ".nii.gz")).write_bytes(content)
        (root / (record["id"] + ".raw.zlib")).write_bytes(preview_bytes)
        (root / (record["id"] + ".json")).write_text(
            json.dumps(record, ensure_ascii=False), encoding="utf-8",
        )
    return record


@router.post("/api/studies/{study_id}/segmentation/masks", status_code=201)
def new_mask(study_id: str, data: NewMask):
    valid_uuid(study_id)
    if data.category not in CATEGORIES or not HEX.fullmatch(data.color):
        raise HTTPException(400, "Categoría o color incorrectos")
    if not data.label.strip():
        raise HTTPException(400, "Nombre vacío")
    valid_uuid(data.series_id)
    if len(list_masks(study_id)) >= 24:
        raise HTTPException(413, "Máximo 24 máscaras por estudio")
    grid = require_grid(study_id, data.series_id)
    image = sitk.Image(grid["full_dimensions"], sitk.sitkUInt8)
    image.SetOrigin(grid["full_origin"])
    image.SetSpacing(grid["full_spacing"])
    image.SetDirection(grid["full_direction"])
    zeros = np.zeros(tuple(reversed(grid["full_dimensions"])), dtype=np.uint8)
    entry = meta_for_mask(data.series_id, data.category, data.label, data.color, grid)
    return insert_mask(study_id, entry, bytes_from_image(image), preview(zeros, grid))


@router.post("/api/studies/{study_id}/segmentation/masks/{mask_id}/duplicate", status_code=201)
def copy_for_editing(study_id: str, mask_id: str):
    valid_uuid(study_id)
    if len(list_masks(study_id)) >= 24:
        raise HTTPException(413, "Máximo 24 máscaras por estudio")
    old, blob = record_and_bytes(study_id, mask_id)
    grid = require_grid(study_id, old["series_id"])
    image = image_from_bytes(blob)
    arr = numpy_image(image)
    if tuple(arr.shape) != tuple(reversed(grid["full_dimensions"])):
        raise HTTPException(422, "La máscara no coincide con la serie base")
    entry = meta_for_mask(
        old["series_id"], old["category"],
        ("Copia editable · " + old["label"])[:70], old["color"], grid,
        source_mask_id=mask_id,
    )
    entry["voxels"] = int(arr.sum())
    return insert_mask(study_id, entry, blob, preview(arr, grid))


def plane_slice(arr: np.ndarray, plane: Plane, index: int):
    axis = {"axial": 0, "coronal": 1, "sagital": 2}[plane]
    if index < 0 or index >= arr.shape[axis]:
        raise HTTPException(400, "Corte fuera del volumen")
    if plane == "axial":
        return arr[index, :, :]
    if plane == "coronal":
        return arr[:, index, :]
    return arr[:, :, index]


def replace_plane(arr: np.ndarray, plane: Plane, index: int, pixels: np.ndarray):
    target = plane_slice(arr, plane, index)
    if target.shape != pixels.shape:
        raise HTTPException(400, "Dimensiones incorrectas")
    target[:] = pixels


def paint_slice(arr: np.ndarray, data: Edit2D) -> np.ndarray:
    plane = plane_slice(arr, data.plane, data.index)
    height, width = plane.shape
    for x, y in data.points:
        if not (math.isfinite(x) and math.isfinite(y)):
            raise HTTPException(400, "Coordenadas no finitas")
        if not (-2 <= x <= width + 2 and -2 <= y <= height + 2):
            raise HTTPException(400, "Coordenadas fuera del corte")
    bitmap = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(bitmap)
    if data.tool in ("polygon", "polygon_erase"):
        if len(data.points) < 3:
            raise HTTPException(400, "El polígono necesita tres vértices")
        draw.polygon(data.points, fill=255)
    else:
        r = data.radius
        if len(data.points) > 1:
            draw.line(data.points, fill=255, width=r * 2 + 1, joint="curve")
        for x, y in data.points:
            draw.ellipse((x - r, y - r, x + r, y + r), fill=255)
    selection = np.asarray(bitmap) > 0
    plane[selection] = 0 if data.tool.endswith("erase") else 1
    return arr


def grow_slice(arr: np.ndarray, intensities: np.ndarray, data: Grow2D) -> np.ndarray:
    from scipy import ndimage as ndi
    target = plane_slice(arr, data.plane, data.index)
    src = plane_slice(intensities, data.plane, data.index).astype(np.float32)
    h, w = target.shape
    x, y = data.seed
    if not (0 <= x < w and 0 <= y < h):
        raise HTTPException(400, "Semilla fuera del corte")
    r = data.radius
    ymin, ymax = max(0, y - r), min(h, y + r + 1)
    xmin, xmax = max(0, x - r), min(w, x + r + 1)
    area = src[ymin:ymax, xmin:xmax]
    lo, hi = np.nanpercentile(src, [1, 99.5])
    if hi <= lo:
        hi = lo + 1
    window = (np.clip((area - lo) / (hi - lo), 0, 1) * 255)
    seed_value = window[y - ymin, x - xmin]
    yy, xx = np.ogrid[ymin:ymax, xmin:xmax]
    within = (xx - x) ** 2 + (yy - y) ** 2 <= r ** 2
    good = within & np.isfinite(window) & (np.abs(window - seed_value) <= data.tolerance)
    if not good[y - ymin, x - xmin]:
        raise HTTPException(422, "La semilla no contiene una intensidad válida")
    labels, _ = ndi.label(good, structure=np.ones((3, 3), dtype=np.uint8))
    component = labels == labels[y - ymin, x - xmin]
    if component.sum() > within.sum() * .85:
        raise HTTPException(422, "Selección demasiado extensa: reduce tolerancia o radio")
    target[ymin:ymax, xmin:xmax][component] = 1
    return arr


def interpolate_slice(arr: np.ndarray, data: Interpolate2D) -> np.ndarray:
    from scipy import ndimage as ndi
    start, end = data.start, data.end
    axis = {"axial": 0, "coronal": 1, "sagital": 2}[data.plane]
    if end <= start + 1 or end - start > 100 or end >= arr.shape[axis]:
        raise HTTPException(400, "Selecciona cortes separados por 2–100 posiciones")
    begin = plane_slice(arr, data.plane, start).astype(bool)
    finish = plane_slice(arr, data.plane, end).astype(bool)
    if not begin.any() or not finish.any():
        raise HTTPException(422, "Pinta ambos cortes extremos antes de interpolar")
    def signed(mask):
        return ndi.distance_transform_edt(~mask) - ndi.distance_transform_edt(mask)
    a = signed(begin)
    b = signed(finish)
    for pos in range(start + 1, end):
        original = plane_slice(arr, data.plane, pos)
        if original.any():  # Preserve any work already performed on intermediate slices.
            continue
        weight = (pos - start) / (end - start)
        original[:] = ((1 - weight) * a + weight * b <= 0).astype(np.uint8)
    return arr


def smooth_slice(arr: np.ndarray, data: Smooth2D) -> np.ndarray:
    from scipy import ndimage as ndi
    layer = plane_slice(arr, data.plane, data.index)
    if layer.any():
        layer[:] = (ndi.gaussian_filter(
            layer.astype(np.float32), sigma=data.sigma,
        ) >= .5).astype(np.uint8)
    return arr


def full_grid(entry: dict):
    return entry["preview_meta"]


def save_edited(study_id: str, mask_id: str, expected_revision: int | None, fn):
    from psycopg.types.json import Jsonb
    valid_uuid(study_id)
    valid_uuid(mask_id)
    load_study(study_id)
    # Transactional row locking avoids lost edits between simultaneous browsers.
    if database.enabled():
        with database.connect() as conn:
            entry, original = record_and_bytes(study_id, mask_id, conn)
            if entry.get("source_type") != "manual_editable":
                raise HTTPException(409, "Duplica primero la máscara original para conservarla intacta")
            rev = int(entry.get("revision", 1))
            prior_meta=entry.copy()
            if expected_revision is not None and rev != expected_revision:
                raise HTTPException(409, "La máscara cambió en otra sesión: actualiza antes de editar")
            meta = full_grid(entry)
            img = image_from_bytes(original)
            arr = numpy_image(img)
            if arr.shape != tuple(reversed(meta["full_dimensions"])):
                raise HTTPException(422, "Dimensiones de máscara incorrectas")
            fn(arr, entry)
            new_rev = rev + 1
            entry = {**entry, "revision": new_rev, "voxels": int(arr.sum()),
                     "review_status": "unverified"}
            new_blob = bytes_from_image(sitk_from_array(arr, meta))
            new_preview = preview(arr, {**meta, "preview_downsample_factors":
                meta.get("preview_downsample_factors",[
                    max(1, math.ceil(dim / 192)) for dim in meta["full_dimensions"]
                ])
            })
            conn.execute(
                """INSERT INTO rm_mask_versions
                   (mask_id,study_id,revision,meta,preview_zlib,source_file)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (mask_id, study_id, rev, Jsonb(prior_meta),
                 conn.execute("SELECT preview_zlib FROM rm_masks WHERE id=%s",(mask_id,)).fetchone()[0],
                 original),
            )
            conn.execute(
                """UPDATE rm_masks SET meta=%s,source_file=%s,preview_zlib=%s
                   WHERE study_id=%s AND id=%s""",
                (Jsonb(entry), new_blob, new_preview, study_id, mask_id),
            )
            conn.execute(
                """DELETE FROM rm_mask_versions WHERE mask_id=%s AND revision NOT IN
                   (SELECT revision FROM rm_mask_versions WHERE mask_id=%s
                    ORDER BY revision DESC LIMIT %s)""",
                (mask_id, mask_id, MAX_HISTORY),
            )
            return {k: entry.get(k) for k in (
                "id", "label", "category", "color", "series_id",
                "revision", "voxels", "source_type", "review_status",
            )}
    # File-backed development mode retains a numbered snapshot before writing.
    record, original = record_and_bytes(study_id, mask_id)
    if record.get("source_type") != "manual_editable":
        raise HTTPException(409, "Duplica primero la máscara original")
    rev = int(record.get("revision", 1))
    if expected_revision is not None and rev != expected_revision:
        raise HTTPException(409, "Máscara modificada por otra sesión")
    grid = record["preview_meta"]
    arr = numpy_image(image_from_bytes(original))
    fn(arr, record)
    root = folder(study_id)
    # Keep history bounded and recoverable after refresh.
    (root / f"{mask_id}.v{rev}.nii.gz").write_bytes(original)
    snapshots = sorted(root.glob(f"{mask_id}.v*.nii.gz"))
    if len(snapshots) > MAX_HISTORY:
        for old in snapshots[:len(snapshots) - MAX_HISTORY]:
            old.unlink(missing_ok=True)
    record["revision"] = rev + 1
    record["voxels"] = int(arr.sum())
    blob = bytes_from_image(sitk_from_array(arr, grid))
    (root / (mask_id + ".nii.gz")).write_bytes(blob)
    factors = grid.get("preview_downsample_factors", [
        max(1,math.ceil(d/192)) for d in grid["full_dimensions"]
    ])
    (root / (mask_id + ".raw.zlib")).write_bytes(preview(arr, {**grid, "preview_downsample_factors": factors}))
    (root / (mask_id + ".json")).write_text(json.dumps(record),encoding="utf-8")
    return {k: record.get(k) for k in ("id","revision","voxels","label","source_type")}


@router.post("/api/studies/{study_id}/segmentation/masks/{mask_id}/paint")
def paint(study_id: str, mask_id: str, data: Edit2D):
    return save_edited(study_id, mask_id, data.expected_revision,
                       lambda a,_: paint_slice(a, data))


@router.post("/api/studies/{study_id}/segmentation/masks/{mask_id}/grow")
def grow(study_id: str, mask_id: str, data: Grow2D):
    def apply(a, entry):
        grid = require_grid(study_id, entry["series_id"])
        source = np.load(
            preview_dir(study_path(study_id), entry["series_id"]) / "full.npy",
            mmap_mode="r", allow_pickle=False,
        )
        grow_slice(a, source, data)
    return save_edited(study_id, mask_id, data.expected_revision, apply)


@router.post("/api/studies/{study_id}/segmentation/masks/{mask_id}/interpolate")
def interpolate(study_id: str, mask_id: str, data: Interpolate2D):
    return save_edited(study_id, mask_id, data.expected_revision,
                       lambda a,_: interpolate_slice(a, data))


@router.post("/api/studies/{study_id}/segmentation/masks/{mask_id}/smooth")
def smooth(study_id: str, mask_id: str, data: Smooth2D):
    return save_edited(study_id, mask_id, data.expected_revision,
                       lambda a,_: smooth_slice(a, data))


@router.get("/api/studies/{study_id}/segmentation/masks/{mask_id}/slice")
def mask_slice(study_id: str, mask_id: str, plane: Plane="axial", index: int=0):
    record, arr = cached_array(study_id, mask_id)
    layer = plane_slice(arr, plane, index)
    # Binary PNG used as alpha overlay on an MRI slice, never source diagnostic data.
    rgba = np.zeros((*layer.shape,4),dtype=np.uint8)
    color = bytes.fromhex(record["color"].removeprefix("#"))
    rgba[:,:,:3] = list(color)
    rgba[:,:,3] = layer * 155
    output = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(output, format="PNG")
    return Response(output.getvalue(),media_type="image/png",headers=NO_CACHE)


@router.get("/api/studies/{study_id}/segmentation/masks/{mask_id}/export.nii.gz")
def export_nifti(study_id: str, mask_id: str):
    entry, blob = record_and_bytes(study_id, mask_id)
    return Response(blob,media_type="application/gzip",
        headers={**NO_CACHE, "Content-Disposition":
                 f'attachment; filename="segmentacion-{mask_id[:8]}.nii.gz"'})


def build_mesh(arr: np.ndarray, grid: dict, color: str, fmt: str):
    from scipy import ndimage as ndi
    from skimage.measure import marching_cubes
    import trimesh

    if not np.any(arr):
        raise HTTPException(422, "Primero debes dibujar al menos una región")
    factors = max(1, math.ceil(max(arr.shape) / 230))
    # Block maximum (not point subsampling) preserves small annotated structures.
    if factors>1:
        padded_shape = tuple(math.ceil(size/factors)*factors for size in arr.shape)
        padded = np.zeros(padded_shape,dtype=np.uint8)
        padded[:arr.shape[0],:arr.shape[1],:arr.shape[2]] = arr
        dz,dy,dx = (length//factors for length in padded_shape)
        source = padded.reshape(dz,factors,dy,factors,dx,factors).max(axis=(1,3,5)).astype(np.float32)
    else:
        source = arr.astype(np.float32)
    if min(source.shape) < 3:
        raise HTTPException(422, "Máscara demasiado pequeña")
    smoothed = ndi.gaussian_filter(source, sigma=.7)
    pad = np.pad(smoothed,1,mode="constant")
    verts, faces, _, _ = marching_cubes(pad, level=.35,
                                        step_size=1,allow_degenerate=False)
    zyx = (verts - 1) * factors
    xyz = zyx[:,::-1] * np.array(grid["full_spacing"], dtype=np.float64)
    direction = np.asarray(grid["full_direction"],dtype=np.float64).reshape(3,3)
    origin = np.asarray(grid["full_origin"],dtype=np.float64)
    patient_vertices = xyz @ direction.T + origin
    mesh = trimesh.Trimesh(vertices=patient_vertices, faces=faces,process=False)
    rgb = list(bytes.fromhex(color.removeprefix("#")))
    mesh.visual.vertex_colors = [*rgb,230]
    # Fix triangle orientation following any LPS direction/mirroring.
    if fmt=="glb":
        return mesh.export(file_type="glb"),"model/gltf-binary"
    if fmt=="obj":
        return mesh.export(file_type="obj").encode("utf-8"),"text/plain"
    if fmt=="stl":
        return mesh.export(file_type="stl"),"model/stl"
    raise HTTPException(400,"Formato no admitido")


@router.get("/api/studies/{study_id}/segmentation/masks/{mask_id}/mesh.{fmt}")
def mesh_export(study_id: str, mask_id: str, fmt: str):
    if fmt not in ("glb", "obj", "stl"):
        raise HTTPException(400, "Exporta GLB, OBJ o STL")
    import fcntl
    entry, arr = cached_array(study_id,mask_id)
    cache_root=study_path(study_id)/"segmentation-cache"
    version=int(entry.get("revision",1))
    target=cache_root/f"{mask_id}-r{version}.{fmt}"
    with (cache_root/f"{mask_id}-mesh.lock").open("a+") as lock:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX)
        try:
            if not target.is_file():
                content, mime=build_mesh(arr,entry["preview_meta"],entry["color"],fmt)
                temp=target.with_name(target.name+".part")
                temp.write_bytes(content)
                temp.replace(target)
                for stale in cache_root.glob(f"{mask_id}-r*.{fmt}"):
                    if stale!=target:stale.unlink(missing_ok=True)
        finally:
            fcntl.flock(lock.fileno(),fcntl.LOCK_UN)
    mime={"glb":"model/gltf-binary","stl":"model/stl","obj":"text/plain"}[fmt]
    return FileResponse(str(target),media_type=mime,
        headers=NO_CACHE,
        filename=f"segmentacion-{mask_id[:8]}.{fmt}")


@router.get("/api/studies/{study_id}/segmentation/masks/{mask_id}/history")
def history(study_id: str, mask_id: str):
    entry, _ = record_and_bytes(study_id, mask_id)
    if database.enabled():
        with database.connect() as conn:
            rows = conn.execute(
                """SELECT revision,created_at FROM rm_mask_versions
                   WHERE mask_id=%s AND study_id=%s ORDER BY revision DESC""",
                (mask_id,study_id),
            ).fetchall()
        return {"revision":entry.get("revision",1),
                "snapshots":[{"revision":rev,"created_at":when.isoformat()} for rev,when in rows]}
    files=folder(study_id).glob(mask_id + ".v*.nii.gz")
    return {"revision":entry.get("revision",1),
            "snapshots":[{"revision":int(f.name.split(".v")[1].split(".")[0])} for f in files]}


class Restore(BaseModel):
    revision: int = Field(ge=1)


@router.post("/api/studies/{study_id}/segmentation/masks/{mask_id}/restore")
def restore_version(study_id: str, mask_id: str, body: Restore):
    if database.enabled():
        with database.connect() as conn:
            row=conn.execute(
                """SELECT source_file FROM rm_mask_versions
                   WHERE study_id=%s AND mask_id=%s AND revision=%s""",
                (study_id,mask_id,body.revision),
            ).fetchone()
        if row is None:
            raise HTTPException(404, "Versión no disponible")
        earlier = numpy_image(image_from_bytes(bytes(row[0])))
    else:
        path=folder(study_id)/f"{mask_id}.v{body.revision}.nii.gz"
        if not path.is_file():
            raise HTTPException(404, "Versión no disponible")
        earlier=numpy_image(image_from_bytes(path.read_bytes()))
    def update(arr, _):
        if arr.shape != earlier.shape:
            raise HTTPException(409,"Dimensiones de versión incompatible")
        arr[:]=earlier
    return save_edited(study_id,mask_id,None,update)
