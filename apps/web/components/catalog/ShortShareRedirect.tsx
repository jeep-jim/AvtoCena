'use client';
import {useEffect} from 'react';
export function ShortShareRedirect({path,token,mini,web,selection=false}:{path:string;token:string;mini:boolean;web:boolean;selection?:boolean}){
 const target=mini&&!web ? `https://t.me/avtocena_bot?startapp=short_${token}` : path;
 useEffect(()=>{window.location.replace(target);},[target]);
 return <main className="mx-auto max-w-xl px-4 py-16"><p>{selection?'Открываем подборку…':'Открываем автомобиль…'}</p><a href={target} className="underline">{selection?'Открыть подборку автомобилей':'Открыть карточку автомобиля'}</a></main>;
}
