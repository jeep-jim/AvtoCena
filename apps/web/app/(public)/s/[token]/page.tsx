import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {cache} from 'react';
import {readShortShare} from '@/lib/catalog/short-share';
import {generateOfferMetadata} from '@/lib/catalog/offer-metadata';
import {ShortShareRedirect} from '@/components/catalog/ShortShareRedirect';
export const dynamic='force-dynamic';
const read=cache(readShortShare);
type Props={params:Promise<{token:string}>;searchParams:Promise<{open?:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {token}=await params,record=await read(token);
 if(!record)return {title:'Ссылка не найдена',robots:{index:false,follow:false}};
 const target=new URL(record.path,'https://avtocena.com');
 const metadata=await generateOfferMetadata({params:Promise.resolve({id:target.pathname.slice('/cars/offer/'.length)}),searchParams:Promise.resolve(Object.fromEntries(target.searchParams))});
 return {...metadata,robots:{index:false,follow:true},openGraph:{...metadata.openGraph,url:`https://avtocena.com/s/${token}`}};
}
export default async function ShortSharePage({params,searchParams}:Props){
 const {token}=await params,record=await read(token);if(!record)notFound();
 return <ShortShareRedirect path={record.path} token={token} mini={record.mini} web={(await searchParams).open==='web'}/>;
}
