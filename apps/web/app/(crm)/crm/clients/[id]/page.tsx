import {ClientWorkspacePage} from '@/components/crm/ClientWorkspacePage';
export const dynamic='force-dynamic';
export default function Page({params}:{params:Promise<{id:string}>}){return <ClientWorkspacePage params={params}/>;}
