import {getJsonStorage} from '@/lib/data';
import {readEncyclopedia} from '@/lib/encyclopedia/records';
import {csvHeader,modelCsv} from '@/lib/encyclopedia/csv';
import type {ModelRecord} from '@/lib/encyclopedia/schema';
export const dynamic='force-dynamic';
export async function GET(request:Request){const manifest=await readEncyclopedia();if(!manifest)return Response.json({error:'Энциклопедия ещё готовится.'},{status:503});const id=new URL(request.url).searchParams.get('model');const models=id?manifest.models.filter(m=>m.id===id):manifest.models;if(id&&!models.length)return Response.json({error:'Модель не найдена.'},{status:404});
 const encoder=new TextEncoder();let index=-1;
 const stream=new ReadableStream({async pull(controller){try{if(index===-1){controller.enqueue(encoder.encode('\uFEFF'+csvHeader));index=0;return;}if(index>=models.length){controller.close();return;}const batch=models.slice(index,index+6);index+=batch.length;const records=await Promise.all(batch.map(m=>getJsonStorage().readJson<ModelRecord|null>(m.key,null)));for(const record of records){if(!record)throw Error('encyclopedia_export_record_missing');controller.enqueue(encoder.encode(modelCsv(record)));}}catch(error){controller.error(error);}}});
 return new Response(stream,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="avtocena-encyclopedia${id?'-'+id:''}.csv"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
