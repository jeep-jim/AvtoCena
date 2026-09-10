import {execFileSync} from "node:child_process";
import {randomBytes,randomUUID} from "node:crypto";
import {getJsonStorage} from "../apps/web/lib/data";
import {decryptConfig,encryptConfig,type Envelope,type BrowserConfig} from "../apps/web/lib/browser-pilot/config";
import {callBrowser} from "../apps/web/lib/browser-pilot/worker";
const folder="b1g9vq73onqb7dp5hgqg",id="fhmdp6lj05f294t1js2d",release="a7945d08a56eb9ba1501fe1287ac7721f97fe28b";
function yc(args:string[]){try{const out=execFileSync(process.env.YC_BIN||"yc",[...args,"--folder-id",folder,"--format","json"],{encoding:"utf8",timeout:60000,stdio:["ignore","pipe","pipe"]});return out.trim()?JSON.parse(out):null;}catch{throw Error("resume_cloud_command_failed");}}
const storage=getJsonStorage(),secret=process.env.AUTH_SECRET!;
let started=false,activated=false;
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const prior=await storage.readJsonWithMeta<Envelope|null>("browser-pilot/runtime.json",null);
 if(!prior.value||!prior.etag||!secret)throw Error("resume_config_missing");
 const old=decryptConfig(prior.value,secret);
 if(old.enabled||old.instanceId!=="fhmv7518i3h0gvtu1seb"||old.expiresAt<=Date.now())throw Error("resume_config_guard");
 const all=yc(["compute","instance","list"]).filter((v:any)=>v.name==="avtocena-browser-pilot");
 if(all.length!==1||all[0].id!==id||all[0].status!=="STOPPED"||all[0].labels?.run!=="34463963042")throw Error("resume_instance_guard");
 // Read only this pilot's generated credentials, never log metadata or secrets.
 const vm=yc(["compute","instance","get","--id",id,"--full"]);
 const cloud=JSON.parse(vm.metadata["user-data"].replace(/^#cloud-config\s*/,""));
 const file=(path:string)=>cloud.write_files.find((f:any)=>f.path===path)?.content;
 const env=Object.fromEntries(String(file("/opt/avtocena-browser/worker.env")).trim().split("\n").map(line=>{const ix=line.indexOf("=");return [line.slice(0,ix),line.slice(ix+1)];}));
 const ca=file("/opt/avtocena-browser/tls/cert.pem");
 if(env.RELEASE_SHA!==release||Number(env.PILOT_EXPIRES_AT)!==old.expiresAt||!env.BROWSER_WORKER_KEY||!ca)throw Error("resume_metadata_guard");
 started=true;yc(["compute","instance","start","--id",id]);
 const live=yc(["compute","instance","get","--id",id]);
 const ip=live.network_interfaces?.[0]?.primary_v4_address?.one_to_one_nat?.address;
 if(!ip)throw Error("resume_ip_missing");
 const config:BrowserConfig={enabled:true,url:`https://${ip}:8443/v1`,key:env.BROWSER_WORKER_KEY,ca,expiresAt:old.expiresAt,instanceId:id,releaseSha:release};
 let healthy=false;
 for(let i=0;i<18;i++){try{const r=await callBrowser(config,{action:"health"});const h=JSON.parse(r.data.toString());if(r.status===200&&h.ok&&h.release===release&&h.active===0){healthy=true;break;}}catch{}await pause(3000);}
 if(!healthy)throw Error("resume_health_failed");
 console.log("Existing VM restarted; authenticated health passed.");
 const owner=randomBytes(32).toString("hex"),session=randomUUID();
 const request=(action:string,extra:Record<string,unknown>={})=>callBrowser(config,{action,owner,id:session,...extra});
 const waitWithLease=async(ms:number)=>{for(let elapsed=0;elapsed<ms;elapsed+=4000){await pause(4000);const r=await request("heartbeat");if(r.status!==200)throw Error("resume_lease_failed");}};
 try{
  const prompt="Карточка: https://avtocena.com/cars/offer/81f6d7d4308c77d1b5f320ee . Вопрос: Honda Fit BASIC 2022 характеристики двигателя мощность объём тип топлива рынок Японии. Проверь точную модификацию и приведи источники.";
  const r=await request("create",{prompt});
  if(r.status!==200){const e=JSON.parse(r.data.toString());console.log(JSON.stringify({event:"probe_create_rejected",status:r.status,error:/^[a-z_]+$/.test(e.error)?e.error:"unknown"}));throw Error("resume_create_failed");}
  let ready=false;
  for(let i=0;i<25;i++){await pause(2000);const r=await request("heartbeat");const state=JSON.parse(r.data.toString());if(state.state==="ready"){ready=true;break;}if(state.state==="failed"){const h=JSON.parse((await callBrowser(config,{action:"health"})).data.toString());console.log(JSON.stringify({event:"probe_failed",diagnostic:h.lastFailure}));throw Error("resume_browser_failed");}}
  if(!ready)throw Error("resume_ready_timeout");
  await waitWithLease(24000);
  const frame=await request("frame");
  if(frame.status!==200||frame.type!=="image/jpeg")throw Error("resume_frame_failed");
  console.log(JSON.stringify({event:"synthetic_probe_frame",label:"initial_answer",base64:frame.data.toString("base64")}));
  const sent=await request("send",{text:"Какой код двигателя у этой комплектации?"});
  if(sent.status!==200)throw Error("resume_followup_failed");
  await waitWithLease(24000);
  const refined=await request("frame");
  if(refined.status!==200||refined.type!=="image/jpeg")throw Error("resume_followup_frame_failed");
  console.log(JSON.stringify({event:"synthetic_probe_frame",label:"followup",base64:refined.data.toString("base64")}));
 }finally{await request("close").catch(()=>{});}
 const closed=await request("heartbeat");
 const health=JSON.parse((await callBrowser(config,{action:"health"})).data.toString());
 if(closed.status!==410||health.active!==0)throw Error("resume_cleanup_failed");
 await storage.writeJson("browser-pilot/runtime.json",encryptConfig(config,secret),{ifMatch:prior.etag});
 activated=true;
 console.log(JSON.stringify({event:"pilot_enabled",instanceId:id,release,initialFrame:true,followup:true,closed:true,expiresAt:new Date(old.expiresAt).toISOString()}));
}
main().catch(e=>{console.error(/^resume_[a-z_]+$/.test(e.message)?e.message:"resume_failed");if(started&&!activated){try{yc(["compute","instance","stop","--id",id]);console.log("Existing pilot stopped after failed verification.");}catch{console.error("resume_stop_failed:"+id);}}process.exitCode=1;});
