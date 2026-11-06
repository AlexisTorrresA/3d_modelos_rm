"""DICOM inventory and geometry-safe series loading."""
from collections import defaultdict
from pathlib import Path
from uuid import uuid4

import pydicom
import SimpleITK as sitk


def scan_series(dicom_dir: Path) -> tuple[list[dict], int]:
    """Inventory MR series without returning patient identifiers to clients."""
    series_map = defaultdict(list)
    details = {}
    valid = 0
    for path in dicom_dir.iterdir():
        if not path.is_file():
            continue
        try:
            ds = pydicom.dcmread(str(path), stop_before_pixels=True)
            uid = str(ds.get("SeriesInstanceUID", "")).strip()
            study_uid = str(ds.get("StudyInstanceUID", "")).strip()
            modality = str(ds.get("Modality", "")).upper()
            if not uid or not study_uid or modality != "MR":
                continue
        except (OSError, ValueError, pydicom.errors.InvalidDicomError):
            continue
        valid += 1
        key = (study_uid, uid)
        series_map[key].append(path.name)
        if key not in details:
            details[key] = {
                "number": str(ds.get("SeriesNumber", "—"))[:24],
                "description": str(ds.get("SeriesDescription", "RM sin descripción"))[:120],
                "modality": modality,
            }

    results = []
    for key, filenames in sorted(series_map.items(), key=lambda item: (details[item[0]]["number"], item[0])):
        results.append({
            "id": str(uuid4()),
            "study_uid": key[0],
            "uid": key[1],
            **details[key],
            "count": len(filenames),
            "filenames": filenames,
        })
    return results, valid


def find_series(study: dict, series_id: str) -> dict:
    for series in study["series"]:
        if series["id"] == series_id:
            return series
    from fastapi import HTTPException
    raise HTTPException(404, "Serie no encontrada")


def read_series(dicom_dir: Path, series: dict) -> sitk.Image:
    """Use GDCM geometry ordering, never lexicographic filenames."""
    names = list(sitk.ImageSeriesReader.GetGDCMSeriesFileNames(
        str(dicom_dir), series["uid"], False, False
    ))
    expected = set(series["filenames"])
    actual = {Path(name).name for name in names}
    if not names or actual != expected or len(names) != len(expected):
        raise ValueError("La serie tiene cortes faltantes, ambiguos o inconsistentes")
    reader = sitk.ImageSeriesReader()
    reader.SetFileNames(names)
    image = reader.Execute()
    if image.GetDimension() != 3 or min(image.GetSize()) < 2:
        raise ValueError("Esta serie no contiene un volumen 3D completo")
    if any(s <= 0 for s in image.GetSpacing()):
        raise ValueError("Espaciado espacial inválido")
    return image
