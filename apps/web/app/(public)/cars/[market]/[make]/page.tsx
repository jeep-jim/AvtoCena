import CarsPage, { generateMetadata as catalogMetadata } from '../../page';
import { notFound } from 'next/navigation';
import { marketLanding } from '@/lib/seo/commercial-catalog';
async function query(props: any) { const p = await props.params; if (!marketLanding(p.market)) notFound(); return { ...await props.searchParams, market: p.market, make: p.make }; }
export async function generateMetadata(props: any) { return catalogMetadata({ searchParams: Promise.resolve(await query(props)) }); }
export default async function Page(props: any) { return CarsPage({ searchParams: Promise.resolve(await query(props)) }); }
