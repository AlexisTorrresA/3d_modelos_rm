import {useEffect,useMemo,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {LoaderCircle} from 'lucide-react';

/** Patient-space surfaces derived from the real binary NIfTI segmentation mask.
 * A generic anatomical atlas is NEVER substituted for missing anatomy.
 */
export default function SegmentedMeshViewer({study,masks=[]}){
 const host=useRef(null);
 const [message,setMessage]=useState('Generando superficies desde máscaras…');
 const signature=useMemo(()=>masks.slice(0,8).map(m=>
  [m.id,m.revision||1,m.color,m.visible!==false].join(':')
 ).join('|'),[masks]);
 useEffect(()=>{
  if(!host.current)return;
  let live=true,raf=0,observer;
  const holder=host.current;
  const scene=new THREE.Scene();
  scene.background=new THREE.Color('#07111e');
  const camera=new THREE.PerspectiveCamera(43,1,.05,10000);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.5;
  renderer.setSize(Math.max(1,holder.clientWidth),Math.max(1,holder.clientHeight));
  holder.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.dampingFactor=.065;
  controls.minDistance=3;controls.maxDistance=3000;
  const hemi=new THREE.HemisphereLight(0xd5ecff,0x182337,3.0);scene.add(hemi);
  const key=new THREE.DirectionalLight(0xffddd0,3.8);key.position.set(200,350,300);scene.add(key);
  const edge=new THREE.DirectionalLight(0x5eaaff,2.7);edge.position.set(-240,-100,-100);scene.add(edge);
  const models=new THREE.Group();scene.add(models);
  camera.position.set(0,0,100);controls.target.set(0,0,0);controls.update();

  function render(){
   if(!live)return;
   raf=requestAnimationFrame(render);controls.update();renderer.render(scene,camera);
  }
  render();
  const loader=new GLTFLoader();
  async function load(){
   if(!masks.some(m=>m.voxels>0)){
    setMessage('No hay geometría en esta serie: dibuja una máscara para verla como superficie 3D.');
    return;
   }
   setMessage('Reconstruyendo mallas desde los vóxeles etiquetados…');
   let count=0;
   for(const mask of masks.slice(0,8)){
    if(!live)return;
    if(!mask.voxels||mask.visible===false)continue;
    const url='/api/studies/'+study.id+'/segmentation/masks/'+mask.id+'/mesh.glb';
    try{
     const response=await fetch(url,{cache:'no-store'});
     if(!response.ok)throw Error('No se pudo reconstruir '+mask.label);
     const buffer=await response.arrayBuffer();
     const gltf=await loader.parseAsync(buffer,'');
     if(!live){
      gltf.scene.traverse(obj=>{if(obj.isMesh){
       obj.geometry?.dispose();obj.material?.dispose?.();
      }});
      return;
     }
     gltf.scene.traverse(obj=>{
      if(!obj.isMesh)return;
      obj.material.side=THREE.DoubleSide;
      obj.material.roughness=.78;
      obj.material.transparent=true;
      obj.material.opacity=Math.max(.15,Math.min(1,mask.opacity??.88));
      obj.material.depthWrite=obj.material.opacity>.55;
     });
     models.add(gltf.scene);
     count++;
    }catch(err){
     if(live)setMessage('Algunas máscaras no se pudieron renderizar: '+err.message);
    }
   }
   if(!live)return;
   if(count>0){
    const box=new THREE.Box3().setFromObject(models);
    const center=box.getCenter(new THREE.Vector3());
    const extent=box.getSize(new THREE.Vector3());
    const radius=Math.max(4,extent.length()/2);
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(radius*.9,radius*.35,radius*2.3));
    camera.near=Math.max(.02,radius/200);
    camera.far=radius*100+500;camera.updateProjectionMatrix();
    controls.minDistance=radius*.2;controls.maxDistance=radius*8;
    controls.update();
    setMessage('');
   }
  }
  load();
  observer=new ResizeObserver(()=>{
   if(!live||!holder.clientWidth||!holder.clientHeight)return;
   const w=holder.clientWidth,h=holder.clientHeight;
   camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);
  });
  observer.observe(holder);
  return()=>{
   live=false;cancelAnimationFrame(raf);observer?.disconnect();
   controls.dispose();
   scene.traverse(obj=>{if(obj.isMesh){
    obj.geometry?.dispose();
    if(Array.isArray(obj.material))obj.material.forEach(m=>m.dispose());
    else obj.material?.dispose();
   }});
   renderer.dispose();renderer.domElement.remove();
  };
 },[signature,study.id]);
 return <div className="seg-mesh-view">
  <div ref={host} className="seg-mesh-canvas" aria-label="Modelo 3D de superficies segmentadas"/>
  {message&&<div className="seg-mesh-message">{message.includes('Reconstruyendo')&&<LoaderCircle className="spin" size={16}/>}
   {message}</div>}
  <div className="seg-mesh-tip">Arrastra para girar · rueda para zoom · coordenadas físicas DICOM</div>
 </div>;
}
