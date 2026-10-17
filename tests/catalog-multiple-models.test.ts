import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogSearchProjectionMatches} from '../apps/web/lib/catalog/storage';
import {restoreSourceModelName} from '../apps/web/lib/catalog/source-model-name';
import {readPhotoUploadResponse} from '../apps/web/lib/dealers/photo-upload';
import {applyEncyclopediaDisplayIdentity} from '../apps/web/lib/catalog/display-identity';

test('multiple models use OR and still honor make, year and market',()=>{
 const query={make:'Toyota,Kia',model:'Yaris L|KX1',market:'china',yearFrom:2020};
 for(const model of ['Yaris L','YARiS L Zhi Xuan','KX1'])assert.equal(catalogSearchProjectionMatches({make:model==='KX1'?'Kia':'Toyota',model,market:'china',year:2021} as any,query),true);
 for(const change of [{model:'Yaris'},{model:'KX10'},{make:'Honda'},{market:'japan'},{year:2019}])assert.equal(catalogSearchProjectionMatches({make:'Toyota',model:'Yaris L',market:'china',year:2021,...change} as any,query),false);
});
test('Yaris L is restored only from explicit Chinese Toyota source evidence',async()=>{
 const row={make:'Toyota',model:'Yaris',market:'china',calculationSnapshot:{customsInput:{model:'YARiS L Zhi Xuan'}}};
 assert.equal(restoreSourceModelName(row).model,'Yaris L');
 assert.equal((await applyEncyclopediaDisplayIdentity(row)).model,'Yaris L');
 assert.equal(catalogSearchProjectionMatches(row as any,{model:'Yaris L'}),true);
 for(const other of [{...row,market:'japan'},{...row,make:'Honda'},{...row,model:'Yaris Cross'},{...row,calculationSnapshot:{customsInput:{model:'Yaris'}}}])assert.equal(restoreSourceModelName(other).model,other.model);
});
test('upload errors survive non-JSON gateway replies and invalid success bodies',async()=>{
 await assert.rejects(()=>readPhotoUploadResponse(new Response('Request too large',{status:413})),/слишком большое.*413/);
 await assert.rejects(()=>readPhotoUploadResponse(Response.json({message:'unavailable'},{status:502})),/502/);
 await assert.rejects(()=>readPhotoUploadResponse(Response.json({})),/не подтвердил/);
 assert.equal((await readPhotoUploadResponse(Response.json({id:'a',url:'/image/a'}))).id,'a');
});
