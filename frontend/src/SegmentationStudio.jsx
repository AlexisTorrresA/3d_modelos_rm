import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Brush, Eraser, Pentagon, MousePointer2, WandSparkles, Layers3,
  Save, Download, Undo2, Copy, Plus, CircleHelp, RefreshCw, Activity} from 'lucide-react';
import {CATEGORY_OPTIONS,isDiffusion} from './geometry.js';
import SegmentedMeshViewer from './SegmentedMeshViewer.jsx';
import MaskControls from './MaskControls.jsx';
import './segmentation.css';

const root = (sid)=>'/api/studies/'+encodeURIComponent(sid);
const maskRoot = (sid,id)=>root(sid)+'/segmentation/masks/'+encodeURIComponent(id);
async function json(url,opts={}){
 const r=await fetch(url,{cache:'no-store',...opts});
 if(!r.ok){let reason='No se pudo completar la solicitud';
  try{const body=await r.json();reason=body.detail||reason;}catch{}
  throw new Error(reason);
 }
 return r.status===204?null:r.json();
}
async function post(url,value){
 return json(url,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(value)});
}
function cutGeometry(plane,meta,position){
 const d=meta.full_dimensions,s=meta.full_spacing;
 const map={axial:{index:position[2],width:d[0],height:d[1],
  physW:d[0]*s[0],physH:d[1]*s[1],coords:[position[0],position[1]]},
  coronal:{index:position[1],width:d[0],height:d[2],
  physW:d[0]*s[0],physH:d[2]*s[2],coords:[position[0],position[2]]},
  sagital:{index:position[0],width:d[1],height:d[2],
  physW:d[1]*s[1],physH:d[2]*s[2],coords:[position[1],position[2]]}};
 return map[plane];
}
function updatePosition(position,plane,uv){
 const next=[...position];
 const [u,v]=uv.map(Math.round);
 if(plane==='axial'){next[0]=u;next[1]=v;}
 if(plane==='coronal'){next[0]=u;next[2]=v;}
 if(plane==='sagital'){next[1]=u;next[2]=v;}
 return next;
}
function masksForSeries(masks,series){
 return masks.filter(mask=>mask.series_id===series);
}

