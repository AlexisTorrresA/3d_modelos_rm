import {useCallback,useEffect,useState} from 'react';
import {Activity,AlertTriangle,Box,Check,ChevronRight,Disc3,Download,FileText,FolderOpen,HardDrive,Layers,LoaderCircle,Scan,ShieldAlert,Trash2,UploadCloud} from 'lucide-react';
import VolumeViewer from './VolumeViewer.jsx';

async function api(url,options){
 const r=await fetch(url,{cache:'no-store',...options});
 if(!r.ok){let msg='Error al procesar la solicitud';try{const data=await r.json();if(typeof data.detail==='string')msg=data.detail;}catch{}throw new Error(msg);}
 return r.status===204?null:r.json();
}
function seriesUrl(study,series,path){
 return '/api/studies/'+encodeURIComponent(study)+'/series/'+encodeURIComponent(series)+'/'+path;
}
function Slice({study,series,plane,title,count}){
 const [index,setIndex]=useState(Math.floor((count-1)/2));
 const [failed,setFailed]=useState(false);
 const src=seriesUrl(study,series,'slice')+'?plane='+plane+'&index='+index;
 return <div className="slice">
  <div className="slice-label"><strong>{title}</strong><span>{index+1} / {count}</span></div>
  <div className="slice-image">{failed?<span>No se pudo abrir el corte</span>:<img src={src} alt={'Corte '+title} onError={()=>setFailed(true)}/>}</div>
  <input type="range" min="0" max={Math.max(0,count-1)} value={index} onChange={e=>{setIndex(Number(e.target.value));setFailed(false);}} aria-label={'Corte '+title}/>
 </div>;
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
 const refresh=useCallback(async()=>{const data=await api('/api/studies');setStudies(data);return data;},[]);
 useEffect(()=>{refresh().then(data=>{if(data.length)setSelected(data[0]);}).catch(e=>setError(e.message));},[refresh]);
 useEffect(()=>{setSeries(selected?.series?.[0]?.id||null);},[selected?.id]);
 useEffect(()=>{
  let active=true;
  setMeta(null);
  if(!selected||!series)return;
  setLoading(true);setError('');
  api(seriesUrl(selected.id,series,'volume.json')).then(d=>{if(active)setMeta(d);})
   .catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[selected?.id,series]);
 async function upload(e){
  e.preventDefault();if(!files.length||busy)return;
  setBusy(true);setError('');setNotice('Importando archivos DICOM…');
  try{
   const data=new FormData();for(const file of files)data.append('files',file);
   if(report)data.append('report',report);
   const study=await api('/api/studies',{method:'POST',body:data});
   await refresh();setSelected(study);setFiles([]);setReport(null);
   document.getElementById('upload-form').reset();
   setNotice('Estudio importado correctamente. Selecciona una serie.');
  }catch(e){setNotice('');setError(e.message);}
  finally{setBusy(false);}
 }
 async function remove(){
  if(!selected||busy||!window.confirm('¿Eliminar definitivamente este estudio, los DICOM y el informe?'))return;
  setBusy(true);
  try{await api('/api/studies/'+selected.id,{method:'DELETE'});const all=await refresh();setSelected(all[0]||null);setNotice('Estudio eliminado.');}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const chosen=selected?.series?.find(s=>s.id===series);
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
   <header className="top"><div><span className="eyebrow">VISOR MÉDICO LOCAL</span><h1>Resonancias en 3D</h1><p>Reconstruye volúmenes DICOM y explora sus cortes.</p></div><span className="local"><span className="green-dot"/>Datos locales</span></header>
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
    <div className="viewer-layout">
     <div className="panel series-panel"><h3><Layers size={18}/> Series disponibles</h3><p className="muted small">Elige una secuencia para reconstruirla.</p>
      <div className="series-list">{selected.series.map(s=><button className={'series '+(series===s.id?'active':'')} key={s.id} onClick={()=>setSeries(s.id)}>
       <span className="series-no">{s.number}</span><span><strong>{s.description}</strong><small>{s.modality} · {s.count} imágenes</small></span>{series===s.id?<Check size={15}/>:<ChevronRight size={15}/>}
      </button>)}</div>
     </div>
     <div className="viewers">
      <section className="panel viewer">
       <div className="viewer-heading"><div><h3><Box size={20}/> Volumen tridimensional</h3><p>{chosen?.description||'Selecciona una secuencia'}</p></div>{meta&&<span className="resolution">{meta.dimensions.join(' × ')} vóxeles</span>}</div>
       {loading?<div className="placeholder"><LoaderCircle className="spin" size={30}/>Preparando volumen…</div>:meta?<VolumeViewer key={series} url={seriesUrl(selected.id,series,'volume.raw')} meta={meta}/>:<div className="placeholder"><Scan size={35}/>Selecciona una serie 3D compatible</div>}
       {meta&&<div className="technical"><span>Spacing original: {meta.full_spacing.map(v=>v.toFixed(2)).join(' / ')} mm</span><span>Dimensiones originales: {meta.full_dimensions.join(' × ')}</span><span>Vista 3D: {meta.preview_downsample_factors.some(x=>x>1)?'reducida':'sin reducción espacial'}</span></div>}
      </section>
      {meta&&<section className="panel slices"><h3><Scan size={18}/> Cortes del volumen</h3><p className="muted small">Cortes por eje del volumen; no equivalen necesariamente a planos anatómicos canónicos.</p>
       <div className="slice-grid"><Slice key={series+'-z'} title="Eje Z" plane="axial" count={meta.full_dimensions[2]} study={selected.id} series={series}/>
        <Slice key={series+'-y'} title="Eje Y" plane="coronal" count={meta.full_dimensions[1]} study={selected.id} series={series}/>
        <Slice key={series+'-x'} title="Eje X" plane="sagital" count={meta.full_dimensions[0]} study={selected.id} series={series}/>
       </div></section>}
     </div>
    </div>
   </>}
   <footer><AlertTriangle size={17}/> Vista volumétrica normalizada para exploración. No identifica tumores ni reemplaza la lectura radiológica.</footer>
  </main>
 </div>;
}
