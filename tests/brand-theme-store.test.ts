import test from 'node:test';
import assert from 'node:assert/strict';
import {subscribeBrandTheme,readBrandTheme,serverBrandTheme} from '../apps/web/components/catalog/brand-theme-store';
test('hundreds of brand logos share one theme observer and clean it up after unmount',()=>{
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),originalObserver=Object.getOwnPropertyDescriptor(globalThis,'MutationObserver');
  let created=0,disconnected=0,notifications=0,callback=()=>{};
  const root={dataset:{theme:'light'}};const cleanups:Array<()=>void>=[];
  class Observer{constructor(cb:()=>void){created++;callback=cb;}observe(target:unknown,options:unknown){assert.equal(target,root);assert.deepEqual(options,{attributes:true,attributeFilter:['data-theme']});}disconnect(){disconnected++;}}
  try{
    Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:root}});
    Object.defineProperty(globalThis,'MutationObserver',{configurable:true,value:Observer});
    assert.equal(serverBrandTheme(),'light');assert.equal(readBrandTheme(),'light');
    for(let i=0;i<396;i++)cleanups.push(subscribeBrandTheme(()=>{notifications++;}));
    assert.equal(created,1);root.dataset.theme='dark';callback();assert.equal(readBrandTheme(),'dark');assert.equal(notifications,396);
    cleanups.splice(0,395).forEach(fn=>fn());assert.equal(disconnected,0);cleanups.pop()!();assert.equal(disconnected,1);
    const stop=subscribeBrandTheme(()=>{});assert.equal(created,2);stop();assert.equal(disconnected,2);
  }finally{
    cleanups.forEach(fn=>fn());
    if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else delete (globalThis as any).document;
    if(originalObserver)Object.defineProperty(globalThis,'MutationObserver',originalObserver);else delete (globalThis as any).MutationObserver;
  }
});
