import {notFound} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {CrmShell} from '@/components/crm/CrmShell';
import {DealerBilling} from '@/components/dealers/DealerBilling';
export const dynamic='force-dynamic';
export default async function Page(){if(!isPlatformOwner(await getCurrentUser()))notFound();return <CrmShell activeHref="/crm/dealers" title="Взаиморасчёты дилеров" subtitle="Договоры, начисления, оплаты и документы компаний"><DealerBilling owner/></CrmShell>;}
