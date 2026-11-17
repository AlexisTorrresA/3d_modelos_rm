"""Synthetic-only tests for 3-plane segmentation, revisions and mesh export."""
import io

import numpy as np
from PIL import Image
from fastapi.testclient import TestClient
from pydicom.uid import generate_uid

from test_volume import create_dicom


def test_three_plane_mask_editor_and_exports(tmp_path,monkeypatch):
    import app.storage as storage
    import app.main as main
    monkeypatch.setattr(storage,"DATA_DIR",tmp_path)
    uid,sid=generate_uid(),generate_uid()
    files=[]
    for z in range(5):
        source=tmp_path/f"sample-{z}.dcm"
        create_dicom(source,uid,sid,z)
        files.append(("files",(source.name,source.read_bytes(),"application/dicom")))
    client=TestClient(main.app)
    s=client.post("/api/studies",files=files)
    assert s.status_code==201,s.text
    study=s.json()["id"]
    series=s.json()["series"][0]["id"]
    start="/api/studies/"+study+"/segmentation/masks"
    created=client.post(start,json={
        "series_id":series,"category":"lesion",
        "label":"Tumor manual sin validar","color":"#ff6677",
    })
    assert created.status_code==201,created.text
    mask=created.json()["id"]
    assert created.json()["source_type"]=="manual_editable"
    assert created.json()["voxels"]==0
    base=start+"/"+mask
    assert client.get("/api/studies/"+study+"/masks").json()[0]["revision"]==1

    painted=client.post(base+"/paint",json={
        "plane":"axial","index":1,"tool":"brush",
        "points":[[6,6],[10,10]],"radius":2,"expected_revision":1,
    })
    assert painted.status_code==200,painted.text
    assert painted.json()["revision"]==2
    assert painted.json()["voxels"]>10
    mismatch=client.post(base+"/paint",json={
        "plane":"axial","index":1,"tool":"brush","points":[[2,2]],
        "expected_revision":1,
    })
    assert mismatch.status_code==409

    coronal=client.post(base+"/paint",json={
        "plane":"coronal","index":8,"tool":"polygon",
        "points":[[6,1],[9,1],[9,3],[6,3]],"expected_revision":2,
    })
    assert coronal.status_code==200,coronal.text
    sagittal=client.post(base+"/paint",json={
        "plane":"sagital","index":7,"tool":"erase",
        "points":[[7,3]],"radius":1,"expected_revision":3,
    })
    assert sagittal.status_code==200,sagittal.text

    image=client.get(base+"/slice?plane=axial&index=1")
    assert image.status_code==200,image.text
    png=Image.open(io.BytesIO(image.content))
    assert png.mode=="RGBA"
    assert png.size==(16,16)
    assert np.any(np.asarray(png)[:,:,3]>0)
    for plane,index,size in [("coronal",8,(16,5)),("sagital",7,(16,5))]:
        found=client.get(base+f"/slice?plane={plane}&index={index}")
        assert found.status_code==200,found.text
        assert Image.open(io.BytesIO(found.content)).size==size

    save=client.get(base+"/export.nii.gz")
    assert save.status_code==200 and len(save.content)>50
    mesh=client.get(base+"/mesh.glb")
    assert mesh.status_code==200,mesh.text[:250] if mesh.status_code!=200 else ""
    assert mesh.content[:4]==b"glTF"
    stl=client.get(base+"/mesh.stl")
    assert stl.status_code==200,stl.text[:200] if stl.status_code!=200 else ""
    obj=client.get(base+"/mesh.obj")
    assert obj.status_code==200 and b"\nv " in b"\n"+obj.content
    versions=client.get(base+"/history")
    assert versions.status_code==200
    assert versions.json()["revision"]==4
    assert len(versions.json()["snapshots"])==3
    undo=client.post(base+"/restore",json={"revision":2})
    assert undo.status_code==200,undo.text
    assert undo.json()["revision"]==5
    assert client.get(base+"/history").json()["revision"]==5
    bad_plane=client.post(base+"/paint",json={
        "plane":"invalid","index":0,"tool":"brush","points":[[2,2]],
    })
    assert bad_plane.status_code==422
    duplicate=client.post(base+"/duplicate",json={})
    assert duplicate.status_code==201,duplicate.text
    assert duplicate.json()["source_type"]=="manual_editable"
    assert duplicate.json()["source_mask_id"]==mask


def test_interpolation_region_growing_and_preservation():
    from app.segmentation import Edit2D,Interpolate2D,paint_slice,interpolate_slice
    volume=np.zeros((8,32,32),dtype=np.uint8)
    paint_slice(volume,Edit2D(
        plane="axial",index=1,tool="polygon",
        points=[(7,8),(20,8),(20,20),(7,20)],
    ))
    paint_slice(volume,Edit2D(
        plane="axial",index=6,tool="polygon",
        points=[(9,10),(19,10),(19,19),(9,19)],
    ))
    result=interpolate_slice(volume,Interpolate2D(plane="axial",start=1,end=6))
    assert all(np.any(result[z]) for z in range(1,7))
    assert not np.any(result[0])
    assert not np.any(result[7])
    from app.segmentation import grow_slice,Grow2D
    image=np.zeros((8,32,32),dtype=np.float32)
    image[3,12:20,12:20]=50
    empty=np.zeros_like(volume)
    grown=grow_slice(empty,image,Grow2D(
        plane="axial",index=3,seed=(16,16),radius=12,tolerance=8
    ))
    assert grown[3,16,16]==1
    assert grown[3,1,1]==0
    assert grown.sum()<300
