import {publicDealerProfile} from '@/lib/dealers/public-profile';
import {publicRail} from '@/lib/dealers/public-rail';
import {availableShowcase} from '@/lib/dealers/program-store';
import {withDealerRate} from '@/lib/dealers/exchange-rate';
import {PILOT_DEALER_ID} from '@/lib/dealers/showcase-model';
import {readShowcase,findDealer} from "@/lib/dealers/showcase-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const stored = await readShowcase(PILOT_DEALER_ID);
  const dealer = stored?.profileEnabled ? await withDealerRate(await availableShowcase(stored)) : null;
  const preview = dealer?.profileEnabled ? {
    profile: publicDealerProfile(dealer),
    items: publicRail(dealer),
    verified: (await findDealer(PILOT_DEALER_ID))?.status === 'verified',
  } : null;
  return Response.json(preview, {headers: {'Cache-Control': 'private, no-store'}});
}
