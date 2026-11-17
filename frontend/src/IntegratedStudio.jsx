import {useEffect,useMemo,useState} from 'react';
import {Layers3,Eye,EyeOff,Info,LoaderCircle} from 'lucide-react';
import VolumeViewer from './VolumeViewer.jsx';
import {PALETTE,chooseAnatomical,isDiffusion,overlap,modalityHint} from './geometry.js';

const urls=(study,series,p)=>'/api/studies/'+encodeURIComponent(study)+'/series/'+encodeURIComponent(series)+'/'+p;

async function readMeta(url){
 const res=await fetch(url,{cache:'no-store'});
 if(!res.ok){const msg=await res.json().catch(()=>({}));throw new Error(msg.detail||'No se pudo preparar la serie');}
 return res.json();
}
export function ColorPicker({value,onChange}){
 return <select className="color-select" aria-label="Color de visualización" value={value} onChange={e=>onChange(e.target.value)}>
  {PALETTE.map(p=><option key={p.hex} value={p.hex}>{p.name}</option>)}
 </select>;
}
export default function IntegratedStudio({study,series,meta,markers}){
 const [baseColor,setBaseColor]=useState('#e1e7ee');
 const [baseOpacity,setBaseOpacity]=useState(0.72);
 const [showBase,setShowBase]=useState(true);
 const [overlayId,setOverlayId]=useState('');
 const [overlayMeta,setOverlayMeta]=useState(null);
 const [overlayColor,setOverlayColor]=useState('#64c5ed');
 const [overlayOpacity,setOverlayOpacity]=useState(0.32);
 const [showOverlay,setShowOverlay]=useState(true);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);

 useEffect(()=>{setOverlayId('');setOverlayMeta(null);},[study?.id]);
 useEffect(()=>{
  let active=true;
  setOverlayMeta(null);setError('');
  if(!overlayId||overlayId===series)return;
  setLoading(true);
  readMeta(urls(study.id,overlayId,'volume.json')).then(data=>{
   if(!active)return;
   if(meta?.study_reference && data.study_reference && meta.study_reference!==data.study_reference){
     setError('Estas series pertenecen a estudios DICOM diferentes. No se pueden superponer sin registro externo.');
     setOverlayMeta(null);
   }else if(meta?.frame_reference && data.frame_reference && meta.frame_reference!==data.frame_reference){
     setError('Las series tienen FrameOfReferenceUID distintos: sus coordenadas espaciales no se pueden combinar directamente.');
     setOverlayMeta(null);
   }else if(meta && overlap(meta,data)<0.1){
     setError('Las series no comparten suficiente espacio físico DICOM para superponerlas. Puede tratarse de otra región anatómica.');
     setOverlayMeta(null);
   }else setOverlayMeta(data);
  }).catch(e=>{if(active)setError(e.message);})
    .finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false};
 },[overlayId,study.id,series,meta]);

 const layers=useMemo(()=>{
  const result=[];
  if(meta)result.push({id:series,url:urls(study.id,series,'volume.raw'),meta,color:baseColor,opacity:baseOpacity,visible:showBase,label:'Base anatómica'});
  if(overlayId&&overlayMeta&&overlayId!==series)result.push({
    id:overlayId,url:urls(study.id,overlayId,'volume.raw'),meta:overlayMeta,
    color:overlayColor,opacity:overlayOpacity,visible:showOverlay,label:'Secuencia superpuesta'
  });
  return result;
 },[series,study.id,meta,baseColor,baseOpacity,showBase,overlayId,overlayMeta,overlayColor,overlayOpacity,showOverlay]);

 const baseDescription=study.series.find(s=>s.id===series)?.description;
 return <section className="panel viewer">
  <div className="viewer-heading"><div><h3><Layers3 size={19}/> Modelo integral por capas</h3><p>Un mismo espacio físico DICOM, varias señales visibles</p></div>
   {meta&&<span className="resolution">{layers.length} {layers.length===1?'capa':'capas'}</span>}
  </div>
  <div className="fusion-toolbar">
   <div className="fusion-layer">
    <span className="layer-dot" style={{backgroundColor:baseColor}}/>
    <div className="layer-names"><strong>Tejido visible · base</strong><small>{baseDescription||'Selecciona una serie anatómica'}</small></div>
    <ColorPicker value={baseColor} onChange={setBaseColor}/>
    <label className="opacity-control">Opacidad <input type="range" min="0" max="100" value={Math.round(baseOpacity*100)} onChange={e=>setBaseOpacity(Number(e.target.value)/100)}/></label>
    <button className="icon-button" title={showBase?'Ocultar':'Mostrar'} onClick={()=>setShowBase(!showBase)}>{showBase?<Eye size={17}/>:<EyeOff size={17}/>}</button>
   </div>
   <div className="fusion-layer">
    <span className="layer-dot" style={{backgroundColor:overlayColor}}/>
    <div className="layer-names"><strong>Capa complementaria</strong><small>Selecciona una segunda secuencia compatible</small></div>
    <select className="fusion-select" value={overlayId} onChange={e=>{setOverlayId(e.target.value);setShowOverlay(true);}}>
     <option value="">Sin superposición</option>
     {study.series.filter(s=>s.id!==series&&!isDiffusion(s.description)).map(s=><option key={s.id} value={s.id}>{s.description} · {s.count} imágenes</option>)}
    </select>
    <ColorPicker value={overlayColor} onChange={setOverlayColor}/>
    <label className="opacity-control">Opacidad <input type="range" min="0" max="100" value={Math.round(overlayOpacity*100)} onChange={e=>setOverlayOpacity(Number(e.target.value)/100)}/></label>
    <button className="icon-button" title={showOverlay?'Ocultar':'Mostrar'} onClick={()=>setShowOverlay(!showOverlay)}>{showOverlay?<Eye size={17}/>:<EyeOff size={17}/>}</button>
   </div>
  </div>
  {error&&<div className="fusion-caution">{error}</div>}
  <div className="fusion-caution"><Info size={15}/> Las capas se ubican usando sus coordenadas DICOM. Esto <strong>no es registro deformable</strong> ni garantiza coincidencia exacta entre tejidos. Las diferencias de posicionamiento o movimiento requieren registro y validación.</div>
  {meta?<VolumeViewer layers={layers} markers={markers}/>:<div className="placeholder">{loading?<LoaderCircle className="spin"/>:'Preparando serie anatómica…'}</div>}
  <div className="technical">
   <span>Marcadores manuales visibles: {markers.length}</span>
   <span>Geometría compartida: {overlayMeta?(meta.frame_reference && overlayMeta.frame_reference?'Mismo marco DICOM':'Sin marco de referencia confirmado'):'Una serie'}</span>
   <span>Las zonas con color no están identificadas automáticamente</span>
  </div>
 </section>;
}
