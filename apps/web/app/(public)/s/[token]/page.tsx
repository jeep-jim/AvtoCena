import {readDealerSelection} from '@/lib/dealers/selection-share-server';
import {SELECTION_TITLE} from '@/lib/dealers/selection-share';
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
 if(record.version===2){
  const selection=await readDealerSelection(record);if(!selection)return {title:'Подборка недоступна',robots:{index:false,follow:false}};
  const url=`https://avtocena.com/s/${token}`,title=record.title||SELECTION_TITLE;
  return {title,description:selection.description,robots:{index:false,follow:true},alternates:{canonical:url},openGraph:{type:'website',title,description:selection.description,url,images:selection.images},twitter:{card:selection.images.length?'summary_large_image':'summary',title,description:selection.description,images:selection.images}};
 }
 const target=new URL(record.path,'https://avtocena.com');
 const metadata=await generateOfferMetadata({params:Promise.resolve({id:target.pathname.slice('/cars/offer/'.length)}),searchParams:Promise.resolve(Object.fromEntries(target.searchParams))});
 return {...metadata,robots:{index:false,follow:true},openGraph:{...metadata.openGraph,url:`https://avtocena.com/s/${token}`}};
}
export default async function ShortSharePage({params,searchParams}:Props){
 const {token}=await params,record=await read(token);if(!record)notFound();
 const selection=record.version===2?await readDealerSelection(record):null;if(record.version===2&&!selection)notFound();
 return <ShortShareRedirect selection={record.version===2} path={selection?.path||record.path} token={token} mini={record.mini} web={(await searchParams).open==='web'}/>;
}
