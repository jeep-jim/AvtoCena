import CarsPage from "../../page";
export default async function Page(props: any) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  return CarsPage({searchParams: Promise.resolve({...searchParams, market: params.market, make: params.make})});
}
