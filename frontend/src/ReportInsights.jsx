import {useEffect,useState} from 'react';
import {FileText,UploadCloud,ScanText,ChevronDown,Check,MinusCircle,Link2,ShieldAlert} from 'lucide-react';
const base=(id)=>'/api/studies/'+encodeURIComponent(id)+'/report';
async function request(url,options){
 const res=await fetch(url,{cache:'no-store',...options});
 if(!res.ok){const body=await res.json().catch(()=>({}));throw new Error(body.detail||'Error al procesar solicitud');}
 return res.json();
}
const names={mentioned:'Mención textual',uncertain:'Redacción incierta',negated:'Negado en contexto'};
const reviews={pending:'Por revisar',confirmed:'Mención revisada',dismissed:'Descartada'};

export default function ReportInsights({study,masks=[],analysis,onAnalysis,onReportUpload}){
 const [document,setDocument]=useState(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [showNegated,setShowNegated]=useState(false);
 const [links,setLinks]=useState({});
 useEffect(()=>{setError('');setMessage('');setDocument(null);setLinks({});},[study?.id]);
 const findings=analysis?.findings||[];
 const shown=findings.filter(f=>showNegated||f.assertion!=='negated');
 async function upload(e){
  e.preventDefault();if(!document||busy)return;
  const form=e.currentTarget;
  setBusy(true);setError('');setMessage('');
  const body=new FormData();body.append('file',document);
  try{
   await request(base(study.id),{method:'POST',body});
   const result=await request(base(study.id)+'/analysis');
   onAnalysis(result);onReportUpload?.();
   setDocument(null);form.reset();
   setMessage('Informe guardado de manera privada. Usa Analizar informe para crear sugerencias.');
  }catch(err){setError(err.message);}finally{setBusy(false);}
 }
 async function analyze(){
  setBusy(true);setError('');setMessage('');
  try{
   const result=await request(base(study.id)+'/analyze',{method:'POST'});
   onAnalysis(result);
   setMessage(result.status==='no_text'?'El PDF no contiene texto seleccionable. Se requiere OCR local.':
      'Encontradas '+result.findings.length+' menciones: revisa cada evidencia.');
  }catch(err){setError(err.message);}finally{setBusy(false);}
 }
 async function review(item,status,mask_id=null){
  setBusy(true);setError('');
  try{
   const changed=await request(base(study.id)+'/findings/'+item.id,{
    method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({review_status:status,linked_mask_id:mask_id})
   });
   onAnalysis({...analysis,findings:analysis.findings.map(f=>f.id===changed.id?changed:f)});
  }catch(err){setError(err.message);}finally{setBusy(false);}
 }
 return <details className="panel report-insights" key={study.id}>
  <summary className="report-summary"><FileText size={20}/>
   <span><strong>Informe radiológico · hallazgos para revisar</strong>
    <small>{analysis?.status==='analyzed'?
      findings.length+' menciones textuales · ninguna implica una segmentación 3D':
      analysis?.report_present?'Informe PDF asociado · listo para analizar':
      'Adjunta o analiza un PDF para sugerir categorías de capas'}</small>
   </span><ChevronDown size={18} className="report-chevron"/>
  </summary>
  <div className="report-inside">
   <div className="report-actions">
    <form onSubmit={upload}>
     <label className="report-input"><UploadCloud size={15}/>
      {analysis?.report_present?'Reemplazar informe PDF':'Adjuntar informe PDF'}
      <input type="file" accept=".pdf,application/pdf" onChange={e=>setDocument(e.target.files?.[0]||null)} required/>
     </label>
     <button type="submit" className="secondary" disabled={!document||busy}>Guardar PDF</button>
    </form>
    <button type="button" className="secondary" disabled={!analysis?.report_present||busy} onClick={analyze}>
     <ScanText size={16}/>{analysis?.status==='analyzed'?'Reanalizar informe':'Analizar informe y sugerir capas'}
    </button>
    {analysis?.report_present&&<a className="secondary" href={base(study.id)}><FileText size={15}/> Abrir original</a>}
   </div>
   {error&&<div className="alert error" role="alert">{error}</div>}
   {message&&<div className="fusion-caution">{message}</div>}
   {analysis?.notice&&<p className="report-notice"><ShieldAlert size={15}/>{analysis.notice}</p>}
   {analysis?.status==='analyzed'&&<>
    <div className="report-filter">
     <span>Sin negación: <strong>{findings.filter(f=>f.assertion!=='negated').length}</strong></span>
     <span>Menciones negadas: <strong>{findings.filter(f=>f.assertion==='negated').length}</strong></span>
     <label><input type="checkbox" checked={showNegated} onChange={e=>setShowNegated(e.target.checked)}/> Mostrar menciones negadas</label>
    </div>
    {!shown.length&&<p className="muted small">No se encontraron menciones de las categorías previstas.</p>}
    <div className="report-findings">{shown.map(item=>{
     const available=masks.filter(m=>m.category===item.category);
     const current=item.linked_mask_id||'';
     return <div className="report-finding" key={item.id}>
      <div className="report-finding-head">
       <span className="report-color-dot" style={{background:item.color}}/>
       <strong>{item.label}</strong>
       <span className={'report-state '+item.assertion}>{names[item.assertion]}</span>
       <small>Página {item.page}</small>
      </div>
      <blockquote>{item.evidence}</blockquote>
      {!!item.regions_in_text?.length&&<div className="report-region">
       Regiones citadas en el mismo texto: {item.regions_in_text.join(' · ')}
       {item.laterality_in_text?' · Lateralidad mencionada: '+item.laterality_in_text:''}
       <small>Son palabras del informe, no una ubicación calculada en el 3D.</small>
      </div>}
      <div className="report-finding-actions">
       <small>{reviews[item.review_status]}</small>
       {item.assertion!=='negated'&&<button className="secondary" disabled={busy}
        onClick={()=>review(item,item.review_status==='confirmed'?'pending':'confirmed',current||null)}>
        <Check size={14}/>{item.review_status==='confirmed'?'Volver a pendiente':'He revisado esta mención'}
       </button>}
       <button className="secondary" disabled={busy}
        onClick={()=>review(item,item.review_status==='dismissed'?'pending':'dismissed',null)}>
        <MinusCircle size={14}/>{item.review_status==='dismissed'?'Restaurar':'Descartar'}
       </button>
      </div>
      {item.assertion!=='negated'&&item.review_status!=='dismissed'&&<div className="report-link-row">
       <label><Link2 size={14}/> Asociar una máscara del mismo tipo
        <select value={links[item.id]??current} onChange={e=>setLinks(p=>({...p,[item.id]:e.target.value}))}>
         <option value="">Sin máscara · no hay geometría 3D</option>
         {available.map(m=><option value={m.id} key={m.id}>{m.label}</option>)}
        </select>
       </label>
       <button className="secondary" disabled={busy||(links[item.id]??current)===current}
        onClick={()=>review(item,item.review_status,links[item.id]||null)}>Vincular</button>
      </div>}
      {current&&<small className="report-linked">Máscara vinculada: solo esta máscara aporta geometría 3D.</small>}
     </div>;
    })}</div>
   </>}
   <p className="report-privacy">Lectura privada en Y700. Clasifica fragmentos con palabras clave y requiere revisión; no interpreta ni segmenta lesiones automáticamente.</p>
  </div>
 </details>;
}