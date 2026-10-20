import {NextResponse} from 'next/server';
import {headers} from 'next/headers';
import {PUBLIC_CATALOG_MARKETS} from '@/lib/catalog/runtime-config';
import {usesAjesMarket} from '@/lib/catalog/ajes-market-selection';
import {ajesClient} from '@/lib/catalog/ajes-runtime';
import {readAjesColorDirectory} from '@/lib/catalog/ajes-client';
import {readGreenCorner} from '@/lib/catalog/green-corner';
import {localCatalogColors,colorName} from '@/lib/catalog/catalog-color-index';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const p=new URL(request.url).searchParams,market=p.get('market')||'',green=p.get('stock')==='green';
 const selected=PUBLIC_CATALOG_MARKETS.filter(m=>!market||market==='any'||m===market);
 if(!selected.length)return NextResponse.json({ok:false},{status:400});
 const ip=(await headers()).get('x-real-ip')||'';let partial=false;
 const parts=await Promise.all(selected.map(async m=>{
  try{
   if(green&&m==='japan')return (await readGreenCorner()).items.map(row=>colorName(row.color)).filter(Boolean);
   if(await usesAjesMarket(m)){const result=await readAjesColorDirectory(ajesClient,{table:m==='japan'?'stats':m},ip);partial ||= result.stale;return result.colors.map(colorName);}
   return await localCatalogColors([m]);
  }catch{partial=true;return [];}
 }));
 if(!market){try{parts.push((await readGreenCorner()).items.map(row=>colorName(row.color)).filter(Boolean));}catch{partial=true;}}
 return NextResponse.json({ok:true,colors:[...new Set(parts.flat())].filter(color=>color&&!/^[-–—\s]+$/.test(color)).sort((a,b)=>a.localeCompare(b,'ru')),partial},{headers:{'Cache-Control':'private, max-age=30'}});
}
