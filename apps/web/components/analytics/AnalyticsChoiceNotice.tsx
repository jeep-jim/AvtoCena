'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {ANALYTICS_EVENT,analyticsChoice,setAnalyticsChoice} from '@/lib/privacy-consent';
import {isPublicPagePath} from '@/lib/public-page-url';
export function AnalyticsChoiceNotice(){
 const pathname=usePathname(),[visible,setVisible]=useState(false);
 useEffect(()=>{const sync=()=>setVisible(analyticsChoice()===null);sync();window.addEventListener(ANALYTICS_EVENT,sync);window.addEventListener('storage',sync);return()=>{window.removeEventListener(ANALYTICS_EVENT,sync);window.removeEventListener('storage',sync);};},[pathname]);
 if(!visible||!isPublicPagePath(pathname)||pathname.startsWith('/privacy/request'))return null;
 return <aside className="ac-analytics-choice" aria-label="Выбор аналитики"><p>Разрешить cookie Яндекс Метрики для статистики и оценки рекламы, включая стадии заявки? <Link href="/cookies" target="_blank">Подробнее</Link></p><div><button type="button" onClick={()=>setAnalyticsChoice(true)}>Разрешить</button><button type="button" onClick={()=>setAnalyticsChoice(false)}>Без аналитики</button></div><style>{`.ac-analytics-choice{position:fixed;z-index:65;left:12px;right:12px;bottom:calc(92px + env(safe-area-inset-bottom));max-width:480px;padding:12px;border:1px solid var(--ac-border);border-radius:16px;background:var(--ac-surface,#fff);color:var(--ac-text,#202633);box-shadow:0 4px 20px #0002;font-size:13px;line-height:1.4}.ac-analytics-choice p{margin:0 0 9px}.ac-analytics-choice a{text-decoration:underline}.ac-analytics-choice>div{display:flex;gap:8px}.ac-analytics-choice button{flex:1;min-height:40px;border:1px solid var(--ac-border);border-radius:10px;font:inherit;font-weight:700;background:var(--ac-surface-2);color:inherit}.ac-analytics-choice button:focus-visible{outline:2px solid currentColor;outline-offset:2px}@media(min-width:768px){.ac-analytics-choice{bottom:16px;left:16px;right:auto}}`}</style></aside>;
}
