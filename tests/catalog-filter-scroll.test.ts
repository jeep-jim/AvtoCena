import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberFilterScroll,restoreFilterScroll} from '../apps/web/lib/catalog/filter-scroll';
test('filter restoration is synchronous, waits for body unlock, and tracks the catalog when dealer hero disappears',()=>{
 const saved=Object.fromEntries(['window','document','location'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let y=1400,top=1000;const calls:number[]=[];
 const location={origin:'https://avtocena.com',href:'https://avtocena.com/dealers/test'};
 const body={style:{position:'',top:''}};
 Object.assign(globalThis,{location,document:{body,querySelector:()=>({getBoundingClientRect:()=>({top:top-y})})},window:{get scrollY(){return y;},setTimeout,clearTimeout,addEventListener(){},removeEventListener(){},dispatchEvent(){},scrollTo({top}:any){calls.push(top);y=top;}}});
 try{
  rememberFilterScroll('/dealers/test?market=china');location.href+='?market=china';top=100;
  body.style.position='fixed';body.style.top='-1400px';restoreFilterScroll();assert.equal(calls.length,0);
  body.style.position='';restoreFilterScroll();assert.deepEqual(calls,[500]);
  restoreFilterScroll();assert.equal(calls.length,1);
  rememberFilterScroll('/dealers/test?market=china&make=Kia');location.href+='&make=Kia';restoreFilterScroll();assert.deepEqual(calls,[500,500]);
 }finally{for(const [k,v] of Object.entries(saved))if(v)Object.defineProperty(globalThis,k,v);else delete (globalThis as any)[k];}
});
