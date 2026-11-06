import io
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.storage import extract_dicom_zip


def make_zip(path: Path, name: str, payload: bytes = b"sample"):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(name, payload)


@pytest.mark.parametrize("name", ["../escape.dcm", "/etc/passwd", "C:/fake.dcm", "dir/../../escape.dcm"])
def test_rejects_zip_traversal(tmp_path, name):
    path = tmp_path / "invalid.zip"
    folder = tmp_path / "dicom"
    folder.mkdir()
    make_zip(path, name)
    with pytest.raises(HTTPException) as error:
        extract_dicom_zip(path, folder)
    assert error.value.status_code == 400


def test_extracts_under_random_name(tmp_path):
    path = tmp_path / "images.zip"
    folder = tmp_path / "dicom"
    folder.mkdir()
    make_zip(path, "safe/image001.dcm", b"test dicom")
    assert extract_dicom_zip(path, folder) == 1
    names = list(folder.iterdir())
    assert len(names) == 1
    assert names[0].name != "image001.dcm"
    assert names[0].read_bytes() == b"test dicom"
