import {CrmShell} from '@/components/crm/CrmShell';
import {DealerReviewsManager} from '@/components/dealers/DealerReviewsManager';
export const dynamic='force-dynamic';
export default function Page(){return <CrmShell title="Отзывы" subtitle="Отзывы покупателей обо всех дилерах" activeHref="/crm/reviews"><DealerReviewsManager/></CrmShell>;}
