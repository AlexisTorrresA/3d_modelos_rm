import {lazy,Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {Brain,Layers3,Scan,Eye,EyeOff,RotateCcw,Info,Check,AlertTriangle,MapPin,LoaderCircle} from 'lucide-react';
import VolumeViewer from './VolumeViewer.jsx';
import {mapReportToAtlas,ATLAS_PARTS,ATLAS_DEFAULTS} from './atlasRules.js';
import {geometryCompatible} from './geometry.js';

const AtlasScene=lazy(()=>import('./AtlasScene.jsx'));
const limit=4;
function endpoint(studyId,seriesId,p='volume.json'){
 return '/api/studies/'+encodeURIComponent(studyId)+'/series/'+encodeURIComponent(seriesId)+'/'+p;
}
function colorFor(region,index){
 if(region==='spine')return ['#69c4e5','#e9bf75','#b0a0df'][index%3];
 return ['#edc5ba','#74c1ed','#f4b17f','#b5a7ee'][index%4];
}
async function readJson(url){
 const response=await fetch(url,{cache:'no-store'});
 if(!response.ok){
  let message='No se pudo cargar este volumen DICOM';
  try{message=(await response.json()).detail||message;}catch{}
  throw new Error(message);
 }
 return response.json();
}
function initialSources(plan){
 const rows=[...plan.suggested_brain_ids.slice(0,2),...plan.suggested_spine_ids.slice(0,2)];
 return rows.map((id,index)=>{
  const found=plan.series.find(x=>x.id===id);
  const region=found?.region||'other';
  return {id,region,visible:true,color:colorFor(region,index),opacity:region==='spine'?.37:.6};
 }).slice(0,limit);
}
export default function PatientReconstruction({study,masks=[],markers=[],analysis}){
 const [plan,setPlan]=useState(null);
 const [planError,setPlanError]=useState('');
 const [sceneKind,setSceneKind]=useState('patient');
 const [focus,setFocus]=useState('complete');
 const [sources,setSources]=useState([]);
 const [metas,setMetas]=useState({});
 const [loadMessages,setLoadMessages]=useState({});
 const [selectedAddition,setSelectedAddition]=useState('');
 const [showMarkers,setShowMarkers]=useState(true);
 const [atlasLayers,setAtlasLayers]=useState(ATLAS_DEFAULTS);
 const [atlasLabels,setAtlasLabels]=useState(true);
 const [atlasFocus,setAtlasFocus]=useState(false);
 const [atlasStatus,setAtlasStatus]=useState('loading');
 const [selectedFinding,setSelectedFinding]=useState(null);
 const atlasApi=useRef(null);
 const ids=sources.map(s=>s.id).join('|');

 useEffect(()=>{
  let active=true;setPlan(null);setPlanError('');
  setMetas({});setSources([]);setLoadMessages({});setSelectedFinding(null);
  setSceneKind('patient');setFocus('complete');
  readJson('/api/studies/'+study.id+'/reconstruction/plan')
   .then(data=>{if(!active)return;setPlan(data);setSources(initialSources(data));})
   .catch(err=>{if(active)setPlanError(err.message);});
  return()=>{active=false;};
 },[study.id]);

 useEffect(()=>{
  if(!plan||sceneKind!=='patient')return;
  let active=true;
  const controller=new AbortController();
  async function load(){
   const missing=sources.filter(x=>x.visible&&!metas[x.id]);
   for(const entry of missing){
    if(!active)return;
    setLoadMessages(s=>({...s,[entry.id]:'Preparando cortes DICOM reales…'}));
    try{
     const response=await fetch(endpoint(study.id,entry.id),{
      cache:'no-store',signal:controller.signal
     });
     if(!response.ok){
      const err=await response.json().catch(()=>({}));
      throw Error(err.detail||'No se pudo reconstruir el volumen');
     }
     const value=await response.json();
     if(active){
      setMetas(current=>({...current,[entry.id]:value}));
      setLoadMessages(s=>({...s,[entry.id]:''}));
     }
    }catch(err){
     if(active&&err.name!=='AbortError')
      setLoadMessages(s=>({...s,[entry.id]:err.message}));
    }
   }
  }
  load();
  return()=>{active=false;controller.abort();};
 // A stable joined list avoids cancelling the remaining loads on each meta update.
 },[study.id,sceneKind,plan,ids,sources.map(x=>x.visible).join('|')]);

 function patchSource(id,updates){
  setSources(rows=>rows.map(item=>item.id===id?{...item,...updates}:item));
 }
 function addSeries(){
  if(!selectedAddition||sources.length>=limit||sources.some(x=>x.id===selectedAddition))return;
  const item=plan.series.find(x=>x.id===selectedAddition);
  const region=item.region;
  setSources(current=>[...current,{id:item.id,region,
   visible:true,color:colorFor(region,current.length),opacity:.36}]);
  setSelectedAddition('');
 }
 const candidates=(plan?.series||[]).filter(x=>
   x.region!=='diffusion'&&!sources.some(s=>s.id===x.id)
 );
 const spatialValues=Object.values(metas);
 const frameOk=spatialValues.every(x=>
  !x.frame_reference||!spatialValues[0]?.frame_reference||
  x.frame_reference===spatialValues[0].frame_reference
 );
 const selectedVolumeLayers=useMemo(()=>{
  const active=sources.filter(s=>s.visible&&metas[s.id]&&(
   focus==='complete'||focus===s.region||(focus==='brain'&&s.region==='other')
  ));
  return active.map(src=>({
   id:src.id,url:endpoint(study.id,src.id,'volume.raw'),
   meta:metas[src.id],color:src.color,opacity:src.opacity,visible:true,
   label:plan?.series.find(row=>row.id===src.id)?.description
  }));
 },[sources,metas,focus,study.id,plan]);
 const compatibleMasks=useMemo(()=>{
  const frame=selectedVolumeLayers.map(l=>l.meta);
  return masks.filter(m=>frame.some(meta=>geometryCompatible(meta,m.preview_meta)))
   .map(m=>({
    ...m,meta:m.preview_meta,
    url:'/api/studies/'+study.id+'/masks/'+m.id+'/volume.raw',
    visible:m.visible!==false,opacity:m.opacity??.8
   }));
 },[masks,selectedVolumeLayers,study.id]);
 const reportHints=(analysis?.findings||[]).filter(
  x=>x.assertion!=='negated'&&x.review_status!=='dismissed'
 );
 const schematics=useMemo(()=>mapReportToAtlas(reportHints),[analysis]);
 const chosenHint=schematics.find(x=>x.id===selectedFinding);
 const isPrepared=selectedVolumeLayers.length>0;

 return <section className="patient-mode">
  <div className="patient-hero">
   <div>
    <span className="eyebrow">RECONSTRUCCIÓN DESDE EL ESTUDIO · MODO DE REFERENCIA</span>
    <h3><Brain size={20}/> Modelo completo basado en la RM real</h3>
    <p>Conserva coordenadas DICOM: cerebro, contraste y regiones de columna en un mismo espacio físico.
     Las lesiones se colorean según máscaras verificadas; el informe aporta referencias textuales.</p>
   </div>
   <div className="patient-hero-numbers">
    <strong>{plan?.total_images?.toLocaleString('es-CL')||'—'}</strong><span>imágenes DICOM</span>
    <strong>{plan?.total_series||'—'}</strong><span>series revisadas</span>
   </div>
  </div>
  {planError&&<div className="alert error">{planError}</div>}
  <div className="patient-tabs">
   <button className={sceneKind==='patient'?'selected':''} onClick={()=>setSceneKind('patient')}>
    <Scan size={16}/> Mi resonancia real
   </button>
   <button className={sceneKind==='atlas'?'selected':''} onClick={()=>setSceneKind('atlas')}>
    <Brain size={16}/> Atlas educativo comparativo
   </button>
   <span>{sceneKind==='patient'?'Datos propios: geometría de las secuencias cargadas':
    'Atlas genérico, NO registrado al estudio del paciente'}</span>
  </div>
  {sceneKind==='patient'?<>
   <div className="patient-sources">
    <div className="patient-section-title"><h4><Layers3 size={17}/> Reconstrucción por adquisiciones reales</h4>
     <span>{plan?.shared_frame?'Marco espacial DICOM común':plan?'Referencias espaciales distintas o desconocidas':'Revisando series…'}</span></div>
    <div className="patient-focus">
     {[
      ['complete','Todo el estudio'],
      ['brain','Cerebro'],
      ['spine','Columna / médula']
     ].map(([key,label])=><button key={key}
      className={focus===key?'selected':''} onClick={()=>setFocus(key)}>{label}</button>)}
    </div>
    <div className="patient-source-list">{sources.map(src=>{
     const item=plan?.series.find(x=>x.id===src.id);
     const reason=loadMessages[src.id];
     return <div className="patient-source" key={src.id}>
      <button type="button" className="icon-button" onClick={()=>patchSource(src.id,{visible:!src.visible})}
       title={src.visible?'Ocultar volumen':'Mostrar volumen'}>
       {src.visible?<Eye size={16}/>:<EyeOff size={16}/>}
      </button>
      <input type="color" aria-label={'Color de '+item?.description} value={src.color}
       onChange={e=>patchSource(src.id,{color:e.target.value})}/>
      <div className="patient-source-title">
       <strong>{item?.description||'Secuencia'}</strong>
       <small>{item?.images||0} cortes · {src.region==='brain'?'cerebro':src.region==='spine'?'columna':'otra región'}
       {reason?' · '+reason:metas[src.id]?' · volumen preparado':''}</small>
      </div>
      <label>Opacidad
       <input type="range" min="0" max="100" value={Math.round(src.opacity*100)}
        onChange={e=>patchSource(src.id,{opacity:Number(e.target.value)/100})}/>
      </label>
      <button className="patient-remove" type="button" title="Quitar adquisición"
       onClick={()=>setSources(rows=>rows.filter(x=>x.id!==src.id))}>Quitar</button>
     </div>;
    })}</div>
    {plan&&sources.length<limit&&<div className="patient-add">
     <select aria-label="Agregar serie anatómica real" value={selectedAddition}
      onChange={e=>setSelectedAddition(e.target.value)}>
      <option value="">Agregar otra serie real del estudio…</option>
      {candidates.map(x=><option key={x.id} value={x.id}>
       {x.description} · {x.images} cortes · {x.region}
      </option>)}
     </select>
     <button type="button" className="secondary" onClick={addSeries} disabled={!selectedAddition}>
      Añadir adquisición
     </button>
    </div>}
   </div>
   <div className="patient-stage">
    <div className="patient-stage-bar">
     <span><span className="stage-light"/> {isPrepared?selectedVolumeLayers.length+' volumen(es) reales cargados':'Cargando volúmenes desde DICOM…'}</span>
     <label><input type="checkbox" checked={showMarkers} onChange={e=>setShowMarkers(e.target.checked)}/>
      Referencias manuales</label>
    </div>
    {isPrepared?
     <VolumeViewer layers={selectedVolumeLayers}
      markers={showMarkers?markers:[]} masks={compatibleMasks}/>:
     <div className="patient-stage-loading"><LoaderCircle size={28} className="spin"/>
      {plan?'Preparando la geometría física de las series seleccionadas…':'Leyendo el inventario del estudio…'}</div>}
    <div className="patient-stage-foot">
     <span>Señal y anatomía procedentes de DICOM reales</span>
     <span>{compatibleMasks.length} máscara(s) geométricas importadas</span>
    </div>
   </div>
   <p className="patient-caution"><AlertTriangle size={16}/>
    Esta es una superposición volumétrica en coordenadas físicas reales, no una segmentación cerebral automática.
    Las intensidades MRI no delimitan por sí mismas cerebro, nervios ni tumores. Una unión precisa entre adquisiciones
    puede requerir registro y una máscara validada. {frameOk?'No se detectó discrepancia de marco entre los volúmenes preparados.':
     'Las adquisiciones tienen marcos distintos: no deben asumirse alineadas.'}</p>
  </>:
  <div className="patient-atlas-area">
   <div className="patient-atlas-side">
    <h4>Atlas educativo, como 3D Iker</h4>
    <p>Anatomía genérica; no reemplaza las formas ni las dimensiones reales de la RM.</p>
    <div className="patient-atlas-controls">
     <button className="secondary" onClick={()=>atlasApi.current?.reset()}><RotateCcw size={15}/> Restablecer vista</button>
     <button className="secondary" onClick={()=>setAtlasFocus(!atlasFocus)}>
      {atlasFocus?'Mostrar anatomía':'Destacar hallazgos'}</button>
     <label><input type="checkbox" checked={atlasLabels} onChange={e=>setAtlasLabels(e.target.checked)}/> Etiquetas</label>
    </div>
    <div className="patient-atlas-layers">{ATLAS_PARTS.map(x=>
     <div className="patient-atlas-layer" key={x.id}>
      <label><input type="checkbox" checked={atlasLayers[x.id]?.visible!==false}
       onChange={e=>setAtlasLayers(st=>({...st,[x.id]:{...st[x.id],visible:e.target.checked}}))}/>
       <span>{x.label}<small>{x.note}</small></span></label>
      <input type="range" min="0" max="100" aria-label={'Opacidad '+x.label}
       value={Math.round((atlasLayers[x.id]?.opacity??x.opacity)*100)}
       onChange={e=>setAtlasLayers(st=>({...st,[x.id]:{...st[x.id],opacity:Number(e.target.value)/100}}))}/>
     </div>)}</div>
    <small>Atlas cerebral: Brain Project / Z‑Anatomy / BodyParts3D, CC BY‑SA 4.0.</small>
   </div>
   <div className="patient-atlas-stage">
    <Suspense fallback={<div className="patient-stage-loading">Preparando atlas anatómico…</div>}>
     <AtlasScene layers={atlasLayers} findings={schematics}
      showLabels={atlasLabels} focusMode={atlasFocus} selectedFinding={selectedFinding}
      onAtlasStatus={setAtlasStatus} onSelect={setSelectedFinding} sceneApi={atlasApi}/>
    </Suspense>
    {atlasStatus==='loading'&&<div className="atlas-loading-notice"><LoaderCircle className="spin" size={16}/> Cargando atlas anatómico…</div>}
    {atlasStatus==='unavailable'&&<div className="atlas-loading-notice">No se pudo cargar el atlas cerebral. Revisa la conexión.</div>}
    <div className="patient-atlas-disclaimer">Atlas genérico y esquemático, NO reconstruido ni registrado al DICOM. 
     Las ubicaciones sugeridas desde el informe son ilustrativas, no coordenadas ni tamaños tumorales.</div>
   </div>
  </div>}
  <section className="patient-provenance panel">
   <div className="patient-provenance-head"><h4><MapPin size={17}/> Hallazgos mencionados en el informe</h4>
    <span>{reportHints.length} referencia(s) textuales</span></div>
   {reportHints.length===0?<p className="muted small">
    Todavía no hay menciones analizadas. Abre «Informe radiológico» y analiza el PDF para consultar sus referencias.
    Las áreas tumorales no se pintarán automáticamente sin máscara o marcado verificado.</p>:
    <div className="patient-evidence-list">{reportHints.slice(0,15).map(f=>{
     const hasMask=!!(f.linked_mask_id&&masks.some(x=>x.id===f.linked_mask_id));
     const approximated=schematics.some(x=>x.id===f.id);
     return <button type="button" key={f.id} className={selectedFinding===f.id?'selected':''}
      onClick={()=>{setSelectedFinding(f.id);if(sceneKind==='patient')setSceneKind('atlas');}}>
      <span className="patient-evidence-color" style={{background:f.color}}/>
      <span><strong>{f.label}</strong>
       <small>{(f.regions_in_text||[]).join(', ')||'Sin región identificable'} · página {f.page}</small>
       <small>{hasMask?'Máscara real asociada':approximated?'Ubicación orientativa en el atlas':'Sin ubicación 3D'}</small></span>
     </button>;
    })}</div>}
   {chosenHint&&<p className="patient-hint"><strong>{chosenHint.territory}</strong> ·
    El marcador es esquemático, basado en palabras de la página {chosenHint.page}, no en segmentación ni registro DICOM.</p>}
  </section>
 </section>;
}
