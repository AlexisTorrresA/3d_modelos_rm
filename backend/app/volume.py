"""Derivative previews are not diagnostic. Source DICOM is retained intact."""
import io
import json
import math
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from PIL import Image
from fastapi import HTTPException

from .dicom_service import find_series, read_series

PREVIEW_MAX_AXIS = 192
MAX_VOXELS = 150_000_000


def preview_dir(study_dir: Path, series_id: str) -> Path:
    return study_dir / "previews" / series_id


def ensure_volume(study_dir: Path, study: dict, series_id: str) -> dict:
    series = find_series(study, series_id)
    target = preview_dir(study_dir, series_id)
    meta_path = target / "volume.json"
    if meta_path.exists() and (target / "volume.raw").exists() and (target / "full.npy").exists():
        return json.loads(meta_path.read_text(encoding="utf-8"))

    try:
        image = read_series(study_dir / "dicom", series)
        size = image.GetSize()
        if math.prod(size) > MAX_VOXELS:
            raise ValueError("Serie demasiado grande para esta versión")
        full = sitk.GetArrayFromImage(image)
        if full.ndim != 3:
            raise ValueError("El volumen debe tener tres dimensiones")
        target.mkdir(parents=True, exist_ok=True)
        np.save(target / "full.npy", full, allow_pickle=False)

        sampled = full.ravel()[::max(1, full.size // 250_000)]
        sampled = sampled[np.isfinite(sampled)]
        if sampled.size == 0:
            raise ValueError("El volumen no contiene intensidades válidas")
        low, high = np.percentile(sampled, (1.0, 99.5))
        if high <= low:
            high = low + 1.0

        factors = [max(1, math.ceil(d / PREVIEW_MAX_AXIS)) for d in size]
        small = sitk.Shrink(image, factors) if any(f > 1 for f in factors) else image
        voxels = sitk.GetArrayFromImage(small).astype(np.float32)
        voxels = np.nan_to_num(voxels, nan=low, posinf=high, neginf=low)
        pixels = (np.clip((voxels - low) / (high - low), 0, 1) * 255).astype(np.uint8)
        (target / "volume.raw").write_bytes(pixels.tobytes(order="C"))

        result = {
            "dimensions": list(small.GetSize()),
            "spacing": list(small.GetSpacing()),
            "origin": list(small.GetOrigin()),
            "direction": list(small.GetDirection()),
            "full_dimensions": list(size),
            "full_spacing": list(image.GetSpacing()),
            "intensity_window": [float(low), float(high)],
            "preview_downsample_factors": factors,
            "bytes": pixels.nbytes,
            "note": "Vista previa volumétrica normalizada a 8 bits; conservar DICOM original para evaluación.",
        }
        (target / "volume.json").write_text(json.dumps(result), encoding="utf-8")
        return result
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(422, str(exc)) from exc


def slice_png(study_dir: Path, series_id: str, meta: dict, plane: str, index: int) -> bytes:
    if plane not in ("axial", "coronal", "sagital"):
        raise HTTPException(400, "Plano inválido")
    source = preview_dir(study_dir, series_id) / "full.npy"
    data = np.load(source, mmap_mode="r", allow_pickle=False)
    axis = {"axial": 0, "coronal": 1, "sagital": 2}[plane]
    if index < 0 or index >= data.shape[axis]:
        raise HTTPException(400, "Índice fuera del volumen")
    if axis == 0:
        layer = data[index, :, :]
    elif axis == 1:
        layer = data[:, index, :]
    else:
        layer = data[:, :, index]
    low, high = meta["intensity_window"]
    scaled = np.nan_to_num(np.asarray(layer, dtype=np.float32), nan=low)
    scaled = (np.clip((scaled - low) / (high - low), 0, 1) * 255).astype(np.uint8)
    output = io.BytesIO()
    Image.fromarray(scaled, "L").save(output, format="PNG")
    return output.getvalue()
