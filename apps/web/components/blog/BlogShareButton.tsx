"use client";
import {useState} from 'react';
import {Share2} from 'lucide-react';
export function BlogShareButton({title,slug}:{title:string;slug:string}){
 const [status,setStatus]=useState('');
 async function share(){
  const url=new URL(`/blog/${slug}`,window.location.origin).toString();
  if(navigator.share){try{await navigator.share({title,url});setStatus('');return;}catch(error){if((error as Error).name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(url);setStatus('Ссылка скопирована');}
  catch{setStatus('Не удалось скопировать ссылку. Скопируйте адрес из строки браузера.');}
 }
 return <div className="ac-blog-share"><button type="button" onClick={()=>void share()}><Share2 size={18} aria-hidden="true"/>Поделиться</button><span role="status">{status}</span></div>;
}
