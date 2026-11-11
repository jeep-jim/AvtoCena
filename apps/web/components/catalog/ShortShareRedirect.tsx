'use client';
import {useEffect} from 'react';
import {adoptSelectionCity} from '@/lib/location/selected-city';
export function ShortShareRedirect({path,selection=false}:{path:string;token:string;mini:boolean;web:boolean;selection?:boolean}){
 // The saved mini flag describes the sender, not the recipient's browser.
 // Stay on the website; a Telegram launch also resolves this same public path.
 const target=path;
 useEffect(()=>{if(selection)adoptSelectionCity(new URL(path,window.location.origin).search);window.location.replace(target);},[target,path,selection]);
 return <main className="mx-auto max-w-xl px-4 py-16"><p>{selection?'Открываем подборку…':'Открываем автомобиль…'}</p><a href={target} className="underline">{selection?'Открыть подборку автомобилей':'Открыть карточку автомобиля'}</a></main>;
}
