/** Schematic educational atlas placements, never DICOM-to-atlas registration.
 * Positions and sizes are UI illustrations, not patient measurements.
 */
export const ATLAS_PARTS=[
 {id:'brain',label:'Cerebro / corteza',color:'#efb5ac',note:'Atlas genérico Brain Project',opacity:.88},
 {id:'cerebellum',label:'Cerebelo',color:'#e2a191',note:'Malla anatómica atlas',opacity:.95},
 {id:'brainstem',label:'Tronco encefálico',color:'#e9c9a9',note:'Malla anatómica atlas',opacity:.94},
 {id:'ventricles',label:'Sistema ventricular',color:'#5cc9f4',note:'Estructuras atlas',opacity:.85},
 {id:'nerves',label:'Nervios craneales',color:'#f4db79',note:'Atlas referencial',opacity:.92},
 {id:'tracts',label:'Tractos nerviosos',color:'#8ddedb',note:'Atlas referencial',opacity:.76},
 {id:'meninges',label:'Meninges',color:'#a996ee',note:'Atlas / envoltura esquemática',opacity:.13},
 {id:'vessels',label:'Vasos',color:'#ed819d',note:'Atlas vascular',opacity:.88},
 {id:'spinal_cord',label:'Médula espinal',color:'#f4d69c',note:'Esquema educativo',opacity:.94},
 {id:'spine',label:'Columna vertebral',color:'#b4c3d4',note:'Esquema educativo',opacity:.42},
 {id:'skull',label:'Envoltura craneal',color:'#a9cee5',note:'Esquema de orientación',opacity:.08},
 {id:'lesion',label:'Lesiones sugeridas',color:'#ff647f',note:'Solo zonas citadas en informe',opacity:.62},
 {id:'leptomeningeal',label:'Diseminación sugerida',color:'#f4c761',note:'Solo zonas citadas en informe',opacity:.62},
 {id:'collection',label:'Colecciones sugeridas',color:'#72bbff',note:'Solo zonas citadas en informe',opacity:.62},
];
export const ATLAS_DEFAULTS=Object.fromEntries(ATLAS_PARTS.map(x=>[x.id,{visible:!['skull','vessels'].includes(x.id),opacity:x.opacity}]));
const PLACES=[
  {names:['región supraselar','hipotálamo'],point:[0,9.25,.45],focus:'Región supraselar / hipotalámica',region:'brain'},
  {names:['ventrículos','tálamo'],point:[0,9.55,.1],focus:'Región ventricular / diencefálica',region:'brain'},
  {names:['fosa posterior'],point:[0,5.3,-3.0],focus:'Fosa posterior',region:'brain'},
  {names:['cerebelo'],point:[0,5.0,-3.8],focus:'Cerebelo',region:'brain'},
  {names:['tronco encefálico'],point:[0,5.0,-.7],focus:'Tronco encefálico',region:'brain'},
  {names:['región pineal'],point:[0,10.4,-1.7],focus:'Región pineal',region:'brain'},
  {names:['nervio óptico'],point:[0,8.2,2.9],focus:'Nervio/quiasma óptico',region:'brain'},
  {names:['región espinal','médula espinal'],point:[0,-8,-.45],focus:'Región espinal',region:'spine'},
  {names:['lóbulos frontales'],point:[2,12.0,3.3],focus:'Lóbulos frontales',region:'brain'},
  {names:['lóbulos temporales'],point:[4.25,8.4,1.3],focus:'Lóbulos temporales',region:'brain'},
];
export function classifyAtlasSeries(series=[]){
 const item=series||[];
 const diffusion=item.filter(x=>/DTI|DWI|ADC|FA.COLOR|FA_REG|DIFUS|DIFFUS/i.test(x.description||''));
 const spine=item.filter(x=>/spine|spinal|cervical|dorsal|tor[aá]cic|lumbar|column|medul/i.test(x.description||''));
 const anatomical=item.filter(x=>/T1|T2|FLAIR|MPRAGE|SPACE|BRAVO|THRIVE|SWI/i.test(x.description||''));
 return {total:item.length,diffusion:diffusion.length,spine:spine.length,anatomical:anatomical.length};
}
function spinalLevel(text){
 const r=/\b([CTL])\s*([1-9]|1[0-2])\b/i.exec(text||'');
 if(!r)return null;
 const level=Number(r[2]),category=r[1].toUpperCase();
 if(category==='C')return {point:[0,2.3-level*.95,-.45],name:category+level};
 if(category==='T')return {point:[0,-3.5-level*.86,-.45],name:category+level};
 return {point:[0,-14.3-(level-1)*1.1,-.45],name:category+level};
}
export function mapReportToAtlas(findings=[],limit=12){
 const allowed=new Set(['lesion','leptomeningeal','collection']);
 const matches=[],seen=new Set();
 for(const f of findings){
  if(!allowed.has(f.category)||f.assertion==='negated'||f.review_status==='dismissed')continue;
  // A mention alone does not supply an anatomical coordinate.
  const named=(f.regions_in_text||[]).flatMap(region=>{
   const m=PLACES.find(p=>p.names.includes(region));
   return m?[m]:[];
  });
  const level=spinalLevel(f.evidence);
  const first=level?{point:level.point,focus:'Nivel '+level.name,region:'spine'}:named[0];
  if(!first)continue;
  const key=f.category+'|'+first.focus;
  if(seen.has(key))continue;seen.add(key);
  const focusPoint=[...first.point];
  if(f.laterality_in_text==='derecha')focusPoint[0]=Math.max(2.4,Math.abs(focusPoint[0]));
  if(f.laterality_in_text==='izquierda')focusPoint[0]=-Math.max(2.4,Math.abs(focusPoint[0]));
  matches.push({
   id:f.id,category:f.category,label:f.label,point:focusPoint,
   territory:first.focus,source_type:'report_text',
   evidence:f.evidence,page:f.page,assertion:f.assertion,
   status:f.review_status,illustrative:true
  });
  if(matches.length>=limit)break;
 }
 return matches;
}
