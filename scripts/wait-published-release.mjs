import fs from 'node:fs';
const expected=process.env.EXPECTED_RELEASE;
if(!/^[a-f0-9]{40}$/.test(expected||''))throw Error('Invalid expected release');
const repository=process.env.GITHUB_REPOSITORY||'jeep-jim/AvtoCena';
for(let attempt=0;attempt<90;attempt++){
 try{
  const response=await fetch('https://avtocena.com/api/health',{signal:AbortSignal.timeout(15000)});
  const health=await response.json(),actual=health.releaseSha;
  let confirmed=response.ok&&health.ok&&actual===expected;
  if(response.ok&&health.ok&&!confirmed&&/^[a-f0-9]{40}$/.test(actual||'')){
   const comparison=await fetch(`https://api.github.com/repos/${repository}/compare/${expected}...${actual}`,{headers:{Accept:'application/vnd.github+json',...(process.env.GITHUB_TOKEN?{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`}:{})},signal:AbortSignal.timeout(15000)});
   if(comparison.ok){const data=await comparison.json();confirmed=data.status==='ahead'&&data.merge_base_commit?.sha===expected;}
  }
  if(confirmed){fs.mkdirSync('artifacts/mobile-filter-release',{recursive:true});fs.writeFileSync('artifacts/mobile-filter-release/health.json',JSON.stringify({expected,...health},null,2));console.log(`Confirmed production release ${actual} contains ${expected}`);process.exit(0);}
 }catch(error){console.log(error.message);}
 await new Promise(resolve=>setTimeout(resolve,10000));
}
throw Error('Production release or verified descendant not confirmed');
