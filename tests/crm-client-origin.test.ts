import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isManuallyAddedClient,manualClientIndex} from '../apps/web/lib/crm-client-origin';
const client={id:'manual-client',source:'manual',createdByManagerId:'manager',createdAt:'2026-09-25T10:39:00Z',phone:'+7 (905) 075-85-55'};
const lead={createdAt:'2026-09-25T11:00:00Z',phone:'89050758555',clientId:'separate-web-client'};
test('manual origin recognizes existing records and explicit new origin, not assigned website clients',()=>{
 assert.equal(isManuallyAddedClient(client),true);
 assert.equal(isManuallyAddedClient({...client,source:'custom',creationSource:'manual'}),true);
 assert.equal(isManuallyAddedClient({...client,source:'site'}),false);
 assert.equal(isManuallyAddedClient({...client,createdByManagerId:''}),false);
});
test('later lead recognizes a unique complete normalized phone and linked client',()=>{
 const find=manualClientIndex([client]);assert.equal(find(lead)?.id,client.id);
 assert.equal(find({...lead,phone:'',clientId:client.id})?.id,client.id);
 assert.equal(find({...lead,phone:'+79991111111',initialContact:{phone:lead.phone}})?.id,client.id);
});
test('no first-contact claim from later records, partial phones, ambiguous contacts or invalid dates',()=>{
 const find=manualClientIndex([client]);
 for(const row of [{...lead,createdAt:client.createdAt},{...lead,createdAt:'2026-09-24T11:00:00Z'},{...lead,createdAt:''},{...lead,phone:'0758555'},{...lead,phone:''},{...lead,phone:'890507585550'}])assert.equal(find(row),null);
 assert.equal(manualClientIndex([client,{...client,id:'duplicate-manual'}])(lead),null);
 assert.equal(manualClientIndex([{...client,createdAt:'invalid'}])(lead),null);
 assert.equal(manualClientIndex([])(lead),null);
});
