import {GreenCornerCatalog} from "@/components/catalog/GreenCornerCatalog";
export const dynamic="force-dynamic";
export const metadata={title:"Зелёный угол — автомобили в наличии в Японии | АвтоЦена"};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){return <GreenCornerCatalog params={await searchParams}/>;}
