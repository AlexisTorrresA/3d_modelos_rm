import test from 'node:test';import assert from 'node:assert/strict';
import {mapReportToAtlas,classifyAtlasSeries,ATLAS_PARTS} from './atlasRules.js';
test('no invented tumor without location from source',()=>{
 const findings=[{id:'x',category:'lesion',label:'Lesión',assertion:'mentioned',regions_in_text:[],evidence:'lesión de tamaño desconocido',review_status:'pending'}];
 assert.deepEqual(mapReportToAtlas(findings),[]);
});
test('explicit spinal dissemination is schematic, not DICOM geometry',()=>{
 const f=[{id:'x',category:'leptomeningeal',label:'Meninges',assertion:'uncertain',
 regions_in_text:['región espinal'],evidence:'Posible diseminación leptomeníngea C4–T4',review_status:'pending'}];
 const result=mapReportToAtlas(f);
 assert.equal(result.length,1);assert.equal(result[0].source_type,'report_text');
 assert.equal(result[0].illustrative,true);
 assert.match(result[0].territory,/Nivel C4/);
});
test('negation, dismissal and non-lesion mentions never create pseudo-lesions',()=>{
 const base={id:'x',category:'lesion',regions_in_text:['hipotálamo'],evidence:'tumor hipotalámico'};
 const items=[{...base,assertion:'negated',review_status:'pending'},
  {...base,id:'y',assertion:'mentioned',review_status:'dismissed'},
  {...base,id:'z',category:'brain',assertion:'mentioned',review_status:'pending'}];
 assert.equal(mapReportToAtlas(items).length,0);
});
test('atlas anatomy is a separate source, not all DICOM combined',()=>{
 assert.ok(ATLAS_PARTS.some(x=>x.id==='brain'));
 const summary=classifyAtlasSeries([{description:'DTI_6'},{description:'T1W_SE'},{description:'Spine T2'}]);
 assert.equal(summary.total,3);assert.equal(summary.diffusion,1);assert.equal(summary.anatomical,2);
});