function Viewport({study,series,plane,meta,position,onPosition,mask,tool,
  radius,polygon,onPolygon,onCommit,onGrow,refresh,overlayOpacity}){
 const canvas=useRef(null);
 const shape=useMemo(()=>cutGeometry(plane,meta,position),[plane,meta,position]);
 const stroke=useRef(null);
 const [drawing,setDrawing]=useState(false);
 const imgURL=root(study.id)+'/series/'+encodeURIComponent(series)+
  '/slice?plane='+plane+'&index='+shape.index;
 const maskURL=mask?maskRoot(study.id,mask.id)+'/slice?plane='+plane+
  '&index='+shape.index+'&rev='+(mask.revision||1)+'&v='+refresh:null;
 const polygonPoints=polygon?.plane===plane&&polygon.index===shape.index?polygon.points:[];

 function locate(event){
  const rect=canvas.current.getBoundingClientRect();
  return [
    Math.max(0,Math.min(shape.width-1,Math.round((event.clientX-rect.left)/rect.width*shape.width))),
    Math.max(0,Math.min(shape.height-1,Math.round((event.clientY-rect.top)/rect.height*shape.height)))
  ];
 }
 function repaint(points,active){
  const el=canvas.current;if(!el)return;
  const ctx=el.getContext('2d');ctx.clearRect(0,0,el.width,el.height);
  const full=polygonPoints.length?polygonPoints:[];
  if(full.length){
   ctx.strokeStyle='#f6d885';ctx.lineWidth=2;ctx.lineJoin='round';
   ctx.beginPath();
   full.forEach(([x,y],i)=>i===0?ctx.moveTo(x,y):ctx.lineTo(x,y));
   ctx.stroke();
   full.forEach(([x,y])=>{ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle='#ffe6a0';ctx.fill();});
  }
  if(!active?.length)return;
  ctx.strokeStyle=tool==='erase'?'#ff8c85':'#71f2c5';
  ctx.fillStyle=ctx.strokeStyle;
  ctx.lineWidth=radius*2;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();active.forEach(([x,y],i)=>i===0?ctx.moveTo(x,y):ctx.lineTo(x,y));ctx.stroke();
  for(const [x,y] of active){ctx.beginPath();ctx.arc(x,y,radius,0,2*Math.PI);ctx.fill();}
 }
 useEffect(()=>repaint([],null),[polygon,shape.index,tool,radius]);
 function down(event){
  if(event.button!==0)return;
  const uv=locate(event);
  onPosition(updatePosition(position,plane,uv));
  if(!mask||tool==='inspect')return;
  if(tool==='polygon'){
   onPolygon(current=>(current?.plane===plane&&current.index===shape.index
      ?{...current,points:[...current.points,uv]}
      :{plane,index:shape.index,points:[uv]}));
   return;
  }
  if(tool==='grow'){onGrow(plane,shape.index,uv);return;}
  if(tool!=='brush'&&tool!=='erase')return;
  event.preventDefault();
  canvas.current.setPointerCapture(event.pointerId);
  stroke.current=[uv];setDrawing(true);repaint(stroke.current,true);
 }
 function move(event){
  if(!stroke.current)return;
  const uv=locate(event);
  const last=stroke.current[stroke.current.length-1];
  if(last[0]===uv[0]&&last[1]===uv[1])return;
  if(stroke.current.length>1900)return;
  stroke.current.push(uv);repaint(stroke.current,true);
 }
 function up(event){
  if(!stroke.current)return;
  const pts=stroke.current;
  stroke.current=null;setDrawing(false);
  repaint([],null);
  onCommit({plane,index:shape.index,tool,points:pts,radius});
  if(canvas.current.hasPointerCapture(event.pointerId))
   canvas.current.releasePointerCapture(event.pointerId);
 }
 return <div className="seg-viewport">
  <div className="seg-cut-header"><strong>{
    plane==='axial'?'Eje Z · cortes transversales':
    plane==='coronal'?'Eje Y · reconstrucción ortogonal':'Eje X · reconstrucción ortogonal'
   }</strong><span>{shape.index+1} / {meta.full_dimensions[plane==='axial'?2:plane==='coronal'?1:0]}</span></div>
  <div className="seg-cut-host">
   <div className="seg-cut-frame" style={{aspectRatio:shape.physW+'/'+shape.physH}}>
    <img className="seg-mri" src={imgURL} draggable={false} alt={'Corte DICOM original '+plane}/>
    {maskURL&&<img className="seg-mask-img" key={maskURL} src={maskURL}
      draggable={false} alt="Segmentación coloreada" style={{opacity:overlayOpacity}}/>}
    <div className="seg-cross seg-cross-h" style={{top:100*shape.coords[1]/Math.max(1,shape.height-1)+'%'}}/>
    <div className="seg-cross seg-cross-v" style={{left:100*shape.coords[0]/Math.max(1,shape.width-1)+'%'}}/>
    <canvas ref={canvas} width={shape.width} height={shape.height}
      className={'seg-interaction '+(drawing?'drawing':'')}
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={up} onDoubleClick={event=>{
       if(tool==='polygon'&&polygonPoints.length>=3){event.preventDefault();onCommit({
        plane,index:shape.index,tool:'polygon',points:polygonPoints,radius:1,
       });onPolygon(null);}
      }}/>
   </div>
  </div>
  <input type="range" className="seg-slice-slider" value={shape.index} min={0}
   max={meta.full_dimensions[plane==='axial'?2:plane==='coronal'?1:0]-1}
   aria-label={'Seleccionar corte '+plane}
   onChange={e=>{
    const next=[...position];next[plane==='axial'?2:plane==='coronal'?1:0]=Number(e.target.value);
    onPosition(next);onPolygon(null);
   }}/>
  <small>{shape.width} × {shape.height} píxeles · {shape.physW.toFixed(0)} × {shape.physH.toFixed(0)} mm</small>
 </div>;
}

