import {getCurrentUser} from '@/lib/auth';
import {canManageDealer,managesAllDealers} from '@/lib/dealers/access';
import {notFound,redirect} from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}){const user=await getCurrentUser();const {id}=await params;if(!await canManageDealer(user,id))notFound();redirect(managesAllDealers(user)?`/crm/dealers/${id}`:'/dealer-cabinet');}
