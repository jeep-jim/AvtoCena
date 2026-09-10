import {execFileSync} from "node:child_process";
import {appendFileSync} from "node:fs";
import {getJsonStorage} from "../apps/web/lib/data";
import {encryptConfig,decryptConfig,type Envelope} from "../apps/web/lib/browser-pilot/config";
const id="fhmvvsmoc6vpu3jbbhkc", release="a9d3dfe330d0049f6da0ada37d79618930256d03";
function yc(args:string[]) {
 try {
  const out=execFileSync(process.env.YC_BIN||"yc",[...args,"--folder-id","b1g9vq73onqb7dp5hgqg","--format","json"],{encoding:"utf8",timeout:60000,stdio:["ignore","pipe","pipe"]});
  return out.trim()?JSON.parse(out):null;
 } catch(e:any) {throw Error("YC "+args.slice(0,3).join(" ")+": "+(String(e.stderr||"").match(/code = ([A-Za-z_]+)/)?.[1]||"command_failed"));}
}
function report(value:unknown){const line=JSON.stringify(value);console.log(line);if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,line+"\n");}
async function main(){
 const secret=process.env.AUTH_SECRET;if(!secret||secret.length<20)throw Error("secret_missing");
 const storage=getJsonStorage();if(storage.driver!=="object")throw Error("object_storage_required");
 const meta=await storage.readJsonWithMeta<Envelope|null>("browser-pilot/runtime.json",null);
 if(!meta.value||!meta.etag)throw Error("runtime_missing");
 const config=decryptConfig(meta.value,secret);
 if(config.instanceId!==id||config.releaseSha!==release)throw Error("runtime_identity_mismatch");
 const vm=yc(["compute","instance","get","--id",id]);
 if(vm.id!==id||vm.name!=="avtocena-browser-pilot"||vm.labels?.app!=="avtocena-browser"||vm.labels?.run!=="34467365953")throw Error("vm_identity_mismatch");
 if(!["RUNNING","STOPPED"].includes(vm.status))throw Error("unexpected_vm_status");
 await storage.writeJson("browser-pilot/runtime.json",encryptConfig({...config,enabled:false},secret),{ifMatch:meta.etag});
 report({runtimeEnabled:false,instanceId:id});
 if(vm.status!=="STOPPED")yc(["compute","instance","stop","--id",id]);
 const stopped=yc(["compute","instance","get","--id",id]);
 if(stopped.status!=="STOPPED")throw Error("stop_not_confirmed");
 const check=await storage.readJsonWithMeta<Envelope|null>("browser-pilot/runtime.json",null);
 if(!check.value)throw Error("runtime_verification_missing");
 const saved=decryptConfig(check.value,secret);
 if(saved.enabled||saved.instanceId!==id)throw Error("runtime_verification_failed");
 report({completedAt:new Date().toISOString(),instanceId:id,status:stopped.status,runtimeEnabled:saved.enabled,diskRetained:true});
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
