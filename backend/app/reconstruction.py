"""Evidence-first MRI reconstruction plan: real DICOM slices, safe modality selection.

Keep every acquisition in the catalogue; do not concatenate diffusion gradients or
separate volumes. A matching DICOM frame of reference permits physical placement,
but does not by itself prove inter-scan registration or lesion identity.
"""
from __future__ import annotations
import hashlib
import io
import re
from pathlib import Path

import pydicom
from fastapi import APIRouter, HTTPException
from . import database
from .storage import load_study, study_path

router=APIRouter()

def study_record(study_id:str):
    if database.enabled():
        try:
            from uuid import UUID
            UUID(study_id)
        except (ValueError,TypeError):
            raise HTTPException(404,"Estudio no encontrado")
        with database.connect() as conn:
            row=conn.execute("SELECT payload FROM rm_studies WHERE id=%s",(study_id,)).fetchone()
        if row is None:raise HTTPException(404,"Estudio no encontrado")
        return row[0]
    return load_study(study_id)

def first_header(study_id:str,series:dict):
    if database.enabled():
        key='dicom/'+series["filenames"][0]
        with database.connect() as conn:
            # Get only a bounded prefix of the DICOM. The image payload never
            # enters the planning endpoint, and the database stays private.
            row=conn.execute(
              "SELECT substring(data from 1 for 131072) "
              "FROM rm_asset_chunks WHERE study_id=%s AND file_key=%s AND ordinal=0",
              (study_id,key),
            ).fetchone()
        if not row:return None
        content=bytes(row[0])
        return pydicom.dcmread(io.BytesIO(content),stop_before_pixels=True,force=True)
    path=study_path(study_id)/'dicom'/series["filenames"][0]
    return pydicom.dcmread(str(path),stop_before_pixels=True)

def classify(description:str,count:int):
    label=description.lower()
    if re.search(r'dti|dwi|adc|(^|[\W_])fa([\W_]|$)|diffus|dixon.*?iso|iso.?reg|reg.*dti',label):
        return 'diffusion'
    if re.search(r'sag\s*(cd|dl)|spine|spinal|cervic|lumbar|dorsal|medul|m[d]?ixon|thriv|tse_fino',label):
        return 'spine'
    if re.search(r'3d_brain|brain.*3d|t1w_3d|3d_tfe|mprage|flair|t1w_se|t2w_tse|ir\s*cor|swi',label):
        return 'brain'
    if re.search(r'e.?t1w|s.?t1w|b_ffe',label):
        return 'spine'
    return 'other'

def score(series:dict):
    name=series.get("description","").lower()
    n=series.get("count",0)
    rank=0
    if "3d_brain" in name: rank+=180
    elif "3d_tfe" in name: rank+=115
    elif 'b_ffe_sag' in name:rank+=95
    if 't1w_3d_tfe' in name:rank+=65
    if 'gd' in name:rank+=22
    if 'dti' in name:rank-=500
    if re.search(r'(^|_)fa($|_)|adc',name):rank-=500
    return rank+min(n,400)*0.13

def build_plan(study_id:str,record:dict):
    rows=[]
    for s in record['series']:
        try:
            ds=first_header(study_id,s)
        except (ValueError,OSError,pydicom.errors.InvalidDicomError):
            ds=None
        frame=str(getattr(ds,'FrameOfReferenceUID','')).strip() if ds else ''
        orient=list(getattr(ds,'ImageOrientationPatient',[])) if ds else []
        pixel=list(getattr(ds,'PixelSpacing',[])) if ds else []
        category=classify(s.get('description',''),int(s.get('count',0)))
        rows.append({
            "id":s["id"],"number":s["number"],"description":s["description"],
            "images":s["count"],"region":category,
            "frame_reference":hashlib.sha256(frame.encode()).hexdigest()[:20] if frame else None,
            "rows":int(getattr(ds,"Rows",0)) if ds else None,
            "columns":int(getattr(ds,"Columns",0)) if ds else None,
            "pixel_spacing":[float(x) for x in pixel] if len(pixel)==2 else None,
            "orientation":[float(x) for x in orient] if len(orient)==6 else None,
            "score":score(s),
        })
    brain=sorted((x for x in rows if x["region"]=="brain"),key=lambda x:-x["score"])
    spine=sorted((x for x in rows if x["region"]=="spine"),key=lambda x:-x["score"])
    others=sorted((x for x in rows if x["region"]=="other"),key=lambda x:-x["score"])
    focus=brain[0] if brain else (others[0] if others else None)
    default_brain=[x["id"] for x in brain[:3]]
    default_spine=[x["id"] for x in spine[:2]]
    refs={x["frame_reference"] for x in rows if x["frame_reference"]}
    return {
        "study_id":study_id,
        "total_series":len(rows),
        "total_images":record.get("file_count",sum(x["images"] for x in rows)),
        "series":rows,
        "brain_base_id":focus["id"] if focus else None,
        "suggested_brain_ids":default_brain,
        "suggested_spine_ids":default_spine,
        "excluded_diffusion_ids":[x["id"] for x in rows if x["region"]=="diffusion"],
        "shared_frame":len(refs)==1,
        "frame_groups":len(refs),
        "notes":[
            "Los volúmenes se ubican según sus coordenadas físicas DICOM, sin apilar todas las imágenes.",
            "T1, T2, FLAIR y poscontraste contienen información complementaria; no se suman sus intensidades como una sola imagen.",
            "Si dos adquisiciones tienen movimiento o deformaciones, se necesita registro rígido/deformable revisado.",
            "La superficie por intensidad no es segmentación de tejido; los tumores solo tienen geometría 3D si existe máscara real.",
        ],
        "model_type":"patient_DICOM_volumes_not_atlas",
    }

@router.get("/api/studies/{study_id}/reconstruction/plan")
def get_plan(study_id:str):
    record=study_record(study_id)
    return build_plan(study_id,record)
