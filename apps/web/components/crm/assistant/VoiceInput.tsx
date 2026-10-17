'use client';
import {useEffect,useRef,useState} from 'react';
import {Mic} from 'lucide-react';
type Recognition={lang:string;continuous:boolean;interimResults:boolean;onstart:(()=>void)|null;onresult:((e:any)=>void)|null;onerror:((e:any)=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
export function VoiceInput({disabled,onText,onError}:{disabled:boolean;onText:(text:string)=>void;onError:(text:string)=>void}){
 const active=useRef<Recognition|null>(null),timeout=useRef<ReturnType<typeof setTimeout>>(),cancelled=useRef(false),words=useRef(''),held=useRef(false),callback=useRef(onText);
 callback.current=onText;
 const [recording,setRecording]=useState(false),[preview,setPreview]=useState('');
 function stop(cancel=false){held.current=false;if(!active.current)return;cancelled.current=cancel;clearTimeout(timeout.current);setRecording(false);if(cancel)active.current.abort();else active.current.stop();}
 useEffect(()=>{const hide=()=>{if(document.hidden)stop(true);};document.addEventListener('visibilitychange',hide);return()=>{document.removeEventListener('visibilitychange',hide);clearTimeout(timeout.current);cancelled.current=true;if(active.current){active.current.onend=null;active.current.onresult=null;active.current.onerror=null;active.current.abort();}};},[]);
 useEffect(()=>{if(disabled)stop(true);},[disabled]);
 function start(){
  if(disabled||active.current)return;
  const w=window as unknown as {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition},Ctor=w.SpeechRecognition||w.webkitSpeechRecognition;
  if(!Ctor){onError('В этом браузере голосовой ввод недоступен. Можно использовать микрофон экранной клавиатуры.');return;}
  const r=new Ctor();active.current=r;cancelled.current=false;held.current=true;words.current='';setPreview('');onError('');r.lang='ru-RU';r.continuous=true;r.interimResults=true;
  r.onstart=()=>{if(!held.current)r.stop();};
  r.onresult=e=>{let value='';for(let i=0;i<e.results.length;i++)value+=e.results[i][0].transcript+' ';words.current=value.trim().slice(0,6000);setPreview(words.current);};
  r.onerror=e=>{if(cancelled.current)return;cancelled.current=true;onError(e.error==='not-allowed'||e.error==='service-not-allowed'?'Разрешите микрофон и распознавание речи в настройках браузера. На iPhone также проверьте, включена ли Siri.':e.error==='no-speech'?'Речь не услышана. Удерживайте микрофон и говорите.':'Не удалось распознать речь. Попробуйте ещё раз или используйте микрофон клавиатуры.');};
  r.onend=()=>{clearTimeout(timeout.current);active.current=null;setRecording(false);setPreview('');if(!cancelled.current&&words.current)callback.current(words.current);};
  try{r.start();setRecording(true);timeout.current=setTimeout(()=>stop(),60000);}catch{active.current=null;setRecording(false);onError('Не удалось включить микрофон. Проверьте разрешение браузера.');}
 }
 return <div className="ta-voice"><button type="button" className={recording?'is-recording':''} disabled={disabled} title="Удерживайте для голосового ввода" aria-label="Удерживайте для голосового ввода" aria-pressed={recording} onContextMenu={e=>e.preventDefault()} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);start();}} onPointerUp={()=>stop()} onPointerCancel={()=>stop(true)} onKeyDown={e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();start();}if(e.key==='Escape')stop(true);}} onKeyUp={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();stop();}}} onBlur={()=>stop()}><Mic size={18}/></button>{recording&&<span role="status">{preview||'Отпустите кнопку, чтобы добавить текст'}</span>}</div>;
}
