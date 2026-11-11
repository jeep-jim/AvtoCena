import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogFailureDiagnostic} from '../apps/web/components/catalog/catalog-failure-diagnostic';

test('catalog failure retains an actionable code without storage credentials or request data', () => {
  const error = new Error('object_storage_GET_unreachable:https://private.example/user@example.com?token=secret');
  error.stack = 'Error: token=secret\n at read (/app/.next/server/chunks/123.js:1:45)\n at /private/customer.json:3:7';
  assert.deepEqual(catalogFailureDiagnostic(error), {name:'Error',code:'object_storage_GET_unreachable',locations:['.next/server/chunks/123.js:1:45']});
});
test('catalog failure identifies bounded queue and memory failures', () => {
  assert.equal(catalogFailureDiagnostic(new Error('detail_cache_queue_timeout')).code, 'detail_cache_queue_timeout');
  assert.equal(catalogFailureDiagnostic(new RangeError('Invalid string length')).code, 'invalid_string_length');
  assert.equal(catalogFailureDiagnostic(Object.assign(new Error('private text'), {code:'ECONNRESET'})).code, 'ECONNRESET');
});
test('unknown messages and arbitrary thrown values are not published', () => {
  const error = new Error('Customer name, address and private value');
  error.stack = 'Error: Customer name';
  assert.deepEqual(catalogFailureDiagnostic(error), {name:'Error',code:'unclassified',locations:[]});
  assert.deepEqual(catalogFailureDiagnostic('token=private'), {name:'UnknownError',code:'unclassified',locations:[]});
  assert.equal(catalogFailureDiagnostic(new Error('__proto__')).code, 'unclassified');
  assert.equal(catalogFailureDiagnostic(Object.assign(new Error('private text'), {code:{toString(){throw new Error('must not run');}}})).code, 'unclassified');
  const inaccessible = new Error('private text');
  Object.defineProperty(inaccessible, 'name', {get(){throw new Error('must not escape diagnostics');}});
  assert.deepEqual(catalogFailureDiagnostic(inaccessible), {name:'UnknownError',code:'unclassified',locations:[]});
});
