import {useMemo,useState} from 'react';
import {Brain,Eye,EyeOff,Layers3,ShieldAlert,ChevronDown} from 'lucide-react';
import {CATEGORY_OPTIONS,geometryCompatible} from './geometry.js';

export default function AnatomyLayers({study,meta,masks,setMasks,markers,analysis,visibility,onVisibility}){
 const [error,setError]=useState('');
 const stats=useMemo(()=>CATEGORY_OPTIONS.map(category=>{
  const matching=masks.filter(m=>m.category===category.id);
  const supported=matching.filter(m=>geometryCompatible(meta,m.preview_meta));
  const references=markers.filter(m=>m.category===category.id);
  const mentions=(analysis?.findings||[]).filter(f=>f.category===category.id &&
      f.assertion!=='negated' && f.review_status!=='dismissed');
  return {...category,matching,supported,references,mentions};
 }),[masks,markers,analysis,meta]);

 async function recolor(item,color){
  const old=masks.map(m=>({...m}));
  setMasks(previous=>previous.map(m=>m.category===item.id?{...m,color}:m));
  try{
   await Promise.all(item.matching.map(mask=>fetch(
    '/api/studies/'+study.id+'/masks/'+mask.id,{
     method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({color})
    }).then(async res=>{
     if(!res.ok){const msg=await res.json().catch(()=>({}));throw new Error(msg.detail||'No se pudo guardar color');}
    })
   ));
   setError('');
  }catch(err){setMasks(old);setError(err.message);}
 }
 return <section className="panel anatomy-panel">
  <div className="anatomy-head"><Brain size={20}/><div>
   <h3>Capas por estructura anatómica</h3>
   <p>Colores y visibilidad del modelo integrado. Solo una máscara importada dibuja la forma real de una estructura.</p>
  </div></div>
  <div className="anatomy-grid">{stats.map(item=>{
   const active=visibility[item.id]!==false;
   const geometry=item.supported.length>0;
   const mentioned=item.mentions.length>0;
   const any=item.matching.length||item.references.length;
   const current=item.matching[0]?.color||item.color;
   return <div className={'anatomy-item '+(geometry?'has-mask':'')} key={item.id}>
    <input type="color" aria-label={'Color de '+item.label} value={current}
      onChange={e=>recolor(item,e.target.value)} title={geometry?'Cambiar color de máscara':'Color disponible cuando agregues una máscara'}/>
    <div className="anatomy-name"><strong>{item.label}</strong>
     <small>{geometry?item.supported.length+' máscara(s) 3D':
      item.references.length?item.references.length+' marcador(es) manual(es)':
      mentioned?'Mencionado en informe · SIN geometría 3D':
      item.matching.length?'Máscara de otra geometría':
      'Sin segmentación asignada'}</small>
    </div>
    <button type="button" className="icon-button" disabled={!any}
     title={active?'Ocultar elementos existentes':'Mostrar elementos existentes'}
     onClick={()=>onVisibility({...visibility,[item.id]:!active})}>
      {active?<Eye size={16}/>:<EyeOff size={16}/>}
    </button>
   </div>;
  })}</div>
  {error&&<div className="fusion-caution">{error}</div>}
  <div className="anatomy-legend"><ShieldAlert size={15}/>
   El cerebro de fondo es una visualización de intensidad de la RM, no una segmentación automática.
   Las menciones del PDF no crean tejidos, tumores ni nervios 3D. Para ver cada estructura con su contorno, agrega una máscara NIfTI espacialmente validada.
  </div>
 </section>;
}