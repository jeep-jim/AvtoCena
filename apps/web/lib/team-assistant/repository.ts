import {editableCodePath} from './policy';
const repo='https://api.github.com/repos/jeep-jim/AvtoCena';
export const codeConnectionReady=()=>Boolean(process.env.TEAM_ASSISTANT_GITHUB_TOKEN);
async function github(path:string,method='GET',body?:unknown){
 const response=await fetch(repo+path,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(method==='GET'?{}:{Authorization:`Bearer ${process.env.TEAM_ASSISTANT_GITHUB_TOKEN}`}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok)throw Error('Не удалось обратиться к репозиторию. Повторите позже.');return response.json();
}
export async function codeHead(){return (await github('/git/ref/heads/main')).object.sha as string;}
export async function readCode(path:string,ref:string){
 if(!editableCodePath(path)||!/^\w{40}$/.test(ref))throw Error('Этот файл не доступен для изменения через помощника.');
 const result=await github('/contents/'+path.split('/').map(encodeURIComponent).join('/')+'?ref='+ref);
 if(result.type!=='file'||result.size>50000||result.encoding!=='base64')throw Error('Выберите небольшой файл интерфейса.');
 return Buffer.from(result.content,'base64').toString('utf8');
}
// A code action only creates a reviewable branch and PR. It never writes main or deploys.
export async function createCodeReview(id:string,base:string,files:{path:string;before:string;after:string}[],summary:string){
 if(!codeConnectionReady())throw Error('Подключение репозитория ещё не настроено.');
 if(await codeHead()!==base)throw Error('Код сайта уже изменился. Попросите подготовить правки заново.');
 if(!files.length||files.length>3||files.some(f=>!editableCodePath(f.path)||f.after.length>50000))throw Error('Недопустимый набор файлов.');
 for(const f of files)if(await readCode(f.path,base)!==f.before)throw Error('Исходный файл изменился. Подготовьте правки заново.');
 const commit=await github('/git/commits/'+base);
 const tree=await github('/git/trees','POST',{base_tree:commit.tree.sha,tree:files.map(f=>({path:f.path,mode:'100644',type:'blob',content:f.after}))});
 const next=await github('/git/commits','POST',{message:'UI: '+summary.slice(0,100),tree:tree.sha,parents:[base]});
 const branch='assistant/ui-'+id;
 await github('/git/refs','POST',{ref:'refs/heads/'+branch,sha:next.sha});
 const pr=await github('/pulls','POST',{title:'ИИ · '+summary.slice(0,100),head:branch,base:'main',draft:true,body:'Правки интерфейса подготовлены внутренним помощником и подтверждены уполномоченным сотрудником.\n\nНужны проверка кода, тесты и отдельная публикация. Автоматическое слияние и установка не выполнялись.\n\nБез персональных данных из переписки.'});
 return String(pr.html_url);
}
