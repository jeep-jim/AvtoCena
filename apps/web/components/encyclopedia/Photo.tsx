'use client';
import {useState} from 'react';
export function EncyclopediaPhoto({src,alt}:{src:string;alt:string}){const [failed,setFailed]=useState(false);return src&&!failed?<img src={src} alt={alt} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:<span>{alt}<small style={{display:'block',fontSize:12,fontWeight:500}}>Фото пока нет</small></span>;}
