import {useEffect,useState} from 'react';
import {FileImage,UploadCloud,Trash2,Eye,EyeOff,Info} from 'lucide-react';
import {CATEGORY_OPTIONS,geometryCompatible} from './geometry.js';

async function api(path,options){
 const res=await fetch(path,options);
 if(!res.ok){
  const text=await res.json().catch(()=>({}));
  throw new Error(text.detail||'Error al gestionar máscara');
 }
 return res.status===204?null:res.json();
}
export default function MaskControls({study,series,meta,masks,setMasks}){
 const [file,setFile]=useState(null);
 const [category,setCategory]=useState('lesion');
 const [color,setColor]=useState('#ff657e');
 const [label,setLabel]=useState('Lesión segmentada (importada)');
 const [uploading,setUploading]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 useEffect(()=>{setFile(null);setError('');setNotice('');},[study?.id]);
 async function upload(event){
  event.preventDefault();
  const form=event.currentTarget;
  if(!file||!meta||uploading)return;
  setUploading(true);setError('');setNotice('Verificando coordenadas y dimensiones de la máscara…');
  try{
   const body=new FormData();
   body.append('file',file);
   body.append('series_id',series);
   body.append('category',category);
   body.append('label',label);
   body.append('color',color);
   const record=await api('/api/studies/'+study.id+'/masks',{method:'POST',body});
   setMasks(prev=>[...prev,{...record,opacity:.8,visible:true}]);
   setNotice('Máscara importada. Puedes activarla, cambiar su color y ver la geometría 3D.');
   setFile(null);
   form.reset();
  }catch(e){setNotice('');setError(e.message);}
  finally{setUploading(false);}
 }
 async function remove(id){
  if(!window.confirm('¿Eliminar esta máscara de segmentación?'))return;
  try{
   await api('/api/studies/'+study.id+'/masks/'+id,{method:'DELETE'});
   setMasks(current=>current.filter(m=>m.id!==id));
  }catch(e){setError(e.message);}
 }
 async function recolor(mask,color){
  setMasks(items=>items.map(m=>m.id===mask.id?{...m,color}:m));
  try{
   await api('/api/studies/'+study.id+'/masks/'+mask.id,{
    method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({color})
   });
  }catch(e){setError(e.message);}
 }
 const maskCount=masks.length;
 return <section className="panel mask-panel">
   <div className="mask-heading"><FileImage size={20}/><div>
    <h3>Capas anatómicas coloreadas · máscaras 3D</h3>
    <p className="muted small">Importa una segmentación real de una estructura para colorear toda su región, no solo un punto.</p>
   </div><span className="resolution">{maskCount} máscaras</span></div>
   <form onSubmit={upload} className="mask-upload">
    <label>Archivo NIfTI de máscara (.nii / .nii.gz)
     <input type="file" accept=".nii,.nii.gz" onChange={e=>setFile(e.target.files?.[0]||null)}/>
    </label>
    <label>Estructura
     <select value={category} onChange={e=>{
      const item=CATEGORY_OPTIONS.find(x=>x.id===e.target.value);
      setCategory(item.id);setColor(item.color);setLabel(item.label);
     }}>{CATEGORY_OPTIONS.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select>
    </label>
    <label>Color <input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
    <label>Nombre <input type="text" maxLength={70} required value={label} onChange={e=>setLabel(e.target.value)}/></label>
    <button type="submit" className="secondary" disabled={!file||uploading||!meta}>
     <UploadCloud size={15}/>{uploading?'Importando…':'Añadir máscara'}
    </button>
   </form>
   <p className="mask-disclaimer"><Info size={15}/> La máscara debe corresponder exactamente a la serie DICOM seleccionada, con las mismas dimensiones, orientación y coordenadas físicas. No se generan tumores automáticamente.</p>
   {error&&<div className="fusion-caution">{error}</div>}
   {notice&&<div className="fusion-caution">{notice}</div>}
   {maskCount>0&&<div className="mask-list">{masks.map(m=>{
    const compatible=geometryCompatible(meta,m.preview_meta);
    return <div className="mask-item" key={m.id}>
     <span className="marker-dot" style={{background:m.color}}/>
     <div className="mask-info"><strong>{m.label}</strong>
       <small>{m.voxels.toLocaleString('es-CL')} vóxeles · {compatible?'Compatible con la serie visible':'Otra geometría / región: no superpuesta'}</small>
       {m.source_type?.includes('experimental')&&<small className="mask-experimental">Predicción automática experimental · requiere revisión de la máscara</small>}</div>
     <input type="color" aria-label={'Color de '+m.label} value={m.color} onChange={e=>recolor(m,e.target.value)}/>
     <label className="opacity-control">Opacidad
      <input type="range" min="0" max="100" value={Math.round((m.opacity??.8)*100)}
       onChange={e=>setMasks(items=>items.map(x=>x.id===m.id?{...x,opacity:Number(e.target.value)/100}:x))}/>
     </label>
     <button type="button" className="icon-button" title="Mostrar/ocultar"
      onClick={()=>setMasks(items=>items.map(x=>x.id===m.id?{...x,visible:!x.visible}:x))}>
       {m.visible===false?<EyeOff size={16}/>:<Eye size={16}/>}
     </button>
     <button type="button" className="icon-button" title="Eliminar máscara" onClick={()=>remove(m.id)}><Trash2 size={16}/></button>
    </div>;
   })}</div>}
  </section>;
}
