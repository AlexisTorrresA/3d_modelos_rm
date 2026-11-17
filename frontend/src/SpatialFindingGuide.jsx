import {useEffect,useMemo,useState} from 'react';
import {MapPin,LocateFixed,Trash2,FileText,Info} from 'lucide-react';
import {CATEGORY_OPTIONS,toPatient,toVoxel} from './geometry.js';

/** Patient-space points are user-selected on DICOM cuts. The report supplies
 * only evidence text; no automatic clinical locations or tumor geometries. */
export default function SpatialFindingGuide({
  study,series,meta,position,markers,setMarkers,analysis,
  selectedMarkerId,onSelectMarker
}){
 const [category,setCategory]=useState('lesion');
 const [label,setLabel]=useState('Posible lesión · referencia manual');
 const [color,setColor]=useState('#ff657e');
 const [findingId,setFindingId]=useState('');
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [radius,setRadius]=useState(3);
 const mentions=useMemo(()=>(analysis?.findings||[]).filter(f=>
   f.assertion!=='negated'&&f.review_status!=='dismissed'
 ),[analysis]);
 const chosen=mentions.find(f=>f.id===findingId);
 const current=toPatient(position,meta);
 const unlocated=mentions.filter(f=>!markers.some(m=>m.finding_id===f.id)).length;
 useEffect(()=>{setFindingId('');setError('');setNotice('')},[study.id]);

 function selectFinding(value){
  setFindingId(value);
  const f=mentions.find(x=>x.id===value);
  if(f){
   setCategory(f.category);
   setColor(CATEGORY_OPTIONS.find(x=>x.id===f.category)?.color||f.color||'#ff657e');
   setLabel((f.label+' · referencia elegida en corte').slice(0,70));
  }
 }
 function selectCategory(value){
  setCategory(value);setFindingId('');
  const info=CATEGORY_OPTIONS.find(x=>x.id===value);
  setColor(info?.color||'#ff657e');
  setLabel(((info?.label||'Estructura')+' · referencia manual').slice(0,70));
 }
 async function save(){
  if(saving||!label.trim())return;
  setSaving(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/studies/'+study.id+'/markers',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
     series_id:series,category,label:label.trim(),color,radius_mm:radius,
     position_mm:current,source_type:'manual_from_slice',
     finding_id:findingId||null
    })
   });
   if(!response.ok){
    const issue=await response.json().catch(()=>({}));
    throw new Error(issue.detail||'No se pudo guardar el punto');
   }
   const marker=await response.json();
   setMarkers(prev=>[...prev,marker]);
   onSelectMarker(marker);
   setNotice('Punto guardado sobre el vóxel seleccionado. Aparece en el 3D y en los cortes; no representa el tamaño de una lesión.');
  }catch(e){setError(e.message);}
  finally{setSaving(false);}
 }
 async function remove(marker){
  if(saving)return;
  if(!window.confirm('¿Eliminar esta referencia manual? Los DICOM y máscaras se conservarán.'))return;
  setSaving(true);setError('');
  try{
   const res=await fetch('/api/studies/'+study.id+'/markers/'+marker.id,{method:'DELETE'});
   if(!res.ok)throw new Error('No se pudo eliminar la referencia');
   setMarkers(prev=>prev.filter(m=>m.id!==marker.id));
   if(selectedMarkerId===marker.id)onSelectMarker(null);
  }catch(e){setError(e.message);}
  finally{setSaving(false);}
 }
 return <section className="seg-location-panel">
  <div className="seg-location-header"><div>
   <h4><MapPin size={18}/> Ubicar hallazgos en el modelo 3D</h4>
   <p>Selecciona un punto sobre los tres ejes de la RM real y guárdalo como referencia de lesión,
    diseminación o estructura anatómica. <strong>El informe no proporciona coordenadas exactas.</strong></p>
  </div><span>{markers.length} punto(s) manuales</span></div>
  <div className="seg-location-form">
   <label>Mención del informe (opcional)
    <select value={findingId} onChange={e=>selectFinding(e.target.value)}>
     <option value="">No vincular · punto elegido en la resonancia</option>
     {mentions.map((f,i)=><option key={f.id} value={f.id}>
       {String(i+1)+'. '+f.label+' · pág. '+f.page+' · '+((f.regions_in_text||[]).join('/')||'sin región')}
      </option>)}
    </select>
   </label>
   <label>Tipo de referencia
    <select value={category} onChange={e=>selectCategory(e.target.value)}>
     {CATEGORY_OPTIONS.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
    </select>
   </label>
   <label>Etiqueta del marcador
    <input value={label} onChange={e=>setLabel(e.target.value)}
     maxLength={70} placeholder="Nombre de referencia manual"/>
   </label>
   <label>Color<input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
   <label>Radio visual: {radius} mm
    <input type="range" value={radius} min={1} max={10}
     onChange={e=>setRadius(Number(e.target.value))}/>
   </label>
  </div>
  {chosen&&<div className="seg-location-source"><FileText size={16}/><div>
   <strong>Informe · página {chosen.page} · {chosen.assertion==='uncertain'?'redacción incierta':'mención textual'}</strong>
   <p>{chosen.evidence}</p>
   <small>Cita del PDF para orientar la revisión, no para inferir automáticamente un punto anatómico.</small>
  </div></div>}
  <div className="seg-location-action">
   <div className="seg-cursor-position"><LocateFixed size={16}/><div>
    <strong>Vóxel elegido: X {position[0]+1} · Y {position[1]+1} · Z {position[2]+1}</strong>
    <small>Posición DICOM (LPS): {current.map(x=>x.toFixed(1)).join(' / ')} mm</small>
   </div></div>
   <button type="button" className="secondary" disabled={saving||!label.trim()} onClick={save}>
    <MapPin size={16}/>{saving?'Guardando…':'Mostrar este punto en 3D'}
   </button>
  </div>
  {error&&<p className="seg-location-error">{error}</p>}
  {notice&&<p className="seg-location-success">{notice}</p>}
  <div className="seg-location-list">
   <div className="seg-location-list-title"><strong>Referencias guardadas</strong>
    <span>{unlocated} menciones del informe sin un punto vinculado</span>
   </div>
   {markers.length===0?<p className="seg-location-empty">
    No hay puntos señalados todavía. Los tumores y la diseminación no aparecen solos en el 3D.
   </p>:
   <div className="seg-location-items">{markers.map(m=>{
     const same=m.series_id===series;
     const categoryName=CATEGORY_OPTIONS.find(x=>x.id===m.category)?.label||m.category;
     const coords=same?toVoxel(m.position_mm,meta).map(x=>String(Math.round(x+1))).join(' / '):'otra serie';
     return <div className={'seg-location-item '+(selectedMarkerId===m.id?'active':'')} key={m.id}>
      <span className="seg-location-color" style={{background:m.color}}/>
      <div><strong>{m.label}</strong>
       <small>{categoryName} · {same?'X/Y/Z '+coords:coords} · manual</small>
       {m.finding_id&&<small>Vinculado a una mención del informe, no a una máscara tumoral</small>}
      </div>
      <button type="button" className="secondary" disabled={saving}
       onClick={()=>onSelectMarker(m)} title="Centrar este punto">Localizar</button>
      <button type="button" className="secondary seg-location-delete" disabled={saving}
       onClick={()=>remove(m)} title="Eliminar"><Trash2 size={15}/></button>
     </div>;
   })}</div>}
  </div>
  <p className="seg-location-warning"><Info size={15}/>
   Estos símbolos señalan posiciones elegidas manualmente; no demuestran lesión ni indican su contorno o tamaño.
   Para diferenciar tumores y diseminación como volúmenes se necesitan máscaras segmentadas y revisadas.
  </p>
 </section>;
}
