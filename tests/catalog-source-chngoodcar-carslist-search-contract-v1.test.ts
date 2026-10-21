import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPagerContract, parseJsLiteral, splitJsArgs } from '../scripts/catalog-source-chngoodcar-carslist-search-contract-v1.mjs';

test('Good Car CarsList search contract splits JS arguments without losing quoted commas', () => {
  assert.deepEqual(splitJsArgs(`'', 0, 'a,b', "x", null`), ["''", '0', "'a,b'", '"x"', 'null']);
});

test('Good Car CarsList search contract only treats literals as exact', () => {
  assert.deepEqual(parseJsLiteral("''"), { exact: true, type: 'string', value: '' });
  assert.deepEqual(parseJsLiteral('15'), { exact: true, type: 'number', value: 15 });
  assert.equal(parseJsLiteral('api.getCurrent()').exact, false);
});

test('Good Car CarsList search contract proves endpoint, POST, page size and literal initial call', () => {
  const code = `
    var headers = headerRequestVerificationToken();
    function pager(Hot, DefaultSort, Category, pageindex) {
      var pagesize = 15;
      var url = "../Car/SearchCarList";
      $.ajax({ url: url, type: 'POST', data: { Hot: Hot, DefaultSort: DefaultSort, Category: Category, pageindex: pageindex, pagesize: pagesize } });
    }
    pager('', '', '', 1);
    function later(api){ pager('', '', '', api.getCurrent()); }
  `;
  const contract = extractPagerContract(code);
  assert.deepEqual(contract.signature, ['Hot', 'DefaultSort', 'Category', 'pageindex']);
  assert.equal(contract.endpoint, 'https://www.chngoodcar.com/Car/SearchCarList');
  assert.equal(contract.method, 'POST');
  assert.equal(contract.pagesize, 15);
  assert.equal(contract.calls.length, 2);
  assert.equal(contract.calls[0].allLiteral, true);
  assert.deepEqual(contract.calls[0].args.map((x: any) => x.value), ['', '', '', 1]);
  assert.equal(contract.calls[1].allLiteral, false);
});
