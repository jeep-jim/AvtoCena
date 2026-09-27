import { AutoCalcPage } from '@/components/autocalc/AutoCalcPage';
export const metadata={title:'АвтоРасчёт по ссылке — АвтоЦена',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{url?:string}>}){const {url}=await searchParams;return <AutoCalcPage initialUrl={typeof url==='string'?url.slice(0,2048):''}/>;}
