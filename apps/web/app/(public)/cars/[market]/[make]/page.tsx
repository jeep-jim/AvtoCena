import {catalogSearchMetadata} from '@/lib/catalog/search-metadata';
import CarsPage from "../../page";
export async function generateMetadata(props:any){const [params,searchParams]=await Promise.all([props.params,props.searchParams]);return catalogSearchMetadata({...searchParams,market: params.market,make: params.make});}
export default async function Page(props: any) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  return CarsPage({searchParams: Promise.resolve({...searchParams, market: params.market, make: params.make})});
}
