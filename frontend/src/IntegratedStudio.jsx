import {useEffect,useMemo,useState} from 'react';
import {Layers3,Eye,EyeOff,Info,Plus,Trash2} from 'lucide-react';
import VolumeViewer from './VolumeViewer.jsx';
import {PALETTE,isDiffusion,overlap} from './geometry.js';

const urls=(study,series,p)=>'/api/studies/'+encodeURIComponent(study)+'/series/'+encodeURIComponent(series)+'/'+p;
const MAX_VOLUMES=4; // Client-side GPU safety: one base + three overlays.

async function readMeta(url){
 const res=await fetch(url,{cache:'no-store'});
 if(!res.ok){const msg=await res.json().catch(()=>({}));throw new Error(msg.detail||'No se pudo preparar la serie');}
 return res.json();
}
function safeCompatibility(reference,second){
 if(reference?.study_reference && second.study_reference &&
     reference.study_reference!==second.study_reference){
   return 'Estas series pertenecen a estudios DICOM distintos; se requiere registro externo.';
 }
 if(reference?.frame_reference && second.frame_reference &&
     reference.frame_reference!==second.frame_reference){
   return 'Las series tienen marcos de referencia DICOM diferentes. No se pueden superponer directamente.';
 }
 if(reference && overlap(reference,second)<0.1){
   return 'Las regiones adquiridas no se superponen suficientemente. Quizá pertenecen a zonas anatómicas distintas.';
 }
 return '';
}
export function ColorPicker({value,onChange}){
 return <select className="color-select" aria-label="Color de visualización" value={value} onChange={e=>onChange(e.target.value)}>
  {PALETTE.map(p=><option key={p.hex} value={p.hex}>{p.name}</option>)}
 </select>;
}
export default function IntegratedStudio({study,series,meta,markers,masks=[]}){
 const [baseColor,setBaseColor]=useState('#e1e7ee');
 const [baseOpacity,setBaseOpacity]=useState(.75);
 const [showBase,setShowBase]=useState(true);
 const [overlays,setOverlays]=useState([]);
 const [overlaysMeta,setOverlaysMeta]=useState({});
 const [overlaysErrors,setOverlaysErrors]=useState({});
 const [newId,setNewId]=useState('');
 const ids=overlays.map(x=>x.id).join('|');

 useEffect(()=>{setOverlays([]);setOverlaysMeta({});setOverlaysErrors({});setNewId('');},[study.id]);
 useEffect(()=>{
  let live=true;
  setOverlaysMeta({});
  setOverlaysErrors({});
  if(!ids||!meta)return;
  for(const id of ids.split('|')){
    readMeta(urls(study.id,id,'volume.json'))
      .then(result=>{
        if(!live)return;
        const issue=safeCompatibility(meta,result);
        if(issue)setOverlaysErrors(state=>({...state,[id]:issue}));
        else setOverlaysMeta(state=>({...state,[id]:result}));
      })
      .catch(e=>{if(live)setOverlaysErrors(state=>({...state,[id]:e.message}));});
  }
  return()=>{live=false;};
 },[ids,series,study.id,meta]);

 function setLayer(id,patch){
  setOverlays(items=>items.map(x=>x.id===id?{...x,...patch}:x));
 }
 function remove(id){
  setOverlays(items=>items.filter(x=>x.id!==id));
  setOverlaysMeta(state=>{const next={...state};delete next[id];return next;});
  setOverlaysErrors(state=>{const next={...state};delete next[id];return next;});
 }
 function add(){
  if(!newId||newId===series||overlays.some(x=>x.id===newId)||overlays.length>=MAX_VOLUMES-1)return;
  const used=overlays.length;
  const colors=['#64c5ed','#f9b776','#b89bea'];
  setOverlays(items=>[...items,{id:newId,color:colors[used],opacity:.28,visible:true}]);
  setNewId('');
 }
 const selected=useMemo(()=>{
  const layers=[];
  if(meta)layers.push({id:series,url:urls(study.id,series,'volume.raw'),meta,
    color:baseColor,opacity:baseOpacity,visible:showBase,label:'Tejido visible · base'});
  for(const layer of overlays){
    const target=overlaysMeta[layer.id];
    if(target)layers.push({...layer,url:urls(study.id,layer.id,'volume.raw'),
      meta:target,label:study.series.find(s=>s.id===layer.id)?.description});
  }
  return layers;
 },[series,study.id,meta,baseColor,baseOpacity,showBase,overlays,overlaysMeta,study.series]);

 const chosen=study.series.find(x=>x.id===series);
 const options=study.series.filter(x=>x.id!==series&&!isDiffusion(x.description)&&!overlays.some(o=>o.id===x.id));

 return <section className="panel viewer">
  <div className="viewer-heading"><div><h3><Layers3 size={19}/> Modelo integral por capas</h3>
   <p>Un modelo 3D compartido con señales de distintas secuencias compatibles</p></div>
   {meta&&<span className="resolution">{selected.length} / {MAX_VOLUMES} capas</span>}
  </div>
  <div className="fusion-toolbar">
   <div className="fusion-layer">
    <span className="layer-dot" style={{backgroundColor:baseColor}}/>
    <div className="layer-names"><strong>Tejido visible · base</strong><small>{chosen?.description||'Serie anatómica seleccionada'}</small></div>
    <ColorPicker value={baseColor} onChange={setBaseColor}/>
    <label className="opacity-control">Opacidad <input type="range" min="0" max="100"
     value={Math.round(baseOpacity*100)} onChange={e=>setBaseOpacity(Number(e.target.value)/100)}/></label>
    <button className="icon-button" title={showBase?'Ocultar':'Mostrar'} onClick={()=>setShowBase(!showBase)}>
     {showBase?<Eye size={17}/>:<EyeOff size={17}/>}
    </button>
   </div>
   {overlays.map((layer,index)=><div key={layer.id}>
    <div className="fusion-layer">
     <span className="layer-dot" style={{backgroundColor:layer.color}}/>
     <div className="layer-names"><strong>Capa complementaria {index+1}</strong>
      <small>{study.series.find(s=>s.id===layer.id)?.description||'Serie sin nombre'} · {overlaysMeta[layer.id]?'Geometría revisada':'Preparando / no compatible'}</small></div>
     <ColorPicker value={layer.color} onChange={color=>setLayer(layer.id,{color})}/>
     <label className="opacity-control">Opacidad <input type="range" min="0" max="100"
       value={Math.round(layer.opacity*100)} onChange={e=>setLayer(layer.id,{opacity:Number(e.target.value)/100})}/></label>
     <button className="icon-button" title={layer.visible?'Ocultar':'Mostrar'}
      onClick={()=>setLayer(layer.id,{visible:!layer.visible})}>
       {layer.visible?<Eye size={17}/>:<EyeOff size={17}/>}
     </button>
     <button className="icon-button" title="Quitar capa" onClick={()=>remove(layer.id)}><Trash2 size={17}/></button>
    </div>
    {overlaysErrors[layer.id]&&<div className="fusion-caution">{overlaysErrors[layer.id]}</div>}
   </div>)}
   {overlays.length<MAX_VOLUMES-1&&options.length>0&&
    <div className="fusion-add"><select className="fusion-select" value={newId} onChange={e=>setNewId(e.target.value)}>
      <option value="">Elige otra secuencia anatómica</option>
      {options.map(x=><option key={x.id} value={x.id}>{x.description} ({x.count} imágenes)</option>)}
    </select>
    <button type="button" className="secondary" disabled={!newId} onClick={add}><Plus size={15}/> Añadir capa</button></div>}
  </div>
  <div className="fusion-caution"><Info size={15}/>
   Los colores son solamente visuales. Las capas se colocan con coordenadas DICOM compatibles y solapamiento físico aproximado;
   esto NO es registro rígido/deformable ni identifica estructuras o tumores automáticamente. Hasta {MAX_VOLUMES} volúmenes simultáneos para cuidar el rendimiento.</div>
  {meta?<VolumeViewer layers={selected} markers={markers} masks={masks}/>:<div className="placeholder">Preparando la secuencia principal…</div>}
  <div className="technical">
   <span>Volúmenes visibles: {selected.length}</span>
   <span>Referencias manuales: {markers.length}</span>
   <span>Una misma escena, sin apilar archivos DTI</span>
  </div>
 </section>;
}
