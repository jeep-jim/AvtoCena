import test from 'node:test';import assert from 'node:assert/strict';import {explain} from '../scripts/safe-prepare-errors.mjs';
test('actual static families and uppercase storage methods are preserved without payload',()=>{
 for(const code of ['catalog_prepared_selection_conflict','budget_supplement_capacity','candidate_budget_write_forbidden','unexpected_write']){const r=explain(new Error(code+':SECRET_URL?key=SECRET'));assert.ok(r.staticCodes.includes(code),code);assert.ok(!JSON.stringify(r).includes('SECRET'));}
 const r=explain(new Error('object_storage_GET_unreachable:fetch failed:path=SECRET:bytes=0'));assert.deepEqual(r.storage,[{method:'GET',status:'unreachable'}]);assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('unknown arbitrary errors always leave class lengths hashes and shape, never original text',()=>{
 const r=explain(new SyntaxError('Unexpected token SECRET_TOKEN in JSON at position 45'));assert.equal(r.class,'SyntaxError');assert.equal(r.signatures.invalidJson,true);assert.ok(r.lines[0].bytes>0);assert.match(r.lines[0].sha256,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(r).includes('SECRET_TOKEN'));
});
test('path-bearing 153-byte write error retains fixed prefix only',()=>{
 const raw='unexpected_write:'+('x'.repeat(135))+'\n';assert.equal(Buffer.byteLength(raw),153);const r=explain({name:'Error',stderr:raw});assert.ok(r.staticCodes.includes('unexpected_write'));assert.equal(r.stderrBytes,153);assert.ok(!JSON.stringify(r).includes('x'.repeat(30)));
});
test('original 153-byte timeout hypothesis and HTTP errors do not lose uppercase method',()=>{
 const raw='object_storage_GET_unreachable:object_storage_response_timeout:path=catalog/generations/gen_1794878284419_a611dfcf/indexes/projection/china.json:bytes=0\n';
 assert.equal(Buffer.byteLength(raw),153);const r=explain({name:'Error',stderr:raw});assert.ok(r.staticCodes.includes('object_storage_response_timeout'));assert.deepEqual(r.storage,[{method:'GET',status:'unreachable'}]);assert.ok(!JSON.stringify(r).includes('projection/'));
 const denied=explain(new Error('object_storage_PUT_403:AccessDenied:SECRET'));assert.deepEqual(denied.storage,[{method:'PUT',status:'403'}]);assert.ok(!JSON.stringify(denied).includes('SECRET'));
});
