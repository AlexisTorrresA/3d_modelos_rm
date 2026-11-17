import test from 'node:test';
import assert from 'node:assert/strict';
import {toPatient,toVoxel,bounds,overlap,isDiffusion,isAnatomical,chooseAnatomical} from './geometry.js';
const basic={
 full_origin:[12,40,-5],full_spacing:[1.1,1.5,2.2],
 full_direction:[1,0,0,0,1,0,0,0,1],full_dimensions:[30,40,50]
};
test('patient-space and voxel-space coordinates round-trip',()=>{
 const ijk=[12,11,15];
 toVoxel(toPatient(ijk,basic),basic).forEach((v,i)=>assert.ok(Math.abs(v-ijk[i])<1e-7));
});
test('DICOM oblique directions stay geometrically correct',()=>{
 const oblique={...basic,full_direction:[0,-1,0,1,0,0,0,0,1]};
 const ijk=[3,10,12];
 toVoxel(toPatient(ijk,oblique),oblique).forEach((v,i)=>assert.ok(Math.abs(v-ijk[i])<1e-7));
});
test('separated anatomical regions must not be fused',()=>{
 assert.ok(overlap(basic,basic)>0.9);
 assert.equal(overlap(basic,{...basic,full_origin:[1000,2000,3000]}),0);
 assert.equal(bounds(basic).length,3);
});
test('DTI/FA/ADC are not suitable as standard structural base',()=>{
 for(const name of ['DTI_6','Reg - DTI_low','dReg - ADC ISO','faReg - FA','facReg - FA COLOR'])
   assert.equal(isDiffusion(name),true,name);
 assert.ok(isAnatomical('T1W_SE'));
 assert.equal(chooseAnatomical([{description:'DTI_6',count:264,id:'dti'},{description:'T1W_SE',count:33,id:'t1'}]).id,'t1');
});
