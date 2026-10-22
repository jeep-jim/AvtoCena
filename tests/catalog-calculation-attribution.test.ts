import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

test('linked calculation retains its author and time independently of the latest public draft',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'.attribution-test-'));
 try {
  const path=join(dir,'component.cjs');
  await build({entryPoints:['apps/web/components/catalog/InlineOfferParameters.tsx'],outfile:path,bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
  const {InlineOfferParameters}=createRequire(import.meta.url)(path);
  const draft={year:'2017',fuel:'petrol',engineCc:'1800',powerHp:'143',deliveryCity:''};
  const calculation={totalRub:1449706};
  const props={offerId:'test',initial:draft,price:'Цена',children:null,canSave:true,savedCalculation:{version:'latest',draft,calculation,savedAt:'2026-10-22T06:00:00Z',savedByName:'Новый автор'}};
  const scenario={draft:{...draft,deliveryCity:'Новокузнецк'},calculation,savedAt:'2026-10-22T05:01:00Z',savedByName:'Автор ссылки'};
  const render=(extra:any)=>renderToStaticMarkup(React.createElement(InlineOfferParameters,{...props,...extra}));
  const linked=render({initialScenario:scenario});
  assert.match(linked,/Автор ссылки/);assert.match(linked,/22.10.2026, 12:01/);assert.doesNotMatch(linked,/Новый автор/);
  assert.match(render({}),/Новый автор/);
  assert.doesNotMatch(render({initialScenario:{draft:scenario.draft,calculation}}),/Расчёт сохранён|Новый автор/);
  assert.doesNotMatch(render({initialScenario:scenario,canSave:false}),/Автор ссылки|Расчёт сохранён/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
