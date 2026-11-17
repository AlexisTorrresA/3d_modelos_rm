import {useEffect,useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js';
import {CSS2DObject,CSS2DRenderer} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {ATLAS_PARTS} from './atlasRules.js';

const MODEL_URLS=[
 '/atlas/brain.glb',
 'https://cdn.jsdelivr.net/gh/itayinbarr/brainproject@2929e94f521a8ddceab26bc100a98dc06b0da060/brain-atlas/models/brain.glb'
];
const defaultTarget=new THREE.Vector3(0,0,0);
const initialCamera=new THREE.Vector3(25,12,54);
const palette=Object.fromEntries(ATLAS_PARTS.map(x=>[x.id,x.color]));
function meshMaterial(color,opacity=.9,roughness=.75){
 return new THREE.MeshStandardMaterial({color,roughness,metalness:.02,
  transparent:opacity<1,opacity,side:THREE.DoubleSide,
  depthWrite:opacity>.55});
}
function metadata(obj){
 const direct=obj.userData||{},parent=obj.parent?.userData||{};
 return {cat:direct.bx_cat||parent.bx_cat||'other',
  label:direct.bx_label||parent.bx_label||obj.name||'Estructura'};
}
function partFor(cat){
 const table={
  cortex:'brain',white_matter:'brain',diencephalon:'brain',deep_grey:'brain',
  cerebellum:'cerebellum',brainstem:'brainstem',ventricles:'ventricles',
  cranial_nerves:'nerves',tracts:'tracts',meninges_dura:'meninges',
  arteries:'vessels',veins_sinuses:'vessels',
 };
 return table[cat]||'brain';
}
function addMeshesToGroup(spine,cord){
 const bone=meshMaterial('#c3cbd4',.58), disc=meshMaterial('#8295a9',.35);
 const med=meshMaterial('#ecd6ac',.94);
 const spinalCord=new THREE.Mesh(new THREE.CapsuleGeometry(.45,19.5,12,22),med);
 spinalCord.position.set(0,-7.4,-.45);cord.add(spinalCord);
 const joints=18;
 for(let i=0;i<joints;i++){
  const y=1.55-i*1.12, s=.89+i*.009;
  const vertebra=new THREE.Group();vertebra.position.set(0,y,-.6);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(1.20*s,1.05*s,.59*s,22),bone.clone());
  body.rotation.x=Math.PI/2;vertebra.add(body);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.89*s,.17*s,9,26,Math.PI*1.3),bone.clone());
  ring.rotation.x=Math.PI/2;ring.rotation.z=.34*Math.PI;ring.position.z=-.5*s;vertebra.add(ring);
  const process=new THREE.Mesh(new THREE.CapsuleGeometry(.11*s,.9*s,5,9),bone.clone());
  process.rotation.x=Math.PI/2;process.position.z=-1.25*s;vertebra.add(process);
  for(const side of [-1,1]){
   const transverse=new THREE.Mesh(new THREE.CapsuleGeometry(.085*s,.58*s,5,8),bone.clone());
   transverse.rotation.z=Math.PI/2;
   transverse.position.set(side*1.25*s,0,-.42*s);vertebra.add(transverse);
  }
  spine.add(vertebra);
  if(i<joints-1){
   const pad=new THREE.Mesh(new THREE.CylinderGeometry(.99*s,.99*s,.16,22),disc.clone());
   pad.rotation.x=Math.PI/2;pad.position.set(0,y-.56,-.6);spine.add(pad);
  }
 }
 const rootMaterial=meshMaterial('#e6d4a3',.85);
 for(let i=0;i<9;i++){
  const curve=new THREE.CatmullRomCurve3([
   new THREE.Vector3((i-4)*.08,-15.8,-.42),
   new THREE.Vector3((i-4)*.13,-17.6,-.32),
   new THREE.Vector3((i-4)*.22,-19.8,-.18)
  ]);
  const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,22,.037,6,false),rootMaterial.clone());
  cord.add(tube);
 }
}
function textLabel(text,pos,scene){
 const object=new THREE.Object3D();object.position.set(...pos);
 const dom=document.createElement('div');
 dom.className='atlas-label';
 dom.textContent=text;
 const label=new CSS2DObject(dom);object.add(label);
 scene.add(object);
 return object;
}
export default function AtlasScene({layers,findings,selectedFinding,onSelect,onAtlasStatus,showLabels=true,focusMode=false,sceneApi}){
 const host=useRef(null);
 const internals=useRef(null);
 const callbacks=useRef({onSelect,onAtlasStatus});
 useEffect(()=>{callbacks.current={onSelect,onAtlasStatus}},[onSelect,onAtlasStatus]);
 useEffect(()=>{
  if(!host.current)return;
  let alive=true,frame=0,resizeObserver;
  const width=host.current.clientWidth||850,height=host.current.clientHeight||610;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#050c15');
  const camera=new THREE.PerspectiveCamera(43,width/height,.12,300);
  camera.position.copy(initialCamera);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
  renderer.setSize(width,height);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.2;
  host.current.appendChild(renderer.domElement);
  const labels=new CSS2DRenderer();
  labels.setSize(width,height);
  labels.domElement.style.position='absolute';
  labels.domElement.style.inset='0';
  labels.domElement.style.pointerEvents='none';
  host.current.appendChild(labels.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.dampingFactor=.065;
  controls.enablePan=true;controls.minDistance=7;controls.maxDistance=115;
  controls.target.copy(defaultTarget);
  scene.add(new THREE.HemisphereLight(0xcde8ff,0x0e1526,2.3));
  const directional=new THREE.DirectionalLight(0xffe8da,3.0);
  directional.position.set(17,21,25);scene.add(directional);
  const rim=new THREE.DirectionalLight(0x85c9ff,2.1);
  rim.position.set(-15,3,-16);scene.add(rim);
  const materials=[];
  const root=new THREE.Group();scene.add(root);
  const categoryGroups=Object.fromEntries(ATLAS_PARTS.map(x=>[x.id,new THREE.Group()]));
  for(const key of ['spinal_cord','spine','skull','lesion','leptomeningeal','collection'])root.add(categoryGroups[key]);
  addMeshesToGroup(categoryGroups.spine,categoryGroups.spinal_cord);
  const skull=new THREE.Mesh(new THREE.SphereGeometry(6.85,48,34),meshMaterial('#9bcadf',.10,.38));
  skull.position.set(0,9.35,0);skull.scale.set(.99,1.05,.93);categoryGroups.skull.add(skull);
  const atlasRoot=new THREE.Group();root.add(atlasRoot);
  const brainObjects=[];
  const anchors=[
   textLabel('Cerebro',[-5.7,13.9,.8],root),
   textLabel('Cerebelo',[3.6,5.2,-4],root),
   textLabel('Tronco encefálico',[3.2,5.7,-1.1],root),
   textLabel('Médula espinal',[2.1,-5.8,-.3],root),
   textLabel('Columna vertebral',[2.4,-13,-1.2],root),
  ];
  let status='loading';
  function publishStatus(value){
   status=value;
   if(alive)callbacks.current.onAtlasStatus?.(value);
  }
  publishStatus('loading');
  const loader=new GLTFLoader();
  const draco=new DRACOLoader();
  draco.setDecoderPath('/atlas/draco/');
  loader.setDRACOLoader(draco);
  function loadAtlas(at){
   if(!alive)return;
   const url=MODEL_URLS[at];
   if(!url){publishStatus('unavailable');return;}
   loader.load(url,gltf=>{
    if(!alive){
     gltf.scene.traverse(node=>{if(node.isMesh){node.geometry?.dispose();node.material?.dispose?.()}});
     return;
    }
    const obj=gltf.scene;
    obj.updateMatrixWorld(true);
    const box=new THREE.Box3();let found=false;
    obj.traverse(node=>{
     if(!node.isMesh)return;
     const cat=metadata(node).cat;
     if(['cortex','cerebellum','brainstem','diencephalon','ventricles','white_matter','deep_grey'].includes(cat)){
      box.expandByObject(node);found=true;
     }
    });
    if(!found)box.setFromObject(obj);
    const center=box.getCenter(new THREE.Vector3());
    const radius=box.getBoundingSphere(new THREE.Sphere()).radius||1;
    const model=new THREE.Group();atlasRoot.add(model);
    model.add(obj);obj.position.copy(center.multiplyScalar(-1));
    model.scale.setScalar(6.55/radius);
    model.rotation.y=Math.PI;
    model.position.set(0,9.35,0);
    obj.traverse(node=>{
     if(!node.isMesh)return;
     const meta=metadata(node);
     const part=partFor(meta.cat);
     // Reuse the atlas anatomy but provide explicit controls per category.
     node.material=meshMaterial(palette[part]||palette.brain,.84);
     node.userData.atlasCategory=part;
     node.userData.atlasLabel=meta.label;
     brainObjects.push(node);
    });
    publishStatus('ready');
    applyLayers();
   },undefined,()=>loadAtlas(at+1));
  }
  function applyLayers(){
   if(!alive)return;
   const active=internals.current?.latestLayers||{};
   const focus=internals.current?.latestFocus||false;
   for(const [key,group] of Object.entries(categoryGroups)){
    const options=active[key]||{visible:true,opacity:.85};
    group.visible=options.visible!==false;
    group.traverse(obj=>{
     if(!obj.isMesh||!obj.material)return;
     const op=(options.opacity??.85)*(focus && ['brain','skull'].includes(key)?.38:1);
     obj.material.opacity=key==='skull'?Math.min(.32,op):op;
     obj.material.transparent=obj.material.opacity<1;
     obj.material.depthWrite=obj.material.opacity>.55;
    });
   }
   for(const node of brainObjects){
    const category=node.userData.atlasCategory||'brain';
    const options=active[category]||{visible:true,opacity:.8};
    const value=(options.opacity??.8)*(focus && ['brain','cerebellum'].includes(category)?.23:1);
    node.visible=options.visible!==false;
    node.material.opacity=Math.max(0,Math.min(1,value));
    node.material.transparent=value<1;
    node.material.depthWrite=value>.55;
   }
  }
  // Pointer picking is confined to synthetic reference markers only.
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),pressed=new THREE.Vector2();
  let markerMeshes=[];
  function onPointerDown(e){pressed.set(e.clientX,e.clientY)}
  function onPointerUp(e){
   if(pressed.distanceTo(new THREE.Vector2(e.clientX,e.clientY))>6)return;
   const bounds=renderer.domElement.getBoundingClientRect();
   pointer.set(2*(e.clientX-bounds.left)/bounds.width-1,1-2*(e.clientY-bounds.top)/bounds.height);
   raycaster.setFromCamera(pointer,camera);
   const hits=raycaster.intersectObjects(markerMeshes,false);
   if(hits.length)callbacks.current.onSelect?.(hits[0].object.userData.findingId);
  }
  renderer.domElement.addEventListener('pointerdown',onPointerDown);
  renderer.domElement.addEventListener('pointerup',onPointerUp);
  const api={
   latestLayers:layers,latestFocus:focusMode,latestFindings:[],
   applyLayers,categoryGroups,brainObjects,anchors,camera,controls,root,
   updateMarkers:function(next){
    for(const item of markerMeshes){
     const group=item.userData.markerGroup;
     if(group){
      group.parent?.remove(group);
      group.traverse(obj=>{
       if(obj.isMesh){obj.geometry?.dispose();obj.material?.dispose()}
      });
     }
    }
    markerMeshes=[];
    const markers=[];
    const selected=internals.current?.selectedFinding;
    for(const finding of next){
     const group=categoryGroups[finding.category];
     if(!group)continue;
     const marker=new THREE.Group();marker.position.set(...finding.point);
     const color=palette[finding.category]||'#ff7489';
     const body=new THREE.Mesh(
      new THREE.IcosahedronGeometry(finding.category==='leptomeningeal'?.76:.92,2),
      new THREE.MeshBasicMaterial({color,transparent:true,opacity:.13,depthWrite:false,wireframe:true})
     );
     body.userData.findingId=finding.id;body.userData.markerGroup=marker;
     marker.add(body);
     const ring=new THREE.Mesh(new THREE.TorusGeometry(1.10,.035,8,55),
      new THREE.MeshBasicMaterial({color,transparent:true,opacity:.86,depthWrite:false}));
     ring.rotation.x=Math.PI/2;
     marker.add(ring);
     const pole=new THREE.Mesh(new THREE.SphereGeometry(.12,10,8),
      new THREE.MeshBasicMaterial({color}));
     pole.userData.findingId=finding.id;pole.userData.markerGroup=marker;
     marker.add(pole);
     const html=document.createElement('div');
     html.className='atlas-finding-tag'+(selected===finding.id?' active':'');
     html.textContent=finding.territory+' · orientativo';
     const label=new CSS2DObject(html);
     label.position.set(0,1.38,0);marker.add(label);
     label.visible=internals.current?.labelsEnabled!==false;
     group.add(marker);markerMeshes.push(body,pole);
     markers.push({marker,label,ring,id:finding.id});
    }
    internals.current.highlightMarkers=markers;
    applyLayers();
   },
   focusOn:function(id){
    const finding=internals.current?.latestFindings.find(item=>item.id===id);
    if(!finding){
     camera.position.copy(initialCamera);controls.target.copy(defaultTarget);
     controls.update();return;
    }
    const target=new THREE.Vector3(...finding.point);
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3(10,5,13));
    controls.update();
   },
   showLabels:function(value){
    anchors.forEach(node=>node.visible=value);
    (internals.current.highlightMarkers||[]).forEach(item=>item.label.visible=value);
   }
  };
  internals.current=api;
  loadAtlas(0);
  resizeObserver=new ResizeObserver(()=>{
   if(!host.current)return;
   const w=host.current.clientWidth,h=host.current.clientHeight;
   if(w<1||h<1)return;
   camera.aspect=w/h;camera.updateProjectionMatrix();
   renderer.setSize(w,h);labels.setSize(w,h);
  });
  resizeObserver.observe(host.current);
  function render(){
   if(!alive)return;
   frame=requestAnimationFrame(render);
   controls.update();
   renderer.render(scene,camera);
   labels.render(scene,camera);
  }
  render();
  return ()=>{
   alive=false;
   cancelAnimationFrame(frame);
   resizeObserver?.disconnect();
   renderer.domElement.removeEventListener('pointerdown',onPointerDown);
   renderer.domElement.removeEventListener('pointerup',onPointerUp);
   controls.dispose();draco.dispose();
   scene.traverse(obj=>{
    if(obj.isMesh){obj.geometry?.dispose();if(Array.isArray(obj.material))obj.material.forEach(m=>m.dispose());else obj.material?.dispose()}
   });
   renderer.dispose();
   renderer.domElement.remove();labels.domElement.remove();
   scene.clear();internals.current=null;
  };
 },[]);
 useEffect(()=>{
  if(!internals.current)return;
  internals.current.latestLayers=layers;
  internals.current.latestFocus=focusMode;
  internals.current.applyLayers();
 },[layers,focusMode]);
 useEffect(()=>{
  if(!internals.current)return;
  internals.current.latestFindings=findings;
  internals.current.updateMarkers(findings);
 },[findings]);
 useEffect(()=>{internals.current?.showLabels(showLabels);if(internals.current)internals.current.labelsEnabled=showLabels;},[showLabels]);
 useEffect(()=>{if(internals.current)internals.current.selectedFinding=selectedFinding;internals.current?.focusOn(selectedFinding);},[selectedFinding]);
 useEffect(()=>{if(sceneApi)sceneApi.current={
  reset:()=>internals.current?.focusOn(null),
  focus:(id)=>internals.current?.focusOn(id),
  screenshot:()=>null,
 };return()=>{if(sceneApi)sceneApi.current=null}},[sceneApi]);
 return <div className="atlas-canvas" ref={host} role="img" aria-label="Atlas anatómico 3D interactivo: rota, acerca y navega. Los marcadores son orientativos, no reconstrucciones del paciente."/>;
}
