import {useCallback,useEffect,useState} from 'react';
import {Activity,AlertTriangle,Box,Check,ChevronRight,Disc3,Download,FileText,FolderOpen,HardDrive,Layers,LoaderCircle,Scan,ShieldAlert,Trash2,UploadCloud} from 'lucide-react';
import VolumeViewer from './VolumeViewer.jsx';
import IntegratedStudio, {ColorPicker} from './IntegratedStudio.jsx';
import MaskControls from './MaskControls.jsx';
import ReportInsights from './ReportInsights.jsx';
import AnatomyLayers from './AnatomyLayers.jsx';
import PatientReconstruction from './PatientReconstruction.jsx';
import SegmentationStudio from './SegmentationStudio.jsx';
import {CATEGORY_OPTIONS, chooseAnatomical, isDiffusion, modalityHint, toPatient, toVoxel, geometryCompatible} from './geometry.js';

async function api(url,options){
 const r=await fetch(url,{cache:'no-store',...options});
 if(!r.ok){let msg='Error al procesar la solicitud';try{const data=await r.json();if(typeof data.detail==='string')msg=data.detail;}catch{}throw new Error(msg);}
 return r.status===204?null:r.json();
}
function seriesUrl(study,series,path){
 return '/api/studies/'+encodeURIComponent(study)+'/series/'+encodeURIComponent(series)+'/'+path;
}
function Slice({study,series,plane,title,count,meta,markers=[],marking=false,onMark}){
 const [index,setIndex]=useState(Math.floor((count-1)/2));
 const [failed,setFailed]=useState(false);
 useEffect(()=>{setIndex(Math.floor((count-1)/2));setFailed(false);},[series,count]);
 const src=seriesUrl(study,series,'slice')+'?plane='+plane+'&index='+index;
 const axis=plane==='axial'?2:plane==='coronal'?1:0;
 const width=plane==='sagital'?meta.full_dimensions[1]:meta.full_dimensions[0];
 const height=plane==='axial'?meta.full_dimensions[1]:meta.full_dimensions[2];
 const visible=markers.flatMap(m=>{
  const ijk=toVoxel(m.position_mm,meta);
  if(Math.abs(ijk[axis]-index)>0.7)return [];
  const x=plane==='sagital'?ijk[1]:ijk[0];
  const y=plane==='axial'?ijk[1]:ijk[2];
  return [{...m,x:100*x/width,y:100*y/height}];
 });
 function addMarker(event){
  if(!marking||!onMark)return;
  const rect=event.currentTarget.getBoundingClientRect();
  const x=Math.max(0,Math.min(width-1,Math.floor((event.clientX-rect.left)/rect.width*width)));
  const y=Math.max(0,Math.min(height-1,Math.floor((event.clientY-rect.top)/rect.height*height)));
  const ijk=plane==='axial'?[x,y,index]:plane==='coronal'?[x,index,y]:[index,x,y];
  onMark(toPatient(ijk,meta));
 }
 return <div className="slice">
  <div className="slice-label"><strong>{title}</strong><span>{index+1} / {count}</span></div>
  <div className="slice-image">
   {failed?<span>No se pudo abrir el corte</span>:
    <div className={'slice-image-frame '+(marking?'marking':'')}>
     <img src={src} alt={'Corte '+title} onError={()=>setFailed(true)} onClick={addMarker}/>
     {visible.map(m=><span key={m.id} className="slice-marker" title={m.label}
        style={{left:m.x+'%',top:m.y+'%',borderColor:m.color}} />)}
    </div>}
  </div>
  <input type="range" min="0" max={Math.max(0,count-1)} value={index} onChange={e=>{setIndex(Number(e.target.value));setFailed(false);}} aria-label={'Corte '+title}/>
 </div>;
}
function MarkerControls({markers,marking,setMarking,category,setCategory,color,setColor,label,setLabel,radius,setRadius,onDelete}){
 return <section className="panel marker-panel">
  <div className="marker-heading"><div><h3>Marcadores anatómicos con color</h3>
   <p className="muted small">Selecciona una categoría, activa el marcado y haz clic sobre un corte para ubicar una referencia en el modelo 3D.</p></div>
   <button type="button" className={marking?'mark-toggle active':'mark-toggle'} onClick={()=>setMarking(!marking)}>
    {marking?'● Marcado activado':'○ Activar marcado'}
   </button>
  </div>
  <div className="marker-fields">
   <label>Tipo de referencia
    <select value={category} onChange={e=>{
     const item=CATEGORY_OPTIONS.find(x=>x.id===e.target.value);
     setCategory(item.id);setColor(item.color);setLabel(item.label);
    }}>{CATEGORY_OPTIONS.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select>
   </label>
   <label>Color <input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
   <label>Nombre <input type="text" maxLength={70} value={label} onChange={e=>setLabel(e.target.value)} placeholder="Nombre de referencia"/></label>
   <label>Radio orientativo: {radius} mm
    <input type="range" min="1" max="20" step="1" value={radius} onChange={e=>setRadius(Number(e.target.value))}/>
   </label>
  </div>
  <p className="marker-disclaimer">Los puntos son esferas de referencia colocadas manualmente: no equivalen al contorno, tamaño ni diagnóstico de un tumor. Una segmentación precisa requiere máscaras validadas.</p>
  {markers.length>0&&<div className="marker-list">{markers.map(m=><div className="marker-row" key={m.id}>
    <span className="marker-dot" style={{backgroundColor:m.color}}/><span className="marker-name">{m.label}</span><small>radio {Number(m.radius_mm).toFixed(0)} mm</small>
    <button className="marker-delete" onClick={()=>onDelete(m.id)} type="button">Quitar</button>
  </div>)}</div>}
 </section>;
}
export default function App(){
 const [studies,setStudies]=useState([]);
 const [selected,setSelected]=useState(null);
 const [series,setSeries]=useState(null);
 const [meta,setMeta]=useState(null);
 const [files,setFiles]=useState([]);
 const [report,setReport]=useState(null);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [mode,setMode]=useState('patient');
 const [singleColor,setSingleColor]=useState('#e1e7ee');
 const [singleOpacity,setSingleOpacity]=useState(0.8);
 const [markers,setMarkers]=useState([]);
 const [masks,setMasks]=useState([]);
 const [reportAnalysis,setReportAnalysis]=useState(null);
 const [visibleCategories,setVisibleCategories]=useState({});
 const [marking,setMarking]=useState(false);
 const [markerCategory,setMarkerCategory]=useState('lesion');
 const [markerColor,setMarkerColor]=useState('#ff657e');
 const [markerLabel,setMarkerLabel]=useState('Lesión / tumor (manual)');
 const [markerRadius,setMarkerRadius]=useState(5);
 const refresh=useCallback(async()=>{const data=await api('/api/studies');setStudies(data);return data;},[]);
 useEffect(()=>{refresh().then(data=>{if(data.length)setSelected(data[0]);}).catch(e=>setError(e.message));},[refresh]);
 useEffect(()=>{
  setSeries(selected?.series?.[0]?.id||null);setMarking(false);setMarkers([]);setMasks([]);
  setReportAnalysis(null);setVisibleCategories({});
 },[selected?.id]);
 useEffect(()=>{
  let alive=true;
  if(!selected)return;
  api('/api/studies/'+selected.id+'/markers')
   .then(items=>{if(alive)setMarkers(items);})
   .catch(e=>{if(alive)setError(e.message);});
  api('/api/studies/'+selected.id+'/masks')
   .then(items=>{if(alive)setMasks(items.map(m=>({...m,opacity:.8,visible:true})));})
   .catch(e=>{if(alive)setError(e.message);});
  api('/api/studies/'+selected.id+'/report/analysis')
   .then(result=>{if(alive)setReportAnalysis(result);})
   .catch(e=>{if(alive)setError(e.message);});
  return()=>{alive=false;};
 },[selected?.id]);
 function selectMode(value){
  setMode(value);setMarking(false);
  if(value==='integral'&&selected){
   const ideal=chooseAnatomical(selected.series);
   if(isDiffusion(selected.series.find(x=>x.id===series)?.description))setSeries(ideal?.id||series);
  }
 }
 async function markPoint(position){
  if(!selected||!series||!markerLabel.trim())return;
  try{
   const item=await api('/api/studies/'+selected.id+'/markers',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({series_id:series,category:markerCategory,
      label:markerLabel.trim(),color:markerColor,
      radius_mm:markerRadius,position_mm:position}),
   });
   setMarkers(current=>[...current,item]);
   setNotice('Marcador manual añadido. Su esfera es orientativa, no una segmentación.');
  }catch(e){setError(e.message);}
 }
 async function deleteMarker(markerId){
  if(!selected)return;
  try{
   await api('/api/studies/'+selected.id+'/markers/'+markerId,{method:'DELETE'});
   setMarkers(current=>current.filter(x=>x.id!==markerId));
  }catch(e){setError(e.message);}
 }

 useEffect(()=>{
  let active=true;
  setMeta(null);
  if(!selected||!series||mode==='patient')return;
  setLoading(true);setError('');
  api(seriesUrl(selected.id,series,'volume.json')).then(d=>{if(active)setMeta(d);})
   .catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[selected?.id,series,mode]);
 async function upload(e){
  e.preventDefault();if(!files.length||busy)return;
  setBusy(true);setError('');setNotice('Preparando subida por bloques…');
  try{
   const create=await api('/api/uploads',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({files:files.map(f=>({name:f.name,size:f.size})),
       report:report?{name:report.name,size:report.size}:null})});
   const uploadId=create.upload_id;
   const all=[...files,...(report?[report]:[])];
   const total=all.reduce((sum,f)=>sum+f.size,0);
   let sent=0;
   for(let i=0;i<all.length;i++){
    const file=all[i];
    const partSize=create.chunk_bytes;
    for(let offset=0,index=0;offset<file.size;offset+=partSize,index++){
     const fragment=file.slice(offset,Math.min(offset+partSize,file.size));
     const response=await fetch('/api/uploads/'+uploadId+'/files/'+i+'/chunks/'+index,{
       method:'PUT',body:fragment,headers:{'Content-Type':'application/octet-stream'}
     });
     if(!response.ok){let detail='Error enviando los archivos';try{detail=(await response.json()).detail||detail;}catch{}throw new Error(detail);}
     sent+=fragment.size;
     setNotice('Subiendo estudio: '+Math.min(100,Math.round(sent/total*100))+'%');
    }
   }
   setNotice('Analizando los DICOM y guardando el estudio en PostgreSQL…');
   const study=await api('/api/uploads/'+uploadId+'/complete',{method:'POST'});
   await refresh();setSelected(study);setFiles([]);setReport(null);
   document.getElementById('upload-form').reset();
   setNotice('Estudio importado correctamente. Selecciona una serie.');
  }catch(err){setNotice('');setError(err.message);}
  finally{setBusy(false);}
 }
 async function remove(){
  if(!selected||busy||!window.confirm('¿Eliminar definitivamente este estudio, los DICOM y el informe?'))return;
  setBusy(true);
  try{await api('/api/studies/'+selected.id,{method:'DELETE'});const all=await refresh();setSelected(all[0]||null);setNotice('Estudio eliminado.');}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const chosen=selected?.series?.find(s=>s.id===series);
 const renderedMarkers=markers.filter(m=>visibleCategories[m.category]!==false);
 const reportUpdated=()=>{setSelected(current=>current?{...current,has_report:true}:current);
  setStudies(current=>current.map(s=>s.id===selected?.id?{...s,has_report:true}:s));};
 const layersMasks=meta&&selected?masks.filter(m=>geometryCompatible(meta,m.preview_meta)).map(m=>({
  ...m,meta:m.preview_meta,
  url:'/api/studies/'+selected.id+'/masks/'+m.id+'/volume.raw',
  opacity:m.opacity??.8,visible:m.visible!==false && visibleCategories[m.category]!==false,
 })):[];
 return <div className="layout">
  <aside className="sidebar">
   <div className="brand"><div className="logo"><Activity size={22}/></div><div><strong>RM Studio</strong><small>Modelos médicos 3D</small></div></div>
   <div className="side-title">ESTUDIOS IMPORTADOS <span>{studies.length}</span></div>
   <div className="study-list">{studies.map(s=><button className={'study '+(selected?.id===s.id?'active':'')} key={s.id} onClick={()=>setSelected(s)}>
    <Disc3 size={19}/><span><strong>Estudio de RM</strong><small>{new Date(s.created_at).toLocaleDateString('es-CL')} · {s.series_count} series</small></span><ChevronRight size={15}/>
   </button>)}{!studies.length&&<p className="muted small">Aún no hay estudios cargados.</p>}</div>
   <div className="side-warning"><ShieldAlert size={19}/><span>Prototipo exploratorio. No apto para diagnóstico médico.</span></div>
  </aside>
  <main className="main">
   <header className="top"><div><span className="eyebrow">RESONANCIA MAGNÉTICA · VISOR 3D</span><h1>RM Studio 3D</h1><p>Explora cada secuencia o combina capas anatómicas compatibles en un mismo espacio.</p></div><span className="local"><span className="green-dot"/>Estudio privado</span></header>
   {error&&<div className="alert error"><AlertTriangle size={18}/>{error}<button onClick={()=>setError('')}>Cerrar</button></div>}
   {notice&&<div className="alert notice"><Check size={18}/>{notice}<button onClick={()=>setNotice('')}>Cerrar</button></div>}
   <section className="panel upload">
    <div className="section-heading"><div className="heading-icon"><UploadCloud size={23}/></div><div><h2>Importar un estudio</h2><p>Sube los DICOM del CD e incluye el informe radiológico PDF si lo tienes.</p></div></div>
    <form id="upload-form" onSubmit={upload}>
     <div className="upload-grid">
      <label className="drop"><FolderOpen size={26}/><strong>ZIP del CD o imágenes DICOM</strong><span>Un archivo ZIP o varios .dcm / .ima</span>
       <input type="file" accept=".zip,.dcm,.ima,application/dicom" multiple onChange={e=>setFiles(Array.from(e.target.files||[]))}/>
       <em>{files.length?(files.length===1?files[0].name:files.length+' archivos seleccionados'):'Elegir archivos'}</em>
      </label>
      <label className="drop"><FileText size={26}/><strong>Informe radiológico (opcional)</strong><span>Archivo PDF del informe original</span>
       <input type="file" accept=".pdf,application/pdf" onChange={e=>setReport(e.target.files?.[0]||null)}/>
       <em>{report?.name||'Adjuntar PDF'}</em>
      </label>
     </div>
     <div className="upload-actions"><span><HardDrive size={16}/> Se conservan los DICOM originales en este equipo.</span>
      <button className="primary" type="submit" disabled={!files.length||busy}>{busy?<LoaderCircle className="spin" size={18}/>:<UploadCloud size={18}/>} {busy?'Importando…':'Cargar estudio'}</button>
     </div>
    </form>
   </section>
   {!selected?<section className="panel empty"><Scan size={46}/><h2>Tu primer estudio comienza aquí</h2><p>Sube el ZIP del CD para explorar los cortes y el volumen tridimensional.</p><small>La versión inicial no segmenta lesiones automáticamente.</small></section>:
   <>
    <div className="study-heading"><div><span className="eyebrow">ESTUDIO SELECCIONADO</span><h2>Estudio RM <small>#{selected.id.slice(0,8)}</small></h2><p>{selected.file_count} imágenes · {selected.series_count} series · {new Date(selected.created_at).toLocaleString('es-CL')}</p></div>
     <div className="study-actions">{selected.has_report&&<a className="secondary" href={'/api/studies/'+selected.id+'/report'}><Download size={16}/> Informe PDF</a>}
      <button className="secondary danger" onClick={remove} disabled={busy}><Trash2 size={16}/> Eliminar</button></div>
    </div>
    <div className="view-modes" role="group" aria-label="Tipo de modelo">
     <button type="button" className={mode==='individual'?'mode active':'mode'} onClick={()=>selectMode('individual')}>Por secuencia</button>
     <button type="button" className={mode==='integral'?'mode active':'mode'} onClick={()=>selectMode('integral')}>Modelo integral · capas</button>
     <button type="button" className={mode==='patient'?'mode active':'mode'} onClick={()=>selectMode('patient')}>Modelo completo · RM real</button>
     <button type="button" className={mode==='segmentation'?'mode active':'mode'} onClick={()=>selectMode('segmentation')}>
      <Scan size={15}/> Segmentación precisa desde cortes
     </button>
     <span>La nueva vista utiliza los cortes reales. Un atlas independiente se ofrece solo para comparar anatomía.</span>
    </div>
    {(mode==='integral'||mode==='patient'||mode==='segmentation')&&<ReportInsights study={selected} masks={masks}
      analysis={reportAnalysis} onAnalysis={setReportAnalysis} onReportUpload={reportUpdated}/>}
    {mode==='patient'&&<PatientReconstruction study={selected} masks={masks}
      markers={renderedMarkers} analysis={reportAnalysis}/>}
    {mode==='segmentation'&&<SegmentationStudio study={selected} masks={masks} setMasks={setMasks}
      markers={markers} setMarkers={setMarkers} reportAnalysis={reportAnalysis}/>}
    {mode!=='patient'&&mode!=='segmentation'&&<div className="viewer-layout">
     <div className="panel series-panel"><h3><Layers size={18}/> Series disponibles</h3><p className="muted small">{mode==='integral'?'Elige la serie principal del modelo.':'Elige una secuencia para reconstruirla.'}</p>
      <div className="series-list">{selected.series.map(s=><button className={'series '+(series===s.id?'active':'')} key={s.id} onClick={()=>setSeries(s.id)}>
       <span className="series-no">{s.number}</span><span><strong>{s.description}</strong><small>{s.modality} · {s.count} imágenes</small><small className="series-role">{modalityHint(s.description)}</small></span>{series===s.id?<Check size={15}/>:<ChevronRight size={15}/>}
      </button>)}</div>
     </div>
     <div className="viewers">
      {mode==='integral'&&meta&&<AnatomyLayers study={selected} meta={meta}
       masks={masks} setMasks={setMasks} markers={markers}
       analysis={reportAnalysis} visibility={visibleCategories} onVisibility={setVisibleCategories}/>}
      {mode==='integral'&&meta?
       <IntegratedStudio study={selected} series={series} meta={meta} markers={renderedMarkers} masks={layersMasks}/>:
       <section className="panel viewer">
        <div className="viewer-heading"><div><h3><Box size={20}/> {mode==='integral'?'Selecciona una serie anatómica':'Volumen tridimensional por secuencia'}</h3><p>{chosen?.description||'Selecciona una secuencia'}</p></div>{meta&&<span className="resolution">{meta.dimensions.join(' × ')} vóxeles</span>}</div>
        {mode==='individual'&&<div className="single-colors"><label>Color de los vóxeles visibles <ColorPicker value={singleColor} onChange={setSingleColor}/></label>
         <label>Opacidad <input type="range" min="0" max="100" value={Math.round(singleOpacity*100)} onChange={e=>setSingleOpacity(Number(e.target.value)/100)}/></label></div>}
        {loading?<div className="placeholder"><LoaderCircle className="spin" size={30}/>Preparando volumen…</div>:meta?
         <VolumeViewer layers={[{id:series,url:seriesUrl(selected.id,series,'volume.raw'),meta,color:singleColor,opacity:singleOpacity,visible:true}]} markers={renderedMarkers} masks={layersMasks}/>:
         <div className="placeholder"><Scan size={35}/>Selecciona una serie 3D compatible</div>}
        {meta&&<div className="technical"><span>Spacing original: {meta.full_spacing.map(v=>v.toFixed(2)).join(' / ')} mm</span><span>Dimensiones originales: {meta.full_dimensions.join(' × ')}</span><span>Vista 3D: {meta.preview_downsample_factors.some(x=>x>1)?'reducida':'sin reducción espacial'}</span></div>}
       </section>}
      {meta&&<section className="panel slices"><h3><Scan size={18}/> Cortes del volumen</h3><p className="muted small">Cortes por eje del volumen; no equivalen necesariamente a planos anatómicos canónicos.</p>
       <div className="slice-grid"><Slice key={series+'-z'} title="Eje Z" plane="axial" count={meta.full_dimensions[2]} study={selected.id} series={series} meta={meta} markers={renderedMarkers} marking={marking} onMark={markPoint}/>
        <Slice key={series+'-y'} title="Eje Y" plane="coronal" count={meta.full_dimensions[1]} study={selected.id} series={series} meta={meta} markers={renderedMarkers} marking={marking} onMark={markPoint}/>
        <Slice key={series+'-x'} title="Eje X" plane="sagital" count={meta.full_dimensions[0]} study={selected.id} series={series} meta={meta} markers={renderedMarkers} marking={marking} onMark={markPoint}/>
       </div></section>}
      {meta&&<MarkerControls markers={markers} marking={marking} setMarking={setMarking}
       category={markerCategory} setCategory={setMarkerCategory} color={markerColor} setColor={setMarkerColor}
       label={markerLabel} setLabel={setMarkerLabel} radius={markerRadius} setRadius={setMarkerRadius} onDelete={deleteMarker}/>}
      {meta&&<MaskControls study={selected} series={series} meta={meta} masks={masks} setMasks={setMasks}/>}
     </div>
    </div>}
   </>}
   <footer><AlertTriangle size={17}/> Las máscaras y mallas son herramientas experimentales que requieren revisión. La visualización con colores no constituye segmentación automática ni diagnóstico. Los marcadores son referencias manuales, no mediciones de tumores. Para unir series con precisión se necesita registro y validación clínica.</footer>
  </main>
 </div>;
}
