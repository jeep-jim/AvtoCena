import {cleanPhotos} from '../../../lib/team-assistant/media';
import {privateField,safePath} from '../../../lib/team-assistant/client-policy';
import type {AssistantContext,AssistantAction} from '../../../lib/team-assistant/types';
type Field=HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;
const visible=(e:HTMLElement)=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[data-team-assistant], [inert], [data-assistant-private]');
export function collectPageContext(enabled:boolean,controls=false):{context:AssistantContext;elements:Map<string,Field>}{
 const path=safePath(location.pathname+location.search)||'/crm',elements=new Map<string,Field>(),fields:AssistantContext['fields']=[];
 if(enabled&&controls){
  for(const e of Array.from(document.querySelectorAll<Field>('input,textarea,select'))){
   if(fields.length>=50||!visible(e)||e.matches(':disabled')||('readOnly' in e&&e.readOnly)||(e instanceof HTMLInputElement&&!['text','number','tel','email','url','date','search'].includes(e.type)))continue;
   const label=e.getAttribute('aria-label')||e.labels?.[0]?.textContent?.trim()||e.getAttribute('placeholder')||e.name;
   if(!label||privateField(label+' '+e.name+' '+e.id+' '+e.autocomplete))continue;
   const id='af-'+fields.length;elements.set(id,e);fields.push({id,label:label.slice(0,160),value:e.value.slice(0,2000),...(e instanceof HTMLSelectElement?{options:Array.from(e.options).map(o=>o.value)}:{})});
  }
 }
 const main=document.querySelector('.crm-content')||document.querySelector('main');
 // Exclude controls, credentials/settings panels, hidden regions and the assistant itself.
 const text=enabled&&main?Array.from(main.querySelectorAll<HTMLElement>('h1,h2,h3,p,td,dt,dd,[data-assistant-context]')).filter(e=>visible(e)&&!e.closest('form,[data-assistant-private]')&&!privateField(e.textContent||'')).map(e=>e.innerText).join('\n').slice(0,14000):'';
 const photos=enabled&&main?cleanPhotos(Array.from(main.querySelectorAll<HTMLImageElement>('img')).filter(e=>visible(e)&&e.naturalWidth>=150&&e.naturalHeight>=100).map(e=>({url:e.currentSrc||e.src,name:e.alt||'Фото со страницы'}))):[];
 return {context:{path,title:document.title.slice(0,200),text,fields,photos,links:enabled&&controls?Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(e=>visible(e)&&e.origin===location.origin&&!!safePath(e.pathname+e.search)&&!privateField(e.textContent||'')).slice(0,40).map(e=>({label:(e.textContent||'').trim().slice(0,160),path:e.pathname+e.search})):[]},elements};
}
export function validateFormAction(action:AssistantAction,elements:Map<string,Field>){
 if(action.kind!=='fill'||action.path!==location.pathname+location.search)throw Error('Вернитесь к исходной форме и повторите запрос.');
 const targets=(action.fields||[]).map(f=>{const e=elements.get(f.id);if(!e||!e.isConnected||!visible(e)||e.matches(':disabled')||('readOnly' in e&&e.readOnly)||privateField((e.getAttribute('aria-label')||'')+' '+e.name+' '+e.id+' '+e.autocomplete)||(e instanceof HTMLSelectElement&&!Array.from(e.options).some(o=>o.value===f.value&&!o.disabled))||e.value!==f.before)throw Error('Форма уже изменена. Попросите подготовить заполнение заново.');return {e,f};});
 return targets;
}
export function applyFormAction(action:AssistantAction,elements:Map<string,Field>){
 const targets=validateFormAction(action,elements);
 for(const {e,f} of targets){const prototype=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')?.set?.call(e,f.value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}
 return targets.length;
}
