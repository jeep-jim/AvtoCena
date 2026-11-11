import {readAutobotConfig,configReady} from '../autobot/config';
import {regReply} from '../autobot/provider';
// No browser ChatGPT session, cookies, or automatic paid API fallback.
// An explicitly provisioned, authorized Responses connection is required.
export async function providerStatus(){return configReady(await readAutobotConfig())||Boolean(process.env.TEAM_ASSISTANT_RESPONSES_URL&&process.env.TEAM_ASSISTANT_ACCESS_TOKEN&&process.env.TEAM_ASSISTANT_MODEL);}
export async function modelReply(input:unknown[],signal:AbortSignal){
 if(configReady(await readAutobotConfig()))return regReply(input as any[],signal);
 if(!await providerStatus())throw Error('Подключение ChatGPT ещё не завершено. Обратитесь к владельцу.');
 const endpoint=new URL(process.env.TEAM_ASSISTANT_RESPONSES_URL!);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Error('Проверьте подключение помощника.');
 const response=await fetch(endpoint,{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.TEAM_ASSISTANT_ACCESS_TOKEN}`},body:JSON.stringify({model:process.env.TEAM_ASSISTANT_MODEL,input,store:false,stream:true,...(process.env.TEAM_ASSISTANT_WEB_SEARCH==='1'?{tools:[{type:'web_search'}]}:{})})});
 if(!response.ok||!response.body)throw Error(response.status===429?'ChatGPT временно ограничил запросы. Попробуйте позже.':response.status===401||response.status===403?'Нужно восстановить подключение ChatGPT.':'ChatGPT не ответил. Попробуйте ещё раз.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',size=0,completed:any;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024)throw Error('Ответ слишком большой. Уточните запрос.');buffer+=decoder.decode(value,{stream:true});let n:number;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n).trim();buffer=buffer.slice(n+1);if(!line.startsWith('data:')||line==='data: [DONE]')continue;const e=JSON.parse(line.slice(5).trim());if(['response.failed','response.incomplete','error'].includes(e.type))throw Error('ChatGPT не завершил ответ. Повторите запрос.');if(e.type==='response.completed')completed=e.response;}}
 }finally{await reader.cancel().catch(()=>{});}
 if(!completed||completed.status!=='completed')throw Error('Ответ ChatGPT оборвался. Повторите запрос.');
 const output=completed.output||[];
 const text=output.filter((x:any)=>x.type==='message').flatMap((x:any)=>x.content||[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('\n');
 const sources=output.flatMap((x:any)=>x.content||[]).flatMap((x:any)=>x.annotations||[]).filter((x:any)=>x.type==='url_citation'&&/^https:\/\//.test(x.url)).slice(0,12).map((x:any)=>({title:String(x.title||x.url).slice(0,200),url:x.url}));
 if(!text.trim())throw Error('ChatGPT вернул пустой ответ. Повторите запрос.');
 return {text,sources};
}
