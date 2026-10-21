export const assistantProviders = [
 {id:'gpt',name:'ChatGPT',mark:'GPT'},
 {id:'alice',name:'Алиса',mark:'А'},
 {id:'googleai',name:'Google',mark:'G'},
 {id:'deepseek',name:'DeepSeek',mark:'🐋'},
] as const;
export type AssistantProvider = typeof assistantProviders[number]['id'];
export const isAssistantProvider=(value:unknown):value is AssistantProvider=>assistantProviders.some(p=>p.id===value);
export const assistantProviderName=(value:unknown)=>assistantProviders.find(p=>p.id===value)?.name||'ChatGPT';
