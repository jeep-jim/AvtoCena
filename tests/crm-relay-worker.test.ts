import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

test("runner verifies the group, sends one notice, retries only ack, and does not log sensitive responses", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crm-worker-"));
  const fixture = path.join(tmp, "fixture.mjs");
  fs.writeFileSync(fixture, `
    import assert from 'node:assert/strict';
    import crypto from 'node:crypto';
    let sends=0, acks=0;
    globalThis.fetch = async (url, init) => {
      const body=JSON.parse(init.body);
      assert.equal(init.redirect, 'error');
      if (url.includes('/getMe')) return Response.json({ok:true,result:{is_bot:true,username:'avtocena_bot',id:77}});
      if (url.includes('/getChatMember')) return Response.json({ok:true,result:{status:'member',user:{id:77}}});
      if (url.includes('/getChat')) return Response.json({ok:true,result:{id:-2697164330,title:'Заявки TopAvto',type:'group'}});
      if (url.includes('/sendMessage')) {
        sends++; assert.equal(sends,1); assert.equal(body.reply_markup.inline_keyboard.length, 1); assert.ok(body.reply_markup.inline_keyboard[0][0].url); assert.equal(body.chat_id,'-2697164330');
        return Response.json({ok:true,result:{message_id:123}});
      }
      assert.equal(url,'https://avtocena.com/api/internal/crm/relay');
      assert.equal(init.headers['x-crm-relay-key'], crypto.createHmac('sha256','PRIVATE_MASTER').update('avtocena:crm-notification-relay:v1').digest('hex'));
      if (body.action==='claim') return Response.json({ok:true,notices:[{audience:'group',id:'job',token:'PRIVATE_LEASE',chatId:'-2697164330',text:'New request',url:'https://avtocena.com/crm/leads?id=test'}]});
      if (body.action==='authorize') return Response.json({ok:true,allowed:process.env.REVOKED!=='yes'});
      if (body.action==='ack') {
        acks++; assert.equal(body.messageId,123);
        if(acks===1) throw Error('PRIVATE_EXCEPTION');
        return Response.json({ok:true});
      }
      throw Error('unexpected');
    };
    process.on('exit',()=>{assert.equal(sends,process.env.REVOKED==='yes'?0:1);assert.equal(acks,process.env.REVOKED==='yes'?0:2);});
  `);
  try {
    for (const revoked of ["no", "yes"]) {
      const result = spawnSync(process.execPath, ["--import", pathToFileURL(fixture).href, path.resolve("scripts/crm-telegram-delivery.mjs")],
        {encoding: "utf8", env: {...process.env, TELEGRAM_BOT_TOKEN: "PRIVATE_TOKEN", AUTH_ACCESS_KEY: "PRIVATE_MASTER", REVOKED: revoked}});
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE/);
      assert.match(result.stdout, /Delivery batch/);
    }
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
});
