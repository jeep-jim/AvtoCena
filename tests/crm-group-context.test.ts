import test from 'node:test';import assert from 'node:assert/strict';import {leadNotice} from '../apps/web/lib/crm-notifications';
test('Telegram notices contain only ID and CRM link, never customer fields or notes',()=>{
 const text=leadNotice({id:'lead',name:'SECRET_NAME',phone:'SECRET_PHONE',city:'SECRET_CITY',comment:'SECRET_TEXT',selectedOffers:[{id:'car',title:'SECRET_CAR'}],internalNote:'SECRET_NOTE'},{comment:'SECRET_FOLLOWUP'});
 assert.match(text,/crm\/leads\?id=lead/);assert.doesNotMatch(text,/SECRET_|\/cars\/offer\//);
});
