import {PRIVACY_VERSION} from '@/lib/privacy-documents';
import Link from 'next/link';
import {PublicHeader} from '@/components/layout/PublicHeader';
export function LegalDocument({title,children}:{title:string;children:React.ReactNode}){
 return <main className="ac-page-copy min-h-screen text-[var(--ac-text)]"><PublicHeader/><article className="mx-auto max-w-4xl px-4 py-10 md:px-8"><Link href="/" className="text-sm font-bold text-red-500">← АвтоЦена</Link><h1 className="mt-6 text-3xl font-black tracking-tight md:text-4xl">{title}</h1><p className="my-4 text-sm text-[var(--ac-muted)]">Редакция от {PRIVACY_VERSION}</p><div className="space-y-7 text-base leading-7">{children}</div><nav className="mt-10 flex flex-wrap gap-4 border-t border-[var(--ac-border)] pt-6 text-sm font-bold"><Link href="/terms">Правила сервиса</Link><Link href="/privacy">Политика</Link><Link href="/consent">Согласие на заявку</Link><Link href="/cookies">Cookie</Link><Link href="/requisites">Реквизиты</Link><Link href="/privacy/request">Обращение по данным</Link></nav></article></main>;
}
