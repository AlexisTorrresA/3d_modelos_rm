"""Report keyword extraction must preserve evidence, negation and uncertainty."""
import io
from pypdf import PdfWriter
from fastapi.testclient import TestClient
from pydicom.uid import generate_uid

from test_volume import create_dicom
from app import report_insights


def test_report_mentions_include_exact_evidence_and_no_geometry():
    pages=[
        (1,"Se describe lesión hipotalámica asociada a compromiso ventricular.\n"
           "Sin evidencia de tumor en cerebelo.\n"
           "Posible compromiso leptomeníngeo a lo largo de la médula espinal.\n"
           "Quinto par craneal sin alteraciones."),
    ]
    found=report_insights.detect_mentions(pages)
    assert found
    categories={x["category"] for x in found}
    assert {"lesion","ventricles","leptomeningeal","spinal_cord","cerebellum","nerves"}<=categories
    assert all(x["page"]==1 for x in found)
    assert all("position_mm" not in x and "mask" not in x for x in found)
    assert any(x["category"]=="lesion" and x["assertion"]=="mentioned" for x in found)
    assert any(x["category"]=="cerebellum" and x["assertion"]=="negated" for x in found)
    assert any(x["category"]=="leptomeningeal" and x["assertion"]=="uncertain" for x in found)


def test_report_upload_after_dicom_and_review_flow(tmp_path,monkeypatch):
    import app.storage as store
    import app.main as main
    monkeypatch.setattr(store,"DATA_DIR",tmp_path)
    client=TestClient(main.app)
    study_uid,series_uid=generate_uid(),generate_uid()
    files=[]
    for z in range(3):
        f=tmp_path / ("synthetic-"+str(z)+".dcm")
        create_dicom(f,study_uid,series_uid,z)
        files.append(("files",(f.name,f.read_bytes(),"application/dicom")))
    study=client.post("/api/studies",files=files).json()
    study_id=study["id"]
    initial=client.get("/api/studies/"+study_id+"/report/analysis").json()
    assert initial["status"]=="not_analyzed" and not initial["report_present"]
    writer=PdfWriter();writer.add_blank_page(width=500,height=500)
    buffer=io.BytesIO();writer.write(buffer)
    pdf=buffer.getvalue()
    uploaded=client.post("/api/studies/"+study_id+"/report",
        files={"file":("informe.pdf",pdf,"application/pdf")})
    assert uploaded.status_code==201,uploaded.text
    assert client.get("/api/studies/"+study_id).json()["has_report"] is True
    assert client.get("/api/studies/"+study_id+"/report").content==pdf
    no_text=client.post("/api/studies/"+study_id+"/report/analyze")
    assert no_text.status_code==200,no_text.text
    assert no_text.json()["status"]=="no_text"
    monkeypatch.setattr(report_insights,"extract_pdf_text",
        lambda _: [(1,"Lesión tumoral en región supraselar, posible compromiso del tronco encefálico.")])
    analyzed=client.post("/api/studies/"+study_id+"/report/analyze")
    assert analyzed.status_code==200,analyzed.text
    findings=analyzed.json()["findings"]
    assert any(x["category"]=="lesion" for x in findings)
    assert "source_sha256" in analyzed.json()
    item=next(x for x in findings if x["category"]=="lesion")
    confirmed=client.patch("/api/studies/"+study_id+"/report/findings/"+item["id"],
        json={"review_status":"confirmed"})
    assert confirmed.status_code==200,confirmed.text
    assert confirmed.json()["review_status"]=="confirmed"
    loaded=client.get("/api/studies/"+study_id+"/report/analysis").json()
    assert any(x["review_status"]=="confirmed" for x in loaded["findings"])
    invalid=client.patch("/api/studies/"+study_id+"/report/findings/"+item["id"],
        json={"review_status":"invalid"})
    assert invalid.status_code==400
