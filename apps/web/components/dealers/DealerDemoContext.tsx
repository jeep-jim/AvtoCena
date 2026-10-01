'use client';
import {createContext,useContext,useEffect} from 'react';
export const DealerDemoContext=createContext(false);
export const useDealerDemo=()=>useContext(DealerDemoContext);

export const DealerUploadContext=createContext<(delta:number)=>void>(()=>{});
export function useDealerUploadBusy(busy:boolean){const change=useContext(DealerUploadContext);useEffect(()=>{if(!busy)return;change(1);return()=>change(-1);},[busy,change]);}
