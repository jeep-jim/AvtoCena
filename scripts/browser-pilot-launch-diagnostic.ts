import {execFileSync} from "node:child_process";
import {randomBytes,randomUUID} from "node:crypto";
import {callBrowser} from "../apps/web/lib/browser-pilot/worker";
const id="fhmvpm7rpunl3cq83q4u", folder="b1g9vq73onqb7dp5hgqg";
function yc(args:string[]){const raw=execFileSync(process.env.YC_BIN!,[...args,"--folder-id",folder,"--format","json"],{encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:120000});return raw.trim()?JSON.parse(raw):null;}
let started=false,config:any, owner=randomBytes(32).toString("hex"), sid=randomUUID();
try{
 const vm=yc(["compute","instance","get","--id",id,"--full"]);
 if(vm.status!=="STOPPED"||vm.labels?.run!=="34456492229"||vm.labels?.app!=="avtocena-browser")throw Error("diagnostic_identity_guard");
 const cloud=JSON.parse(vm.metadata["user-data"].replace(/^#cloud-config\s*/,""));
 const env=cloud.write_files.find((f:any)=>f.path.endsWith("/worker.env")).content;
 const key=env.match(/^BROWSER_WORKER_KEY=(.+)$/m)[1];
 console.log("::add-mask::"+key);
 const ca=cloud.write_files.find((f:any)=>f.path.endsWith("/cert.pem")).content;
 yc(["compute","instance","start","--id",id]);started=true;
 const live=yc(["compute","instance","get","--id",id]);
 config={enabled:true,key,ca,url:"https://"+live.network_interfaces[0].primary_v4_address.one_to_one_nat.address+":8443/v1",expiresAt:Date.now()+60000,instanceId:id,releaseSha:""};
 let healthy=false;
 for(let i=0;i<12;i++){try{const r=await callBrowser(config,{action:"health"});if(r.status===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,2000));}
 if(!healthy)throw Error("diagnostic_health_timeout");
 await callBrowser(config,{action:"create",id:sid,owner,prompt:"Уточни модель. https://avtocena.com/cars/offer/f5a71ab88bd987740e5eaf13"});
 for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,2000));const r=await callBrowser(config,{action:"heartbeat",id:sid,owner});const b=JSON.parse(r.data.toString());if(b.state!=="starting"){console.log(JSON.stringify({state:b.state,error:b.error}));break;}}
 await callBrowser(config,{action:"close",id:sid,owner});
 const serial=execFileSync(process.env.YC_BIN!,["compute","instance","get-serial-port-output","--id",id,"--port","1","--folder-id",folder],{encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:40000,maxBuffer:4000000});
 console.log(serial.split(/\r?\n/).filter(l=>/chromium_launch_error|browser_start_failure/.test(l)).slice(-5).join("\n"));
}finally{
 if(config)await callBrowser(config,{action:"close",id:sid,owner}).catch(()=>{});
 if(started){yc(["compute","instance","stop","--id",id]);console.log("Diagnostic VM stopped");}
}
