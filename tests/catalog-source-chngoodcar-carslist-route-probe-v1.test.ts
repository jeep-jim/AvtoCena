import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractGoodCarFormContracts,
  extractGoodCarPaginationEvidence,
  extractGoodCarRouteCandidates,
  extractGoodCarScriptSources,
} from '../scripts/catalog-source-chngoodcar-carslist-route-probe-v1.mjs';

const PAGE = 'https://www.chngoodcar.com/Home/CarsList';

test('CarsList route probe extracts only declared script URLs', () => {
  const html = `
    <script src="/Content/js/cars.js?v=1"></script>
    <script src="https://cdn.example.com/lib.js"></script>
    <script>var x = '/Home/GetCars';</script>
  `;
  assert.deepEqual(extractGoodCarScriptSources(html, PAGE), [
    'https://www.chngoodcar.com/Content/js/cars.js?v=1',
    'https://cdn.example.com/lib.js',
  ]);
});

test('CarsList route probe reads form action, method and named fields without inventing params', () => {
  const html = `
    <form action="/Home/CarsList" method="post">
      <input type="hidden" name="PageIndex" value="1">
      <input name="BrandId" value="">
      <select name="FuelType"></select>
    </form>
  `;
  const forms = extractGoodCarFormContracts(html, PAGE);
  assert.equal(forms.length, 1);
  assert.equal(forms[0].action, PAGE);
  assert.equal(forms[0].method, 'POST');
  assert.deepEqual(forms[0].inputs.map((x: any) => x.name), ['PageIndex', 'BrandId', 'FuelType']);
});

test('CarsList route probe extracts same-origin route literals and rejects external endpoints', () => {
  const code = `
    $.ajax({ url: '/Home/GetCarsList', type: 'POST' });
    const detail = '/Home/Cars?id=' + id;
    const other = 'https://evil.example.com/Home/GetCars';
  `;
  assert.deepEqual(extractGoodCarRouteCandidates(code, PAGE), [
    'https://www.chngoodcar.com/Home/GetCarsList',
    'https://www.chngoodcar.com/Home/Cars?id=',
  ]);
});

test('CarsList pagination evidence preserves exact parameter spellings from source code', () => {
  const code = `
    layui.use('laypage', function(){
      laypage.render({ count: total, limit: pageSize, jump: function(obj){
        $.ajax({ url:'/Home/GetCars', data:{ PageIndex: obj.curr, PageSize: obj.limit } });
      }});
    });
  `;
  const evidence = extractGoodCarPaginationEvidence(code);
  assert.ok(evidence.parameterNames.includes('PageIndex'));
  assert.ok(evidence.parameterNames.includes('PageSize'));
  assert.ok(evidence.parameterNames.includes('limit'));
  assert.ok(evidence.snippets.some((x: string) => /GetCars/.test(x)));
});
