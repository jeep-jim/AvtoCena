import {notFound} from 'next/navigation';
import Page,{generateMetadata as dealerMetadata} from '../../dealers/[id]/page';
import {resolveDealerProfile} from '@/lib/dealers/showcase-store';
import {validProfilePart} from '@/lib/dealers/profile-url';
export const dynamic='force-dynamic';
type Props={params:Promise<{dealerCity:string;dealerSlug:string}>;searchParams:Promise<{preview?:string}>};
async function resolve(params:Props['params']){
 const {dealerCity, dealerSlug}=await params;
 if(!validProfilePart(dealerCity)||!validProfilePart(dealerSlug))notFound();
 const id=await resolveDealerProfile(dealerCity,dealerSlug);if(!id)notFound();
 return {id};
}
export async function generateMetadata(props:Props){return dealerMetadata({params:resolve(props.params),searchParams:props.searchParams});}
export default async function DealerProfile(props:Props){return Page({params:resolve(props.params),searchParams:props.searchParams});}
