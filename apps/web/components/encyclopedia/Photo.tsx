'use client';
import {useRef,useState} from 'react';
export function EncyclopediaPhoto({src,alt}:{src:string;alt:string}){
 const [failed,setFailed]=useState(false),dialog=useRef<HTMLDialogElement>(null);
 return src&&!failed?<><button type="button" className="ac-ency-photo-button" aria-label={`Увеличить фото ${alt}`} onClick={()=>dialog.current?.showModal()}><img src={src} alt={alt} loading="lazy" decoding="async" onError={()=>setFailed(true)}/></button><dialog ref={dialog} className="ac-ency-photo-dialog" onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close();}}><button className="ac-ency-button" type="button" onClick={()=>dialog.current?.close()}>Закрыть</button><img src={src} alt={alt} loading="lazy" decoding="async"/></dialog></>:<span>Нет фото</span>;
}