export default function SegmentationStudio({study,masks,setMasks}){
 const [series,setSeries]=useState('');
 const [meta,setMeta]=useState(null);
 const [working,setWorking]=useState('');
 const [error,setError]=useState('');
 const [info,setInfo]=useState('');
 const [maskId,setMaskId]=useState('');
 const [position,setPosition]=useState([0,0,0]);
 const [category,setCategory]=useState('lesion');
 const [color,setColor]=useState('#ff657e');
 const [label,setLabel]=useState('Lesión segmentada manualmente');
 const [tool,setTool]=useState('inspect');
 const [radius,setRadius]=useState(4);
 const [polygon,setPolygon]=useState(null);
 const [tolerance,setTolerance]=useState(18);
 const [growRadius,setGrowRadius]=useState(35);
 const [interpPlane,setInterpPlane]=useState('axial');
 const [interpStart,setInterpStart]=useState(0);
 const [interpEnd,setInterpEnd]=useState(10);
 const [overlayOpacity,setOverlayOpacity]=useState(.84);
 const [refresh,setRefresh]=useState(0);
 const [hist,setHist]=useState([]);
 const [restoreTo,setRestoreTo]=useState('');
 const selected=masks.find(m=>m.id===maskId);
 const editable=selected?.source_type==='manual_editable';
 const validSeries=useMemo(()=>study.series.filter(s=>!isDiffusion(s.description)),[study.series]);
 const sameSeries=masksForSeries(masks,series);
 const busy=!!working;
 const sameId=root(study.id);

 useEffect(()=>{
  let alive=true;setMeta(null);setError('');setSeries('');setMaskId('');
  json(root(study.id)+'/reconstruction/plan').then(plan=>{
   if(!alive)return;
   setSeries(plan.brain_base_id||validSeries[0]?.id||'');
  }).catch(err=>{if(alive){setError(err.message);setSeries(validSeries[0]?.id||'');}});
  return()=>{alive=false;};
 },[study.id]);
 useEffect(()=>{
  let live=true;setMeta(null);setPolygon(null);setMaskId('');
  if(!series)return;
  setWorking('Leyendo el volumen DICOM de alta resolución…');
  json(root(study.id)+'/series/'+series+'/volume.json').then(result=>{
   if(!live)return;
   setMeta(result);
   setPosition(result.full_dimensions.map(n=>Math.floor((n-1)/2)));
   setInterpStart(0);setInterpEnd(Math.min(result.full_dimensions[2]-1,10));
  }).catch(err=>{if(live)setError(err.message)})
   .finally(()=>{if(live)setWorking('');});
  return()=>{live=false;};
 },[study.id,series]);
 useEffect(()=>{
  const current=masks.find(m=>m.id===maskId&&m.series_id===series);
  if(current)return;
  const first=sameSeries.find(m=>m.source_type==='manual_editable')||sameSeries[0];
  setMaskId(first?.id||'');
 },[series,masks,maskId]);
 useEffect(()=>{
  let active=true;setHist([]);setRestoreTo('');
  if(!maskId)return;
  json(maskRoot(study.id,maskId)+'/history').then(x=>{if(active)setHist(x.snapshots||[])})
   .catch(()=>{});
  return()=>{active=false;};
 },[study.id,maskId,refresh]);
 async function perform(text,operation){
  if(busy)return;
  setWorking(text);setError('');setInfo('');
  try{
   const result=await operation();
   if(result&&result.id){
    setMasks(current=>current.map(m=>m.id===result.id?{...m,...result}:m));
   }
   setRefresh(value=>value+1);
   return result;
  }catch(err){
   setError(err.message);
   if(err.message.includes('otra sesión')){
    json(root(study.id)+'/masks').then(rows=>setMasks(rows));
   }
   return null;
  }finally{setWorking('');}
 }
 async function create(event){
  event.preventDefault();
  if(!series||!meta||!label.trim())return;
  const created=await perform('Creando máscara vacía en la resolución DICOM original…',
    ()=>post(sameId+'/segmentation/masks',{series_id:series,category,label,color}));
  if(created){setMasks(current=>[...current,{...created,visible:true,opacity:.85}]);setMaskId(created.id);
   setTool('brush');setInfo('Máscara editable preparada; comienza a pintar sobre cualquier plano.');}
 }
 async function duplicate(){
  if(!selected)return;
  const record=await perform('Conservando la original y preparando copia editable…',
    ()=>post(maskRoot(study.id,selected.id)+'/duplicate',{}));
  if(record){setMasks(current=>[...current,{...record,visible:true,opacity:.85}]);setMaskId(record.id);
   setTool('brush');}
 }
 async function editStroke(payload){
  if(!selected||!editable)return;
  await perform('Guardando segmentación y nueva revisión en PostgreSQL…',
    ()=>post(maskRoot(study.id,selected.id)+'/paint',{
      ...payload,expected_revision:selected.revision||1
    }));
 }
 async function regionGrow(plane,index,seed){
  if(!selected||!editable)return;
  await perform('Seleccionando píxeles vecinos con intensidad similar…',
    ()=>post(maskRoot(study.id,selected.id)+'/grow',{
      plane,index,seed,tolerance,radius:growRadius,expected_revision:selected.revision||1
    }));
 }
 async function interpolate(event){
  event.preventDefault();
  if(!selected||!editable)return;
  await perform('Interpolando entre cortes previamente segmentados…',
    ()=>post(maskRoot(study.id,selected.id)+'/interpolate',{
      plane:interpPlane,start:Number(interpStart),end:Number(interpEnd),
      expected_revision:selected.revision||1
    }));
 }
 async function smooth(){
  if(!selected||!editable)return;
  if(!window.confirm('¿Suavizar los bordes del corte actual? Se guardará una nueva versión.'))return;
  const idx=position[interpPlane==='axial'?2:interpPlane==='coronal'?1:0];
  await perform('Suavizando el contorno de este corte…',
    ()=>post(maskRoot(study.id,selected.id)+'/smooth',{
     plane:interpPlane,index:idx,sigma:.9,expected_revision:selected.revision||1
    }));
 }
 async function undo(){
  if(!selected||!editable||!restoreTo)return;
  if(!window.confirm('¿Restaurar la versión '+restoreTo+' como una nueva revisión?'))return;
  await perform('Restaurando la versión elegida…',
    ()=>post(maskRoot(study.id,selected.id)+'/restore',{revision:Number(restoreTo)}));
 }
 async function download(format){
  if(!selected)return;
  setWorking('Generando '+format.toUpperCase()+' desde la máscara real…');setError('');
  try{
   const endpoint=maskRoot(study.id,selected.id)+
    (format==='nii.gz'?'/export.nii.gz':'/mesh.'+format);
   const response=await fetch(endpoint,{cache:'no-store'});
   if(!response.ok){const msg=await response.json().catch(()=>({}));throw Error(msg.detail||'No se pudo exportar');}
   const url=URL.createObjectURL(await response.blob());
   const a=document.createElement('a');a.href=url;
   a.download='RMStudio-'+selected.category+'-'+selected.id.slice(0,8)+'.'+format;
   document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),10000);
  }catch(err){setError(err.message)}
  finally{setWorking('');}
 }
 const compatible=selected&&selected.series_id===series;
 const maxIndices=meta?meta.full_dimensions:[1,1,1];
 const mergedMasks=meta?masks.filter(m=>m.voxels>0&&(
    m.series_id===series ||
    !!(m.preview_meta?.frame_reference && meta.frame_reference &&
        m.preview_meta.frame_reference===meta.frame_reference)
 )):[];

 return <section className="seg-studio">
  <header className="seg-banner"><div>
   <span className="eyebrow">SEGMENTACIÓN SOBRE LOS DICOM ORIGINALES</span>
   <h3><Layers3 size={20}/> Reconstrucción precisa desde los tres ejes</h3>
   <p>Trabaja sobre los vóxeles de la RM, crea máscaras independientes y genera superficies 3D reales.
    Las propuestas automáticas y las correcciones manuales <strong>requieren revisión especializada</strong>.</p>
  </div><span className="seg-banner-tag">Edición no diagnóstica</span></header>
  {error&&<div className="alert error">{error}<button type="button" onClick={()=>setError('')}>Cerrar</button></div>}
  {info&&<div className="fusion-caution">{info}</div>}
  {busy&&<div className="seg-working"><RefreshCw className="spin" size={16}/>{working}</div>}
  <div className="seg-selection">
   <label>Secuencia DICOM para editar
    <select value={series} onChange={e=>setSeries(e.target.value)} disabled={busy}>
     {validSeries.map(s=><option value={s.id} key={s.id}>{s.description} · {s.count} imágenes</option>)}
    </select>
   </label>
   <small>Elige T1 con contraste, T2 o FLAIR según la estructura que quieras delinear. No se mezclan vóxeles de series sin registro.</small>
  </div>
  {meta&&<>
   <section className="seg-mask-panel">
    <div className="seg-mask-heading"><h4>1. Elige o crea una estructura</h4><span>{sameSeries.length} máscaras de esta secuencia</span></div>
    <div className="seg-create">
     <label>Estructura
      <select value={category} onChange={e=>{
       setCategory(e.target.value);
       setColor(CATEGORY_OPTIONS.find(x=>x.id===e.target.value)?.color||'#ff657e');
      }}>{CATEGORY_OPTIONS.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select>
     </label>
     <label>Nombre
      <input value={label} onChange={e=>setLabel(e.target.value)} maxLength={70}
       placeholder="Ej. Lesión supraselar (manual)"/>
     </label>
     <label>Color<input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
     <button type="button" className="secondary" onClick={create} disabled={busy||!label.trim()}>
      <Plus size={15}/> Crear máscara vacía
     </button>
    </div>
    <div className="seg-masks">
     {sameSeries.map(m=><button key={m.id} type="button"
      className={m.id===maskId?'seg-mask-active':''} onClick={()=>{setMaskId(m.id);setPolygon(null);}}>
      <span className="seg-mask-color" style={{background:m.color}}/>
      <span><strong>{m.label}</strong><small>{Number(m.voxels||0).toLocaleString('es-CL')} vóxeles · revisión {m.revision||1}
       {m.source_type==='manual_editable'?' · editable':' · original protegida'}</small></span>
     </button>)}
     {sameSeries.length===0&&<p>No hay máscaras para esta secuencia. Crea una o importa una NIfTI desde la vista de capas.</p>}
    </div>
    {selected&&!editable&&<div className="seg-locked">
     <CircleHelp size={17}/> La segmentación importada o generada por IA está protegida para conservar su origen.
     <button className="secondary" disabled={busy} onClick={duplicate}>
      <Copy size={15}/> Crear copia editable
     </button></div>}
    <details className="seg-import">
     <summary>Importar o gestionar una máscara NIfTI original</summary>
     <MaskControls study={study} series={series} meta={meta} masks={masks} setMasks={setMasks}/>
    </details>
   </section>
   <div className="seg-editor-toolbar">
    <div className="seg-tools" role="group" aria-label="Herramientas de segmentación">
     {[
      ['inspect','Mover cursor',MousePointer2],
      ['brush','Pincel',Brush],
      ['erase','Borrador',Eraser],
      ['polygon','Polígono',Pentagon],
      ['grow','Región similar',WandSparkles],
     ].map(([key,title,Icon])=><button type="button" key={key} title={title}
       disabled={key!=='inspect'&&!editable||busy}
       className={tool===key?'active':''} onClick={()=>{setTool(key);setPolygon(null)}}>
       <Icon size={17}/><span>{title}</span>
     </button>)}
    </div>
    <div className="seg-tool-parameters">
     <label>Radio: {radius} px<input type="range" value={radius} min={1} max={25}
       onChange={e=>setRadius(Number(e.target.value))} disabled={!editable}/></label>
     <label>Intensidad ±{tolerance}<input type="range" value={tolerance} min={3} max={70}
       onChange={e=>setTolerance(Number(e.target.value))} disabled={!editable}/></label>
     <label>Vecindad: {growRadius} px<input type="range" value={growRadius} min={10} max={95}
       onChange={e=>setGrowRadius(Number(e.target.value))} disabled={!editable}/></label>
     <label>Máscara: {Math.round(overlayOpacity*100)}%<input type="range"
       value={Math.round(overlayOpacity*100)} min={0} max={100}
       onChange={e=>setOverlayOpacity(Number(e.target.value)/100)}/></label>
    </div>
    {polygon?.points?.length>0&&<div className="seg-polygon">
     Polígono: {polygon.points.length} puntos
     <button type="button" className="secondary" disabled={polygon.points.length<3||busy}
      onClick={()=>{editStroke({plane:polygon.plane,index:polygon.index,
       tool:'polygon',points:polygon.points,radius:1});setPolygon(null);}}>
      Aplicar polígono
     </button>
     <button type="button" className="secondary" onClick={()=>setPolygon(null)}>Cancelar</button>
    </div>}
   </div>
   <section className="seg-three-planes">
    {['axial','coronal','sagital'].map(plane=><Viewport key={plane+'-'+series}
      study={study} series={series} plane={plane} meta={meta}
      position={position} onPosition={setPosition}
      mask={compatible?selected:null} tool={busy?'inspect':tool} radius={radius}
      polygon={polygon} onPolygon={setPolygon} onCommit={editStroke}
      onGrow={regionGrow} refresh={refresh} overlayOpacity={overlayOpacity}/>)}
   </section>
   <div className="seg-coordinates"><Activity size={15}/>
    Cursor sincronizado: X {position[0]+1} / {maxIndices[0]},
    Y {position[1]+1} / {maxIndices[1]},
    Z {position[2]+1} / {maxIndices[2]} ·
    espaciado {meta.full_spacing.map(x=>x.toFixed(2)).join(' × ')} mm
   </div>
   <section className="seg-secondary-tools">
    <form onSubmit={interpolate}>
     <h4>2. Interpolar entre cortes delimitados</h4>
     <p>Primero dibuja el contorno en dos cortes de un mismo eje. Los intermedios vacíos se completarán como <strong>propuesta geométrica</strong>.</p>
     <div className="seg-action-row">
      <select value={interpPlane} onChange={e=>setInterpPlane(e.target.value)}>
       <option value="axial">Eje Z</option><option value="coronal">Eje Y</option><option value="sagital">Eje X</option>
      </select>
      <label>Desde<input type="number" min={0} max={maxIndices[interpPlane==='axial'?2:interpPlane==='coronal'?1:0]-1}
       value={interpStart} onChange={e=>setInterpStart(Number(e.target.value))}/></label>
      <label>Hasta<input type="number" min={0} max={maxIndices[interpPlane==='axial'?2:interpPlane==='coronal'?1:0]-1}
       value={interpEnd} onChange={e=>setInterpEnd(Number(e.target.value))}/></label>
      <button className="secondary" type="submit" disabled={!editable||busy}>Interpolar vacíos</button>
      <button className="secondary" type="button" disabled={!editable||busy} onClick={smooth}>Suavizar corte actual</button>
     </div>
    </form>
    <div>
     <h4>3. Historial y recuperación</h4>
     <p>Cada edición queda guardada en PostgreSQL con una revisión anterior recuperable.</p>
     <div className="seg-action-row">
      <select value={restoreTo} disabled={!editable||!hist.length||busy}
       onChange={e=>setRestoreTo(e.target.value)}>
       <option value="">Elegir revisión anterior…</option>
       {hist.map(x=><option value={x.revision} key={x.revision}>Revisión {x.revision}</option>)}
      </select>
      <button className="secondary" type="button" onClick={undo} disabled={!editable||!restoreTo||busy}>
       <Undo2 size={15}/> Restaurar versión
      </button>
     </div>
    </div>
   </section>
   <section className="seg-mesh-section">
    <div className="seg-mesh-head"><div><h4><Layers3 size={17}/> 4. Reconstrucción 3D de tus máscaras reales</h4>
      <p>Mallas de cerebro, lesiones y región espinal, incluso si fueron pintadas en diferentes series del mismo marco DICOM. No se supone que estén registradas sin verificación.</p>
     </div><span>{mergedMasks.length} superficie(s)</span></div>
    <div className="seg-mesh-legend">{mergedMasks.slice(0,8).map(m=>
     <button type="button" key={m.id} className={m.visible===false?'off':''}
      onClick={()=>setMasks(current=>current.map(x=>x.id===m.id?{...x,visible:!x.visible}:x))}
      title="Activar u ocultar una superficie en el 3D">
      <span style={{background:m.color}}/>{m.label}
     </button>)}</div>
    <SegmentedMeshViewer study={study} masks={mergedMasks} refresh={refresh}/>
    <div className="seg-exports">
     <strong>Exportar {selected?.label||'estructura seleccionada'}</strong>
     {['glb','obj','stl','nii.gz'].map(format=><button key={format}
      type="button" className="secondary" disabled={!selected||!selected.voxels||busy}
      onClick={()=>download(format)}><Download size={15}/>{format.toUpperCase()}</button>)}
    </div>
   </section>
  </>}
  <p className="seg-warning">El trazado y la selección por intensidad son herramientas gráficas de referencia, no un diagnóstico.
   Las máscaras pueden contener errores, incluso al interpolar. La segmentación de lesiones y diseminación requiere
   revisión de los cortes y validación profesional. No se ha generado ningún tumor a partir del informe PDF.</p>
 </section>;
}
