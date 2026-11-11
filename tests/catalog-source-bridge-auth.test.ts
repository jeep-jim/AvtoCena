import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceBridgeHeaders,sourceBridgeAuthorized} from '../apps/web/lib/catalog/source-bridge-auth';
test('source bridge rejects anonymous, expired, changed path/query/method and wrong credentials',()=>{
 const url='https://avtocena.com/api/internal/encar-egress-71b8e4?page=1',now=1791590000000,key='offline-test-key';
 const headers=sourceBridgeHeaders(url,key,now);
 assert.equal(sourceBridgeAuthorized(new Request(url,{headers}),key,now),true);
 assert.equal(sourceBridgeAuthorized(new Request(url),key,now),false);
 assert.equal(sourceBridgeAuthorized(new Request(url,{headers}),key,now+121000),false);
 assert.equal(sourceBridgeAuthorized(new Request(url+'0',{headers}),key,now),false);
 assert.equal(sourceBridgeAuthorized(new Request(url.replace('encar-egress-71b8e4','dubizzle-egress-a4c907'),{headers}),key,now),false);
 assert.equal(sourceBridgeAuthorized(new Request(url,{headers,method:'POST'}),key,now),false);
 assert.equal(sourceBridgeAuthorized(new Request(url,{headers}),'other',now),false);
 assert.equal(sourceBridgeAuthorized(new Request(url,{headers}),'',now),false);
 assert.equal(JSON.stringify(headers).includes(key),false);
});
