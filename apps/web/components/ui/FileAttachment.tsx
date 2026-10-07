 'use client';
import {useState,type InputHTMLAttributes} from 'react';
import {Paperclip} from 'lucide-react';
export function FileAttachment({onChange,...props}:InputHTMLAttributes<HTMLInputElement>){
 const [names,setNames]=useState('');
 return <span style={{display:'inline-flex',alignItems:'center',flexWrap:'wrap',gap:8,maxWidth:'100%'}}><span style={{position:'relative',display:'inline-flex',alignItems:'center',justifyContent:'center',width:44,height:44,border:'1px solid var(--ac-border,#a1aab7)',borderRadius:12,flexShrink:0}}><Paperclip size={21} aria-hidden="true"/><input {...props} type="file" aria-label={props['aria-label']||'Прикрепить файл'} title="Прикрепить файл" style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:0,cursor:'pointer'}} onChange={e=>{onChange?.(e);setNames(Array.from(e.currentTarget.files||[]).map(f=>f.name).join(', '));}}/></span><span style={{fontSize:12,overflowWrap:'anywhere',minWidth:0}}>{names}</span></span>;
}
