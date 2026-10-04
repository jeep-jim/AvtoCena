"use client";
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {ANALYTICS_EVENT,analyticsChoice,setAnalyticsChoice} from '@/lib/privacy-consent';
import {isPublicPagePath} from '@/lib/public-page-url';
export function AnalyticsChoiceNotice(){
 const pathname=usePathname(),[visible,setVisible]=useState(false),[settings,setSettings]=useState(false);
 useEffect(()=>{const sync=()=>setVisible(analyticsChoice()===null);sync();window.addEventListener(ANALYTICS_EVENT,sync);window.addEventListener('storage',sync);return()=>{window.removeEventListener(ANALYTICS_EVENT,sync);window.removeEventListener('storage',sync);};},[pathname]);
 if(!visible||!isPublicPagePath(pathname)||pathname.startsWith('/privacy/request'))return null;
 return createPortal(<div data-nosnippet="" role="complementary" className="ac-analytics-choice" aria-label="Выбор аналитики">
 <div className="ac-analytics-choice-row"><p>Нажимая «Понятно», вы соглашаетесь на cookie Яндекс Метрики для оценки рекламы. <Link href="/cookies" target="_blank">Подробнее</Link></p><button className="ac-analytics-accept" type="button" onClick={()=>setAnalyticsChoice(true)}>Понятно</button></div>
 <button className="ac-analytics-settings" type="button" aria-expanded={settings} aria-controls="ac-analytics-options" onClick={()=>setSettings(!settings)}>Настроить</button>
 {settings&&<div id="ac-analytics-options"><p>Аналитика помогает оценить посещения и результаты заявок. Сайт работает и без неё.</p><button type="button" className="ac-analytics-decline" onClick={()=>setAnalyticsChoice(false)}>Продолжить без аналитики</button></div>}
 <style>{`.ac-analytics-choice{position:fixed;z-index:65;left:0;right:0;bottom:0;padding:10px 12px calc(8px + env(safe-area-inset-bottom));border-top:1px solid var(--ac-border);background:var(--ac-surface,#fff);color:var(--ac-text,#202633);box-shadow:0 -2px 14px #0001;font-size:12px;line-height:1.4}.ac-analytics-choice-row{display:flex;align-items:center;gap:12px}.ac-analytics-choice p{margin:0;flex:1;min-width:0}.ac-analytics-choice a{text-decoration:underline}.ac-analytics-choice button{font:inherit;cursor:pointer}.ac-analytics-accept{flex-shrink:0;min-height:40px;padding:8px 16px;border:0;border-radius:12px;background:#83e05b;color:#142410;font-weight:700!important}.ac-analytics-settings{display:block;padding:6px 0 2px;border:0;background:transparent;color:inherit;text-decoration:underline;min-height:28px}.ac-analytics-choice button:focus-visible{outline:2px solid currentColor;outline-offset:2px}#ac-analytics-options{padding-top:8px;border-top:1px solid var(--ac-border)}.ac-analytics-decline{margin-top:8px;min-height:40px;padding:8px 12px;border:1px solid var(--ac-border);border-radius:10px;background:var(--ac-surface-2);color:inherit}@media(min-width:768px){.ac-analytics-choice{left:12px;right:auto;bottom:12px;width:440px;max-width:calc(100vw - 24px);border:1px solid var(--ac-border);border-radius:16px;padding:12px}}`}</style>
 </div>,document.body);
}
