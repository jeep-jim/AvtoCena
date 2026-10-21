import {notFound} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {readPublicFeatures} from '@/lib/dealers/showcase-store';
import {KnowledgeBase} from '@/components/partners/PartnerPages';
import {partnerLanguage,CONTENT} from '@/lib/partners/content';
export const dynamic='force-dynamic';
export async function generateMetadata({searchParams}:{searchParams:Promise<Record<string,string>>}){const q=await searchParams,f=await readPublicFeatures(),lang=partnerLanguage(q.lang);return {title:`${CONTENT[lang].knowledge} — АвтоЦена`,robots:{index:f.knowledgeEnabled===true&&!q.preview,follow:f.knowledgeEnabled===true&&!q.preview}};}
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}){const q=await searchParams,f=await readPublicFeatures(),preview=q.preview==='1'&&isPlatformOwner(await getCurrentUser());if(!f.knowledgeEnabled&&!preview)notFound();return <div data-site-preview={preview?"true":undefined}><KnowledgeBase customTitle={f.siteControls?.knowledge?.title} customDescription={f.siteControls?.knowledge?.description} lang={partnerLanguage(q.lang)} preview={preview} knowledgeEnabled={f.knowledgeEnabled===true} partnersEnabled={f.partnersEnabled===true} initialArticle={q.article} initialCategory={q.category}/></div>;}
