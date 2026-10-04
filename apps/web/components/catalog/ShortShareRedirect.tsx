'use client';
import {useEffect} from 'react';
export function ShortShareRedirect({path,token,mini,web}:{path:string;token:string;mini:boolean;web:boolean}){
 const target=mini&&!web ? `https://t.me/avtocena_bot?startapp=short_${token}` : path;
 useEffect(()=>{window.location.replace(target);},[target]);
 return <main className="mx-auto max-w-xl px-4 py-16"><p>Открываем автомобиль…</p><a href={target} className="underline">Открыть карточку автомобиля</a></main>;
}
