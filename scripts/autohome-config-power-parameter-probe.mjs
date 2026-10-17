import fs from 'node:fs/promises';

const SPEC_IDS=['77258','77526','77527','75949'];
const IDS=new Set([1185,1294,9013,1198,1234,9014,8459]);
const H={accept:'text/html,application/xhtml+xml,*/*;q=0.8','accept-language':'zh-CN,zh;q=0.9,en;q=0.7','cache-control':'no-cache',pragma:'no-cache','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'};
function clean(v){return String(v??'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function decode(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{return new TextDecoder('gb18030').decode(bytes)}}
function extract(markup,marker='var config ='){const s=markup.indexOf(marker);if(s<0)return null;const open=markup.indexOf('{',s+marker.length);if(open<0)return null;let depth=0,q='',esc=false;for(let i=open;i<markup.length;i++){const c=markup[i];if(q){if(esc)esc=false;else if(c==='\\')esc=true;else if(c===q)q='';continue}if(c==='"'||c==="'"){q=c;continue}if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return JSON.parse(markup.slice(open,i+1))}catch{return null}}}return null}
async function fetchText(url,referer='https://car.autohome.com.cn/'){const r=await fetch(url,{headers:{...H,referer},redirect:'follow',signal:AbortSignal.timeout(30000)});const body=decode(new Uint8Array(await r.arrayBuffer()));return{r,body}}
const out={generatedAt:new Date().toISOString(),specs:[]};
for(const specId of SPEC_IDS){try{const {r,body}=await fetchText(`https://car.autohome.com.cn/config/spec/${specId}.html`,`https://www.autohome.com.cn/spec/${specId}/`);const config=extract(body);const rows=[];for(const type of config?.result?.paramtypeitems||[]){const typeName=clean(type?.name||type?.typename||type?.title||'');for(const p of type?.paramitems||[]){const id=Number(p?.id);const name=clean(p?.name);if(!IDS.has(id)&&!/功率|马力|电动机/i.test(name))continue;const item=(p?.valueitems||[]).find(x=>Number(x?.specid)===Number(specId));if(!item)continue;const sub=(item.sublist||[]).map(x=>clean(x?.subvalue)).filter(Boolean).join(' / ');const value=clean(item.value)||sub;rows.push({typeName,id,name,value,rawValue:item.value,sub})}}out.specs.push({specId,status:r.status,contentType:r.headers.get('content-type')||'',bytes:body.length,rows});}catch(e){out.specs.push({specId,error:String(e?.message||e)})}}
await fs.writeFile('autohome-config-power-parameter-probe.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
