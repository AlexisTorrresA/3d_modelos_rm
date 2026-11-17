"""Local evidence-linked extraction of *mentions* from medical reports.

No patient text is sent externally. Text matches are not clinical diagnoses,
anatomical coordinates, segmentations or evidence of a present tumor.
"""
import hashlib
import io
import json
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, File, UploadFile
from pydantic import BaseModel
from pypdf import PdfReader

from . import database
from .storage import load_study, study_path, MAX_REPORT_BYTES

router = APIRouter()
CATEGORY_PATTERNS = {
    "lesion": ("Lesión / tumor", "#ff657e",
        r"\b(?:tumor(?:al|ales|es)?|lesi[oó]n(?:es)?|masa(?:s)?|neoplas\w*|n[oó]dulo(?:s)?)\b"),
    "leptomeningeal": ("Meninges / diseminación", "#ec9dde",
        r"\b(?:leptomen[ií]ng\w*|men[ií]ng\w*|pial(?:es)?|subaracnoide\w*|diseminaci[oó]n)\b"),
    "ventricles": ("Sistema ventricular", "#68c7f5",
        r"\b(?:ventr[ií]cul\w*|hidrocefali\w*|acueducto)\b"),
    "brainstem": ("Tronco encefálico", "#54d4a4",
        r"\b(?:tronco(?:\s+encef[aá]lico)?|mesenc[eé]falo|protuberancia|bulbo\s+raqu[ií]deo)\b"),
    "cerebellum": ("Cerebelo", "#ffb37b",
        r"\b(?:cerebel\w*|vermis)\b"),
    "spinal_cord": ("Médula / región espinal", "#f4d576",
        r"\b(?:m[eé]dula\s+espinal|cord[oó]n\s+medular|canal\s+raqu[ií]deo|raquis|espinal\w*)\b"),
    "nerves": ("Nervios / tractos", "#ab9cff",
        r"\b(?:nervios?\s+(?:craneales|[oó]pticos?|faciales?|trig[eé]minos?)|"
        r"(?:par\s+craneal|pares\s+craneales)|tractos?\s+(?:[oó]pticos?|nerviosos?)|quiasma\s+[oó]ptico)\b"),
    "vessels": ("Vasos sanguíneos", "#ee96b9",
        r"\b(?:arteri\w*|venas?|venoso\w*|venosa\w*|vascular\w*|vasos?\s+sangu[ií]neos?)\b"),
    "brain": ("Cerebro / parénquima", "#f3d1a9",
        r"\b(?:cerebro|par[eé]nquima\s+(?:cerebral|encef[aá]lico)|"
        r"hemisferios?\s+cerebral(?:es)?|corteza\s+cerebral)\b"),
}
PATTERNS = {k: re.compile(p, re.IGNORECASE) for k, (_, _, p) in CATEGORY_PATTERNS.items()}
NEG = re.compile(r"\b(?:sin|no\s+se\s+(?:observa|identifica|evidencia|detecta)|"
                 r"ausencia\s+de|descarta(?:da|do)?|negativ[oa]\s+para|libre\s+de)\b",re.I)
UNCERTAIN = re.compile(r"\b(?:posible|probable|sugestiv[oa]|sospech\w*|podr[ií]a|"
                       r"compatible\s+con|a\s+descartar|no\s+se\s+descarta)\b",re.I)
MAX_PAGES = 60
MAX_FINDINGS = 60
REGIONS = {
    "hipotálamo":r"\bhipotal[aá]m\w*",
    "región supraselar":r"\bsuprasel\w*",
    "fosa posterior":r"\bfosa\s+posterior\b",
    "región pineal":r"\bpineal\b",
    "cerebelo":r"\bcerebel\w*",
    "tronco encefálico":r"\btronco(?:\s+encef[aá]lico)?\b",
    "médula espinal":r"\bm[eé]dula\s+espinal\b",
    "región espinal":r"\bespinal\w*\b",
    "ventrículos":r"\bventr[ií]cul\w*",
    "tálamo":r"\bt[aá]lam\w*",
    "nervio óptico":r"\b(?:nervios?\s+[oó]pticos?|quiasma\s+[oó]ptico)\b",
    "lóbulos frontales":r"\bfrontal\w*",
    "lóbulos temporales":r"\btemporal\w*",
}
REGION_RX={k:re.compile(v,re.I) for k,v in REGIONS.items()}



