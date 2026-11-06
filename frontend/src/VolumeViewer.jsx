import {useEffect,useRef,useState} from 'react';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import '@kitware/vtk.js/Rendering/Profiles/Volume';

export default function VolumeViewer({url,meta}){
  const container=useRef(null);
  const [status,setStatus]=useState('Preparando volumen 3D…');
  useEffect(()=>{
    let live=true,view=null,observer=null;
    const abort=new AbortController();
    async function start(){
      try{
        setStatus('Cargando volumen 3D…');
        const res=await fetch(url,{signal:abort.signal,cache:'no-store'});
        if(!res.ok)throw new Error('No se pudo descargar el volumen');
        const buffer=await res.arrayBuffer();
        if(!live)return;
        const total=meta.dimensions.reduce((a,b)=>a*b,1);
        if(buffer.byteLength!==total)throw new Error('Datos volumétricos incompletos');
        const image=vtkImageData.newInstance();
        image.setDimensions(meta.dimensions);
        image.setSpacing(meta.spacing);
        image.setOrigin(meta.origin);
        image.setDirection(meta.direction);
        image.getPointData().setScalars(vtkDataArray.newInstance({name:'MRI',numberOfComponents:1,values:new Uint8Array(buffer)}));
        const mapper=vtkVolumeMapper.newInstance();
        mapper.setInputData(image);
        mapper.setSampleDistance(Math.min(...meta.spacing)*0.8);
        const opacity=vtkPiecewiseFunction.newInstance();
        [[0,0],[28,0],[65,.015],[120,.07],[190,.25],[255,.55]].forEach(p=>opacity.addPoint(...p));
        const colors=vtkColorTransferFunction.newInstance();
        [[0,.03,.05,.08],[60,.16,.31,.50],[140,.67,.80,.91],[255,.98,.98,1]].forEach(p=>colors.addRGBPoint(...p));
        const volume=vtkVolume.newInstance();
        volume.setMapper(mapper);
        volume.getProperty().setRGBTransferFunction(0,colors);
        volume.getProperty().setScalarOpacity(0,opacity);
        volume.getProperty().setInterpolationTypeToLinear();
        view=vtkGenericRenderWindow.newInstance({background:[.025,.05,.08]});
        view.setContainer(container.current);
        view.resize();
        view.getRenderer().addVolume(volume);
        view.getRenderer().resetCamera();
        view.getRenderWindow().render();
        observer=new ResizeObserver(()=>{if(live&&view)view.resize();});
        observer.observe(container.current);
        setStatus('');
      }catch(e){if(live&&e.name!=='AbortError')setStatus(e.message||'El navegador no pudo renderizar el 3D');}
    }
    start();
    return()=>{live=false;abort.abort();if(observer)observer.disconnect();if(view){view.setContainer(null);view.delete();}};
  },[url,meta]);
  return <div className="volume"><div className="volume-container" ref={container}/>{status?<div className="volume-status">{status}</div>:<div className="volume-tip">Arrastra para rotar · Rueda para zoom</div>}</div>;
}
