import CarsPage from "../cars/page";
import {redirect} from "next/navigation";
import {miniAppLaunchPath} from "../../../lib/telegram-miniapp";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {title:"АвтоЦена — каталог в Telegram",robots:{index:false,follow:true}};
export default async function MiniPage(props: Parameters<typeof CarsPage>[0]) {
  const query = await props.searchParams;
  const start = query?.tgWebAppStartParam;
  const target = miniAppLaunchPath(Array.isArray(start) ? start[0] : start);
  if(target) redirect(target);
  return CarsPage(props);
}