def extract_pdf_text(content: bytes):
    if not content.startswith(b"%PDF-"):
        raise HTTPException(400,"El archivo no parece un PDF válido")
    try:
        reader=PdfReader(io.BytesIO(content),strict=False)
        if reader.is_encrypted:
            raise HTTPException(422,"El PDF está cifrado")
        if len(reader.pages)>MAX_PAGES:
            raise HTTPException(413,"Informe demasiado extenso (máximo 60 páginas)")
        return [(i,(page.extract_text() or "")[:25000])
                for i,page in enumerate(reader.pages,start=1)]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422,"No se pudo extraer texto del PDF") from exc



def ocr_scanned_pdf(content:bytes, page_count:int)->list[tuple[int,str]]:
    """Local fallback for image-only reports. No network or patient logging.

    Keep OCR bounded to avoid large PDF CPU abuse. The extracted words are
    unverified: OCR errors can change negations, measurements or names.
    """
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    if not (shutil.which("pdftoppm") and shutil.which("tesseract")):
        return []
    result=[]
    pages=min(page_count,12)
    with tempfile.TemporaryDirectory(prefix="rm-report-") as folder:
        folder=Path(folder)
        source=folder/"input.pdf"
        source.write_bytes(content)
        for page in range(1,pages+1):
            target=folder/"rendered"
            try:
                subprocess.run([
                    "pdftoppm","-f",str(page),"-l",str(page),
                    "-singlefile","-r","150","-gray","-png",
                    str(source),str(target)
                ],timeout=40,check=True,capture_output=True)
                image=target.with_suffix(".png")
                ocr=subprocess.run([
                    "tesseract",str(image),"stdout","-l","spa+eng",
                    "--psm","6"
                ],timeout=45,check=True,capture_output=True,text=True)
                result.append((page,ocr.stdout[:25000]))
                image.unlink(missing_ok=True)
            except (subprocess.TimeoutExpired,subprocess.CalledProcessError,OSError):
                result.append((page,""))
    return result


def detect_mentions(pages: list[tuple[int,str]]) -> list[dict]:
    results=[]
    seen=set()
    for page_number,content in pages:
        for sentence in re.split(r"(?<=[.;])\s+|\n+",content):
            text=re.sub(r"\s+"," ",sentence).strip()
            if not 8<=len(text)<=3000:
                continue
            for category,pattern in PATTERNS.items():
                match=pattern.search(text)
                if not match:
                    continue
                snippet=text[max(0,match.start()-110):min(len(text),match.end()+190)].strip()
                key=(category,re.sub(r"\W+","",snippet.lower())[:150])
                if key in seen:
                    continue
                seen.add(key)
                context_before=text[max(0,match.start()-65):match.start()]
                uncertain=bool(UNCERTAIN.search(text[max(0,match.start()-75):min(len(text),match.end()+50)]))
                # "no se descarta" indicates uncertainty, not an absent finding.
                negated=bool(NEG.search(context_before)) and not bool(
                    re.search(r"no\s+se\s+descarta",context_before,re.I)
                )
                locations=[name for name,pattern in REGION_RX.items() if pattern.search(text)]
                left_right=(
                    "derecha" if re.search(r"\bderech\w*",text,re.I) else
                    "izquierda" if re.search(r"\bizquierd\w*",text,re.I) else
                    "bilateral" if re.search(r"\bbilateral\w*",text,re.I) else None
                )
                label,color,_=CATEGORY_PATTERNS[category]
                results.append({
                    "id":str(uuid.uuid4()),"category":category,"label":label,"color":color,
                    "page":page_number,"evidence":snippet[:320],
                    "matched_text":match.group(0), "regions_in_text":locations[:5],
                    "laterality_in_text":left_right,
                    "assertion":"negated" if negated else ("uncertain" if uncertain else "mentioned"),
                    "review_status":"pending","source_type":"report_text","linked_mask_id":None,
                })
                if len(results)>=MAX_FINDINGS:
                    return results
    return results


def local_path(study_id):
    return study_path(study_id)/"report_analysis.json"


def load_analysis(study_id):
    if database.enabled():
        with database.connect() as conn:
            row=conn.execute("SELECT result FROM rm_report_analysis WHERE study_id=%s",(study_id,)).fetchone()
        return row[0] if row else None
    path=local_path(study_id)
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def save_analysis(study_id,result):
    if database.enabled():
        from psycopg.types.json import Jsonb
        with database.connect() as conn:
            conn.execute(
                """INSERT INTO rm_report_analysis(study_id,result) VALUES(%s,%s)
                   ON CONFLICT(study_id) DO UPDATE SET result=EXCLUDED.result""",
                (study_id,Jsonb(result))
            )
    else:
        local_path(study_id).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")


