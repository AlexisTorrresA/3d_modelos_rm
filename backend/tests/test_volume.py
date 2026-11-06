"""Synthetic DICOM series; no real patient images in tests."""
from pathlib import Path
from uuid import uuid4

import numpy as np
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, MRImageStorage, generate_uid
from fastapi.testclient import TestClient


def create_dicom(path: Path, study_uid: str, series_uid: str, z: int):
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = MRImageStorage
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = MRImageStorage
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.PatientName = "Test^Synthetic"
    ds.PatientID = "TEST-ONLY"
    ds.StudyInstanceUID = study_uid
    ds.SeriesInstanceUID = series_uid
    ds.Modality = "MR"
    ds.SeriesDescription = "T1 test"
    ds.InstanceNumber = z + 1
    ds.ImagePositionPatient = [0, 0, float(z) * 2]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.PixelSpacing = [1.0, 1.0]
    ds.SliceThickness = 2.0
    ds.Rows, ds.Columns = 16, 16
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.PixelData = np.full((16, 16), z * 100 + 20, dtype="<u2").tobytes()
    pydicom.dcmwrite(str(path), ds, enforce_file_format=True)


def test_upload_series_and_slice(tmp_path, monkeypatch):
    import app.storage as store
    import app.main as main
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    study_uid, series_uid = generate_uid(), generate_uid()
    dicoms = []
    for z in range(4):
        file = tmp_path / f"{z}.dcm"
        create_dicom(file, study_uid, series_uid, z)
        dicoms.append(("files", (file.name, file.read_bytes(), "application/dicom")))
    client = TestClient(main.app)
    response = client.post("/api/studies", files=dicoms)
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["series_count"] == 1
    assert "PatientName" not in response.text
    study_id, series_id = payload["id"], payload["series"][0]["id"]
    meta = client.get(f"/api/studies/{study_id}/series/{series_id}/volume.json")
    assert meta.status_code == 200, meta.text
    assert meta.json()["full_dimensions"] == [16, 16, 4]
    raw = client.get(f"/api/studies/{study_id}/series/{series_id}/volume.raw")
    assert raw.status_code == 200
    assert len(raw.content) == 16 * 16 * 4
    slc = client.get(f"/api/studies/{study_id}/series/{series_id}/slice?plane=axial&index=1")
    assert slc.status_code == 200
    assert slc.headers["content-type"] == "image/png"
