"""A synthetic patient-free mask must align with its source MRI grid."""
from pydicom.uid import generate_uid
import SimpleITK as sitk
from fastapi.testclient import TestClient

from test_volume import create_dicom

def test_nifti_mask_import_and_render(tmp_path,monkeypatch):
    import app.storage as store
    import app.main as main
    monkeypatch.setattr(store,"DATA_DIR",tmp_path)
    client=TestClient(main.app)
    uid,sid=generate_uid(),generate_uid()
    upload=[]
    for z in range(4):
        path=tmp_path/f"slice{z}.dcm"
        create_dicom(path,uid,sid,z)
        upload.append(("files",(path.name,path.read_bytes(),"application/dicom")))
    study=client.post("/api/studies",files=upload).json()
    ref=study["series"][0]["id"]
    meta=client.get(f"/api/studies/{study['id']}/series/{ref}/volume.json").json()
    mask=sitk.Image(meta["full_dimensions"],sitk.sitkUInt8)
    mask.SetOrigin(meta["full_origin"])
    mask.SetSpacing(meta["full_spacing"])
    mask.SetDirection(meta["full_direction"])
    mask.SetPixel(5,4,2,1)
    file=tmp_path/"mask.nii.gz"
    sitk.WriteImage(mask,str(file))
    resp=client.post(f"/api/studies/{study['id']}/masks",data={
        "series_id":ref,"category":"lesion","label":"Prueba sintética",
        "color":"#ff657e",
    },files={"file":("mask.nii.gz",file.read_bytes(),"application/gzip")})
    assert resp.status_code==201,resp.text
    mask_id=resp.json()["id"]
    assert resp.json()["voxels"]==1
    raw=client.get(f"/api/studies/{study['id']}/masks/{mask_id}/volume.raw")
    assert raw.status_code==200
    assert len(raw.content)==16*16*4
    assert sum(raw.content)==1
    listed=client.get(f"/api/studies/{study['id']}/masks").json()
    assert len(listed)==1
    assert client.delete(f"/api/studies/{study['id']}/masks/{mask_id}").status_code==204
    assert client.get(f"/api/studies/{study['id']}/masks").json()==[]