def info(study_id):
    study=load_study(study_id)
    stored=load_analysis(study_id)
    if stored:
        return {"report_present":bool(study.get("has_report")) ,**stored}
    return {
        "report_present":bool(study.get("has_report")),
        "status":"not_analyzed","pages":0,"findings":[],
        "method":"local_keyword_review",
        "notice":"Aún no se ha analizado el texto del informe",
    }


@router.get("/api/studies/{study_id}/report/analysis")
def get_analysis(study_id:str):
    return info(study_id)


@router.post("/api/studies/{study_id}/report/analyze")
def analyze(study_id:str):
    record=load_study(study_id)
    if not record.get("has_report"):
        raise HTTPException(404,"Este estudio no tiene informe PDF")
    content=(study_path(study_id)/"report.pdf").read_bytes()
    if len(content)>MAX_REPORT_BYTES:
        raise HTTPException(413,"Informe demasiado grande")
    pages=extract_pdf_text(content)
    text_len=sum(len(text.strip()) for _,text in pages)
    method="local_keyword_review"
    if text_len<30:
        recognized=ocr_scanned_pdf(content,len(pages))
        if recognized:
            pages=recognized
            text_len=sum(len(text.strip()) for _,text in pages)
            method="local_ocr_tesseract"
    result={
        "status":"analyzed" if text_len else "no_text",
        "method":method,
        "pages":len(pages),
        "analyzed_at":datetime.now(timezone.utc).isoformat(),
        "source_sha256":hashlib.sha256(content).hexdigest(),
        "findings":detect_mentions(pages) if text_len else [],
        "notice":("Menciones para revisión: no son diagnósticos, máscaras ni coordenadas. El OCR puede equivocarse, incluso al leer negaciones."
                  if text_len else
                  "El PDF no contiene texto extraíble; para un escaneo se necesita OCR local."),
    }
    save_analysis(study_id,result)
    return {"report_present":True,**result}


class Review(BaseModel):
    review_status:str
    linked_mask_id:str|None=None


@router.patch("/api/studies/{study_id}/report/findings/{finding_id}")
def review(study_id:str,finding_id:str,payload:Review):
    if payload.review_status not in ("pending","confirmed","dismissed"):
        raise HTTPException(400,"Estado de revisión inválido")
    result=info(study_id)
    if result["status"]!="analyzed":
        raise HTTPException(409,"Analiza el informe antes de revisar hallazgos")
    finding=next((f for f in result["findings"] if f["id"]==finding_id),None)
    if finding is None:
        raise HTTPException(404,"Hallazgo no encontrado")
    if finding["assertion"]=="negated" and payload.review_status=="confirmed":
        raise HTTPException(400,"Una mención negada no se puede confirmar automáticamente")
    if payload.linked_mask_id:
        try:uuid.UUID(payload.linked_mask_id)
        except ValueError:raise HTTPException(400,"Máscara inválida")
        from .masks import list_masks
        mask=next((m for m in list_masks(study_id) if m["id"]==payload.linked_mask_id),None)
        if mask is None or mask["category"]!=finding["category"]:
            raise HTTPException(400,"La máscara debe existir en este estudio y tener la misma categoría")
    finding["review_status"]=payload.review_status
    finding["linked_mask_id"]=payload.linked_mask_id
    save_analysis(study_id,{k:v for k,v in result.items() if k!="report_present"})
    return finding


@router.post("/api/studies/{study_id}/report",status_code=201)
async def upload_report(study_id:str,file:UploadFile=File(...)):
    record=load_study(study_id)
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400,"Adjunta un informe PDF")
    content=await file.read(MAX_REPORT_BYTES+1)
    await file.close()
    if len(content)>MAX_REPORT_BYTES:
        raise HTTPException(413,"Informe demasiado grande")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(400,"No parece un PDF válido")
    root=study_path(study_id)
    temp=root/"report.new"
    temp.write_bytes(content)
    try:
        if database.enabled():
            database.replace_report(study_id,content)
        temp.replace(root/"report.pdf")
        record["has_report"]=True
        (root/"study.json").write_text(json.dumps(record,ensure_ascii=False),encoding="utf-8")
        if not database.enabled():
            local_path(study_id).unlink(missing_ok=True)
    finally:
        temp.unlink(missing_ok=True)
    return {"report_present":True,"analysis":"not_analyzed"}
