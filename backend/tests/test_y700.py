import io
import zipfile

from fastapi.testclient import TestClient
from pydicom.uid import generate_uid

from test_volume import create_dicom


def test_health_and_auth_required(monkeypatch):
    from app.main import app
    monkeypatch.setenv("APP_ENV","production")
    monkeypatch.setenv("RM3D_ADMIN_PASSWORD","test-administrator-secret-123")
    monkeypatch.setenv("RM3D_SESSION_KEY","test-session-secret-key-of-adequate-size-1234")
    client=TestClient(app,base_url="https://testserver")
    assert client.get("/health").status_code==200
    assert client.get("/api/studies").status_code==401
    assert client.post("/api/auth/login",json={"password":"wrong"}).status_code==401
    login=client.post("/api/auth/login",json={"password":"test-administrator-secret-123"})
    assert login.status_code==200
    assert client.get("/api/studies").status_code==200
    assert client.post("/api/auth/logout").status_code==200
    assert client.get("/api/studies").status_code==401


def test_chunked_study(tmp_path,monkeypatch):
    import app.storage as storage
    import app.uploads as uploads
    import app.main as main
    monkeypatch.delenv("APP_ENV",raising=False)
    monkeypatch.setattr(storage,"DATA_DIR",tmp_path)
    monkeypatch.setattr(uploads,"DATA_DIR",tmp_path)
    monkeypatch.setattr(uploads,"STAGING",tmp_path / "staging")
    uid1,uid2=generate_uid(),generate_uid()
    zipbuffer=io.BytesIO()
    with zipfile.ZipFile(zipbuffer,"w") as archive:
        for i in range(4):
            path=tmp_path / f"source{i}.dcm"
            create_dicom(path,uid1,uid2,i)
            archive.write(path,arcname=f"CD/images/{i}.dcm")
    data=zipbuffer.getvalue()
    client=TestClient(main.app)
    init=client.post("/api/uploads",json={"files":[{"name":"study.zip","size":len(data)}]})
    assert init.status_code==201,init.text
    upid=init.json()["upload_id"]
    part=client.put(f"/api/uploads/{upid}/files/0/chunks/0",content=data,headers={"Content-Type":"application/octet-stream"})
    assert part.status_code==200,part.text
    end=client.post(f"/api/uploads/{upid}/complete")
    assert end.status_code==201,end.text
    assert end.json()["series_count"]==1
    assert len(client.get("/api/studies").json())==1
