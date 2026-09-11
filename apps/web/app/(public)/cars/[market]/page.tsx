import CarsPage from '../page';
import { notFound } from 'next/navigation';
import { commercialCatalogMeta, marketLanding } from '@/lib/seo/commercial-catalog';
type Props = { params: Promise<{ market: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };
async function query(props: Props) {
  const { market } = await props.params;
  if (!marketLanding(market)) notFound();
  return { ...await props.searchParams, market };
}
export async function generateMetadata(props: Props) { return commercialCatalogMeta(await query(props)); }
export default async function Page(props: Props) { return CarsPage({ searchParams: Promise.resolve(await query(props)) }); }
