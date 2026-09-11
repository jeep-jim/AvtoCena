import CarsPage from '../../page';
import { notFound } from 'next/navigation';
import { COMMERCIAL_BUDGETS, commercialCatalogMeta, budgetLandingQuery } from '@/lib/seo/commercial-catalog';
type Props = { params: Promise<{ amount: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };
async function query(props: Props) {
  const { amount } = await props.params;
  if (!COMMERCIAL_BUDGETS.some(value => String(value) === amount)) notFound();
  return budgetLandingQuery(amount, await props.searchParams);
}
export async function generateMetadata(props: Props) { return commercialCatalogMeta(await query(props)); }
export default async function Page(props: Props) { return CarsPage({ searchParams: Promise.resolve(await query(props)) }); }
