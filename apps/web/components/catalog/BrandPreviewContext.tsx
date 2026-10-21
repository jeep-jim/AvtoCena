'use client';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
type Preview={model:string;url:string};
const Context=createContext<{previews:Preview[];add:(rows:Preview[])=>void}>({previews:[],add:()=>{}});
export function BrandPreviewProvider({children}:{children:ReactNode}){
 const [previews,setPreviews]=useState<Preview[]>([]);
 const [add]=useState(()=>(rows:Preview[])=>setPreviews(current=>[...new Map([...current,...rows].map(row=>[row.model,row])).values()]));
 return <Context.Provider value={{previews,add}}>{children}</Context.Provider>;
}
export function BrandPreviewUpdate({rows}:{rows:Preview[]}){
 const {add}=useContext(Context);
 useEffect(()=>{add(rows);},[add,rows]);
 return null;
}
export function useBrandPreviews(){return useContext(Context).previews;}
