import {useEffect,useMemo,useRef,useState} from 'react';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import '@kitware/vtk.js/Rendering/Profiles/Volume';

function rgb(hex){
 const h=(hex||'#e1e7ee').replace('#','');
 return [0,2,4].map(i=>parseInt(h.substring(i,i+2),16)/255);
}
function tintColor(transfer,hex){
 const [r,g,b]=rgb(hex);
 [[0,0],[35,.12],[95,.33],[160,.70],[255,1]].forEach(([x,f])=>{
  const shade=x===0?0:.055*(1-f);
  transfer.addRGBPoint(x,Math.min(1,r*f+shade),Math.min(1,g*f+shade),Math.min(1,b*f+shade));
 });
}
function tintOpacity(transfer,alpha,visible){
 const k=visible?Math.max(0,Math.min(1,alpha)):0;
 [[0,0],[24,0],[55,.012*k],[105,.055*k],[165,.19*k],[220,.36*k],[255,.56*k]]
   .forEach(point=>transfer.addPoint(...point));
}
function setAppearance(model,layer){
 const color=vtkColorTransferFunction.newInstance();
 const opacity=vtkPiecewiseFunction.newInstance();
 if(model.isMask){
  const colorValues=rgb(layer.color);
  color.addRGBPoint(0,0,0,0);
  color.addRGBPoint(1,...colorValues);
  opacity.addPoint(0,0);
  opacity.addPoint(.5,0);
  opacity.addPoint(1,layer.visible?Math.min(1,layer.opacity):0);
 }else{
  tintColor(color,layer.color);
  tintOpacity(opacity,layer.opacity,layer.visible);
 }
 model.volume.getProperty().setRGBTransferFunction(0,color);
 model.volume.getProperty().setScalarOpacity(0,opacity);
 if(model.colors)model.colors.delete();
 if(model.opacity)model.opacity.delete();
 model.colors=color;
 model.opacity=opacity;
}

export default function VolumeViewer({layers,markers=[],masks=[]}){
 const container=useRef(null);
 const renderer=useRef(null);
 const actors=useRef([]);
 const volumes=useRef([]);
 const enabledMasks=masks.filter(m=>m.meta);
 const allLayers=[...layers,...enabledMasks.map(m=>({...m,id:'mask:'+m.id,isMask:true}))];
 const liveLayers=useRef(allLayers);
 const [status,setStatus]=useState('Preparando volumen 3D…');
 const layerIds=allLayers.filter(l=>l.meta).map(l=>l.id+'|'+l.url+'|'+(l.meta.bytes||0)).join('~');

 useEffect(()=>{liveLayers.current=allLayers;
  for(const model of volumes.current){
   const layer=allLayers.find(l=>l.id===model.id);
   if(layer)setAppearance(model,layer);
  }
  renderer.current?.getRenderWindow().render();
 },[layers,masks]);

 useEffect(()=>{
  let live=true,view=null,observer=null;
  const abort=new AbortController();
  volumes.current=[];
  async function start(){
   try{
    setStatus('Cargando los volúmenes en la misma escena 3D…');
    const selected=liveLayers.current.filter(l=>l.meta);
    if(!selected.length)return;
    const data=await Promise.all(selected.map(async(layer)=>{
     const res=await fetch(layer.url,{signal:abort.signal,cache:'no-store'});
     if(!res.ok)throw new Error('No se pudo cargar una de las series');
     const buffer=await res.arrayBuffer();
     const voxels=layer.meta.dimensions.reduce((a,b)=>a*b,1);
     if(buffer.byteLength!==voxels)throw new Error('Volumen incompleto');
     return {layer,buffer};
    }));
    if(!live||!container.current)return;
    view=vtkGenericRenderWindow.newInstance({background:[.025,.05,.08]});
    view.setContainer(container.current);
    view.resize();
    for(const {layer,buffer} of data){
      const image=vtkImageData.newInstance();
      image.setDimensions(layer.meta.dimensions);
      image.setSpacing(layer.meta.spacing);
      image.setOrigin(layer.meta.origin);
      image.setDirection(layer.meta.direction);
      image.getPointData().setScalars(vtkDataArray.newInstance({
       name:'MRI',numberOfComponents:1,values:new Uint8Array(buffer)
      }));
      const mapper=vtkVolumeMapper.newInstance();
      mapper.setInputData(image);
      mapper.setSampleDistance(Math.min(...layer.meta.spacing)*1.0);
      const volume=vtkVolume.newInstance();
      volume.setMapper(mapper);
      if(layer.isMask)volume.getProperty().setInterpolationTypeToNearest();
      else volume.getProperty().setInterpolationTypeToLinear();
      const model={id:layer.id,isMask:!!layer.isMask,image,mapper,volume,colors:null,opacity:null};
      setAppearance(model,liveLayers.current.find(l=>l.id===layer.id)||layer);
      volumes.current.push(model);
      view.getRenderer().addVolume(volume);
    }
    renderer.current=view;
    view.getRenderer().resetCamera();
    view.getRenderWindow().render();
    observer=new ResizeObserver(()=>{if(live)view.resize();});
    observer.observe(container.current);
    setStatus('');
   }catch(e){
    if(live&&e.name!=='AbortError')setStatus(e.message||'El navegador no pudo renderizar el modelo');
   }
  }
  start();
  return ()=>{
   live=false;abort.abort();if(observer)observer.disconnect();
   if(view){view.setContainer(null);view.delete();}
   renderer.current=null;
   for(const v of volumes.current){
    v.colors?.delete();v.opacity?.delete();
    v.volume.delete();v.mapper.delete();v.image.delete();
   }
   volumes.current=[];
  };
 },[layerIds]);

 useEffect(()=>{
  const view=renderer.current;
  if(!view)return;
  const renderer3d=view.getRenderer();
  for(const a of actors.current){renderer3d.removeActor(a.actor);a.actor.delete();a.mapper.delete();a.source.delete();}
  actors.current=[];
  for(const m of markers){
   if(!Array.isArray(m.position_mm)||m.position_mm.length!==3)continue;
   const source=vtkSphereSource.newInstance({radius:m.radius_mm||3,thetaResolution:20,phiResolution:14});
   source.setCenter(...m.position_mm);
   const mapper=vtkMapper.newInstance();
   mapper.setInputConnection(source.getOutputPort());
   const actor=vtkActor.newInstance();
   actor.setMapper(mapper);
   actor.getProperty().setColor(...rgb(m.color));
   actor.getProperty().setOpacity(.94);
   renderer3d.addActor(actor);
   actors.current.push({source,mapper,actor});
  }
  view.getRenderWindow().render();
  return()=>{};
 },[markers,layerIds,status]);

 return <div className="volume">
  <div className="volume-container" ref={container}/>
  {status?<div className="volume-status">{status}</div>:<div className="volume-tip">Arrastra para rotar · Rueda para acercar · Esferas = marcadores · Áreas = máscaras subidas</div>}
 </div>;
}
