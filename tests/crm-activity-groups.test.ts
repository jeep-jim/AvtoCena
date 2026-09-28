import assert from 'node:assert/strict';
import test from 'node:test';
import {groupCrmActivity} from '../apps/web/lib/crm-activity-groups';
import type {CrmActivity} from '../apps/web/lib/crm-activity';
const event=(id:string,extra:Partial<CrmActivity>={}):CrmActivity=>({id,createdAt:'2026-09-28T12:00:00Z',type:'client_updated',title:id,actor:{id:'manager-1',name:'Менеджер'},entityType:'client',href:'/crm/clients/client-1',...extra});
test('same manager and section group without losing details across intervening events',()=>{
 const first=event('1'), second=event('2',{href:'/crm/clients/client-2',changes:[{label:'Имя',before:'А',after:'Б'}]});
 const groups=groupCrmActivity([first,event('other',{actor:{id:'manager-2',name:'Другой'}}),second,event('lead',{href:'/crm/leads?id=1',entityType:'lead'})]);
 assert.equal(groups.length,3);assert.deepEqual(groups[0].events,[first,second]);assert.equal(groups[0].section,'Клиенты');
});
test('local midnight and anonymous website events stay separate',()=>{
 const groups=groupCrmActivity([event('before',{createdAt:'2026-09-28T16:59:00Z'}),event('after',{createdAt:'2026-09-28T17:01:00Z'}),event('site-1',{actor:undefined}),event('site-2',{actor:undefined})]);
 assert.equal(groups.length,4);assert.equal(groups[0].events[0].id,'after');
});
