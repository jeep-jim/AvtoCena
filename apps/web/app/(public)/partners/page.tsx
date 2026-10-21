import {notFound} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {readPublicFeatures} from '@/lib/dealers/showcase-store';
import {readDealerProgram} from '@/lib/dealers/program-store';
import {PartnerLanding} from '@/components/partners/PartnerPages';
import {partnerLanguage,CONTENT} from '@/lib/partners/content';
export const dynamic='force-dynamic';
export async function generateMetadata({searchParams}:{searchParams:Promise<Record<string,string>>}){const q=await searchParams,f=await readPublicFeatures(),lang=partnerLanguage(q.lang);return {title:`${CONTENT[lang].eyebrow} — АвтоЦена`,robots:{index:f.partnersEnabled===true&&!q.preview,follow:f.partnersEnabled===true&&!q.preview}};}
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}){const q=await searchParams,f=await readPublicFeatures(),preview=q.preview==='1'&&isPlatformOwner(await getCurrentUser());if(!f.partnersEnabled&&!preview)notFound();return <div data-site-preview={preview?"true":undefined}><PartnerLanding customTitle={f.siteControls?.partners?.title} customDescription={f.siteControls?.partners?.description} lang={partnerLanguage(q.lang)} preview={preview} program={await readDealerProgram()} knowledgeEnabled={f.knowledgeEnabled===true} partnersEnabled={f.partnersEnabled===true}/></div>;}
