import CarsPage from "../page"; export default function Page(props:any){ return CarsPage({ searchParams: { ...(props.searchParams||{}), market: props.params.market } }); }
