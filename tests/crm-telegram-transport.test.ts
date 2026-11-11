import test from "node:test";
import assert from "node:assert/strict";
import {recoverTelegramTransport} from "../scripts/lib/crm-telegram-transport";
const info={url:"https://bbaohms2ccpm3vb4e73t.containers.yandexcloud.net/api/telegram/incoming",pending_update_count:28,last_error_message:"Connection timed out"};
test("recover unreachable known webhook without dropping updates; leave unknown or healthy endpoints alone",async()=>{
 const calls:unknown[]=[];
 const telegram=async(method:string,body?:unknown)=>{calls.push([method,body]);return method==="getWebhookInfo"?{url:"",pending_update_count:28}:true;};
 const set=async(value:boolean)=>{calls.push(["mode",value]);};
 const result=await recoverTelegramTransport(info,true,telegram,set);
 assert.equal(result.recovered,true);assert.equal(result.eventDriven,false);
 assert.deepEqual(calls,[["mode",false],["deleteWebhook",{drop_pending_updates:false}],["getWebhookInfo",undefined]]);
 calls.length=0;
 for(const item of [{...info,url:"https://another.example/receiver"},{...info,pending_update_count:0},{...info,last_error_message:""}]) assert.equal((await recoverTelegramTransport(item,true,telegram,set)).recovered,false);
 assert.equal(calls.length,0);
 await assert.rejects(recoverTelegramTransport(info,true,telegram,async()=>{throw Error("poller_busy");}),/poller_busy/);
 assert.equal(calls.length,0);
 await assert.rejects(recoverTelegramTransport(info,true,async()=>info,set),/webhook_not_removed/);
});
