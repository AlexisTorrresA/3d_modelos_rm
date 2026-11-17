/** Display utilities only; no diagnosis or automatic tissue classification. */
export const PALETTE=[
  {name:'Gris natural',hex:'#e1e7ee'},
  {name:'Marfil',hex:'#f7d9aa'},
  {name:'Azul',hex:'#67a8ed'},
  {name:'Verde',hex:'#56dfb5'},
  {name:'Rosa',hex:'#f6a1ba'},
  {name:'Violeta',hex:'#bb9bff'},
  {name:'Naranja',hex:'#ffae73'},
];

export const CATEGORY_OPTIONS=[
  {id:'lesion',label:'Lesión / tumor (manual)',color:'#ff657e'},
  {id:'brain',label:'Referencia del cerebro (manual)',color:'#f2c69f'},
  {id:'ventricles',label:'Ventrículos (manual)',color:'#64c5ed'},
  {id:'spinal_cord',label:'Médula (manual)',color:'#f9dc69'},
  {id:'vessels',label:'Vasos (manual)',color:'#ec91b7'},
  {id:'other',label:'Otra estructura (manual)',color:'#a1d896'},
];

export function isDiffusion(description=''){
  return /DTI|DWI|ADC|(^|[-_ ])FA([ _-]|$)|FA.COLOR|FAR(EG)?|DIFUS|DIFFUS|TRACE|ISO[ -]?REG|DWI|EP2D|B[ -]?1000/i.test(description);
}
export function isAnatomical(description=''){
  return !isDiffusion(description) && /T1|T2|FLAIR|SPACE|MPRAGE|MPR|SPGR|BRAVO|SWI|TSE|FSE|CISS|FIESTA|TIRM|T1W|T2W|SAG|AX|COR/i.test(description);
}
export function modalityHint(description=''){
  if(isDiffusion(description))return 'Difusión / mapa derivado: no apilar direcciones';
  if(/SWI/i.test(description))return 'Susceptibilidad: puede aportar contraste vascular';
  if(/FLAIR/i.test(description))return 'Anatomía: contraste FLAIR';
  if(/T1/i.test(description))return 'Anatomía: contraste T1';
  if(/T2/i.test(description))return 'Anatomía: contraste T2';
  return 'Secuencia MR: revisar orientación y geometría';
}
export function chooseAnatomical(series){
  return [...series].sort((a,b)=>{
    function score(s){
      const n=s.description||'';
      if(isDiffusion(n))return -1000;
      let x=isAnatomical(n)?100:0;
      if(/3D|SPACE|MPRAGE|BRAVO|SPGR/i.test(n))x+=90;
      if(/T1|T2|FLAIR/i.test(n))x+=45;
      if(/SWI/i.test(n))x-=30;
      return x+Math.min(s.count,200)*0.2;
    }
    return score(b)-score(a);
  })[0];
}
export function toPatient(ijk,meta){
  const o=meta.full_origin,d=meta.full_direction,s=meta.full_spacing;
  return [0,1,2].map(r=>o[r]+[0,1,2].reduce((sum,c)=>sum+d[r*3+c]*ijk[c]*s[c],0));
}
export function toVoxel(point,meta){
  const diff=point.map((value,i)=>value-meta.full_origin[i]);
  const d=meta.full_direction,s=meta.full_spacing;
  // ITK direction cosines form an orthonormal transform: inverse = transpose.
  return [0,1,2].map(c=>[0,1,2].reduce((sum,r)=>sum+d[r*3+c]*diff[r],0)/s[c]);
}
export function bounds(meta){
  const dims=meta.full_dimensions||meta.dimensions;
  const o=meta.full_origin||meta.origin,d=meta.full_direction||meta.direction,s=meta.full_spacing||meta.spacing;
  if(!o||!d||!s)return null;
  const corners=[];
  for(let x of [0,dims[0]-1])for(let y of [0,dims[1]-1])for(let z of [0,dims[2]-1]){
    corners.push([0,1,2].map(r=>o[r]+[x,y,z].reduce((sum,index,c)=>sum+d[r*3+c]*index*s[c],0)));
  }
  return [0,1,2].map(axis=>[Math.min(...corners.map(p=>p[axis])),Math.max(...corners.map(p=>p[axis]))]);
}
export function overlap(reference,overlay){
  const a=bounds(reference),b=bounds(overlay);
  if(!a||!b)return 0;
  const intersection=a.reduce((v,p,i)=>v*Math.max(0,Math.min(p[1],b[i][1])-Math.max(p[0],b[i][0])),1);
  const av=a.reduce((v,p)=>v*Math.max(1,p[1]-p[0]),1);
  const bv=b.reduce((v,p)=>v*Math.max(1,p[1]-p[0]),1);
  return intersection/Math.min(av,bv);
}
