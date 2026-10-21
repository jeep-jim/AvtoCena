import RequestContent from '@/components/dealers/DealerRequestContent';
import {DealerBrowsingProvider} from '@/components/dealers/DealerBrowsingContext';
import {resolveDealerBrowsingContext} from '@/lib/dealers/resolve-browsing-context';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{dealer?:string;preview?:string}>}){
 const query=await searchParams;const dealer=await resolveDealerBrowsingContext(query.dealer||'',query.preview==='1');
 return <DealerBrowsingProvider dealer={dealer}><RequestContent/></DealerBrowsingProvider>;
}
