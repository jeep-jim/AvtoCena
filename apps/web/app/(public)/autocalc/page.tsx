import { AutoCalcPage } from '@/components/autocalc/AutoCalcPage';
export const metadata={title:'АвтоРасчёт по ссылке — АвтоЦена',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{url?:string;title?:string}>}){const {url,title}=await searchParams;return <AutoCalcPage initialTitle={typeof title==='string'?title.slice(0,180):''} initialUrl={typeof url==='string'?url.slice(0,2048):''}/>;}
