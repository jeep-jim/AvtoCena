// Preview a captured real offer with just the changed production components.
// Usage: node scripts/catalog-design-preview.mjs output.html snapshot.html offer.json
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
const [output, snapshot, offerPath] = process.argv.slice(2);
if (!output || !snapshot || !offerPath) throw new Error('Supply output.html, prepared snapshot.html, and offer.json');
const root = process.cwd();
const offer = JSON.parse(await fs.readFile(offerPath, 'utf8'));
const groups = [{name:'Об автомобиле',items:[
  {name:'Марка',value:offer.make}, {name:'Модель',value:offer.model}, {name:'Комплектация',value:offer.trim},
  {name:'Год в объявлении',value:String(offer.year)}, {name:'Пробег, км',value:String(offer.mileageKm)}, {name:'Кузов',value:offer.bodyLabel},
]}, {name:'Данные аукциона',items:[
  {name:'Оценка аукциона',value:offer.auctionGrade}, {name:'Аукцион',value:offer.auctionName},
  {name:'Дата аукциона',value:offer.auctionDate}, {name:'Лот',value:offer.lotNumber},
]}];
const css = await postcss([tailwind({content:['apps/web/components/catalog/OfferSpecificationsDisclosure.tsx','apps/web/components/catalog/OfferAllSpecifications.tsx','apps/web/components/catalog/JapanAuctionBadges.tsx'],corePlugins:{preflight:false},theme:{extend:{}},plugins:[]})]).process('@tailwind utilities;', {from:undefined});
const bundled = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
import {OfferSpecificationsDisclosure} from './apps/web/components/catalog/OfferSpecificationsDisclosure';
import {JapanAuctionBadges} from './apps/web/components/catalog/JapanAuctionBadges';
const groups=${JSON.stringify(groups)};
for(const mode of ['desktop','mobile'])createRoot(document.getElementById('specifications-'+mode)).render(<OfferSpecificationsDisclosure groups={groups} title=${JSON.stringify(offer.title)} mode={mode}/>);
createRoot(document.getElementById('auction-badges')).render(<JapanAuctionBadges offer={{auctionGrade:${JSON.stringify(offer.auctionGrade)}}}/>);
document.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault()});
const main=document.querySelector('button[aria-label="Открыть фотографии автомобиля"] img');
for(const b of document.querySelectorAll('button[aria-label^="Открыть фото "]')) b.addEventListener('click',()=>{const img=b.querySelector('img');if(img&&main)main.src=img.src});
`,loader:'tsx',resolveDir:root},bundle:true,write:false,minify:true,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':path.join(root,'apps/web')}});
let page=await fs.readFile(snapshot,'utf8');
page=page.replace('</head>',`<style>${css.css}</style></head>`).replace('</body>',`<script>${bundled.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body>`);
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>АвтоЦена · исправленная карточка Nissan Note</title><style>body{margin:0;background:#dfe4eb;color:#20252f;font:14px Arial}header{position:sticky;top:0;background:#fff;padding:12px 20px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;z-index:1}button{font:inherit;border:1px solid #ddd;border-radius:8px;padding:9px 14px;background:#fff;cursor:pointer}button[aria-pressed=true]{background:#e32c39;color:#fff;border-color:#e32c39}main{overflow:auto;padding:20px}iframe{display:block;border:0;width:1366px;height:1050px;margin:auto;background:#eef0f5}small{color:#626b7a}</style></head><body><header><strong>Nissan Note · изменения в карточке</strong><button id="desktop" aria-pressed="true">Компьютер</button><button id="mobile" aria-pressed="false">Телефон</button><small>Откройте «Все характеристики». Цены сохранены со страницы; это показ интерфейса.</small></header><main><iframe title="Карточка Nissan Note"></iframe></main><script>const frame=document.querySelector('iframe');frame.srcdoc=${JSON.stringify(page).replaceAll('</script','<\\/script')};for(const id of ['desktop','mobile'])document.getElementById(id).onclick=()=>{frame.style.width=id==='mobile'?'390px':'1366px';frame.style.height=id==='mobile'?'844px':'1050px';for(const key of ['desktop','mobile'])document.getElementById(key).setAttribute('aria-pressed',String(key===id));};</script></body></html>`;
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,html);console.log(output);
