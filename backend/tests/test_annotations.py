"""Synthetic marker tests: never use patient coordinates or images."""
from fastapi.testclient import TestClient
from pydicom.uid import generate_uid

from test_volume import create_dicom


def test_markers_remain_user_created(tmp_path,monkeypatch):
    import app.storage as storage
    import app.main as main
    import app.annotations as markers

    monkeypatch.setattr(storage,"DATA_DIR",tmp_path)
    uid,series=generate_uid(),generate_uid()
    files=[]
    for z in range(4):
        path=tmp_path / f"slice-{z}.dcm"
        create_dicom(path,uid,series,z)
        files.append(("files",(path.name,path.read_bytes(),"application/dicom")))
    client=TestClient(main.app)
    study=client.post("/api/studies",files=files).json()
    sid=study["id"]
    series_id=study["series"][0]["id"]
    meta=client.get(f"/api/studies/{sid}/series/{series_id}/volume.json").json()
    assert meta["full_origin"]==[0.0,0.0,0.0]
    assert len(meta["full_direction"])==9

    created=client.post(f"/api/studies/{sid}/markers",json={
        "series_id":series_id, "category":"lesion",
        "label":"Marcado manual de referencia","color":"#ff5a77",
        "radius_mm":4,"position_mm":[7.,9.,2.]
    })
    assert created.status_code==201,created.text
    assert len(client.get(f"/api/studies/{sid}/markers").json())==1
    deleted=client.delete(f"/api/studies/{sid}/markers/{created.json()['id']}")
    assert deleted.status_code==204
    assert client.get(f"/api/studies/{sid}/markers").json()==[]


def test_rejects_invalid_marker(tmp_path,monkeypatch):
    import app.storage as storage
    import app.main as main
    monkeypatch.setattr(storage,"DATA_DIR",tmp_path)
    client=TestClient(main.app)
    assert client.get("/api/studies/not-a-study/markers").status_code==404


def test_rejects_repeated_slice_positions(tmp_path):
    """DTI-like repeated positions must not be concatenated as one 3D stack."""
    import app.dicom_service as dicom
    uid,sid=generate_uid(),generate_uid()
    filenames=[]
    for i,z in enumerate([0,1,2,0,1,2]):
        path=tmp_path / f"diff-{i}.dcm"
        create_dicom(path,uid,sid,z)
        filenames.append(path.name)
    series={"uid":sid,"filenames":filenames}
    try:
        dicom.read_series(tmp_path,series)
    except ValueError as e:
        assert "posiciones" in str(e).lower()
    else:
        raise AssertionError("Diffusion-like repeat positions cannot become a 3D volume")
