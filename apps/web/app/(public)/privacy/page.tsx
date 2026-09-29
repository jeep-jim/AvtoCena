import {LegalDocument} from '@/components/legal/LegalDocument';
import {PRIVACY_SECTIONS} from '@/lib/privacy-documents';
import Link from 'next/link';
export const metadata={title:'Политика обработки персональных данных — АвтоЦена',alternates:{canonical:'https://avtocena.com/privacy'}};
export default function Page(){return <LegalDocument title="Политика обработки персональных данных">{PRIVACY_SECTIONS.map(([title,text])=><section key={title}><h2 className="mb-3 text-xl font-bold">{title}</h2><p>{text}</p></section>)}<Link className="inline-block rounded-xl bg-red-600 px-5 py-3 font-bold text-white" href="/privacy/request">Направить обращение по персональным данным</Link></LegalDocument>;}
