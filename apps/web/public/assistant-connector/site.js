(() => {
 const source='avtocena-assistant-v1';
 window.addEventListener('message',async e=>{
  if(e.source!==window||e.origin!==location.origin||e.data?.source!==source)return;
  const m=e.data;if(typeof m.id!=='string'||m.id.length>80||!['ping','connect','status','send','disconnect','cancel','open','diagnose'].includes(m.op))return;
  let result;
  try{result=await chrome.runtime.sendMessage({id:m.id,op:m.op,userId:m.userId,provider:m.provider,input:m.input,requestId:m.requestId});}
  catch{result={ok:false,error:'Расширение отключено. Обновите страницу после его включения.'};}
  window.postMessage({source:source+'-reply',id:m.id,...result},location.origin);
 });
})();
