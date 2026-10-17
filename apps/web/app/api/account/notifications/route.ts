import {currentAccount} from '@/lib/account/auth';
import {portalData} from '@/lib/account/portal';
import {customerNotices} from '@/lib/account/notifications';
export const dynamic='force-dynamic';
export async function GET(){const a=await currentAccount();if(!a)return new Response(null,{status:401});return Response.json({items:customerNotices(await portalData(a))},{headers:{'Cache-Control':'private, no-store'}});}
