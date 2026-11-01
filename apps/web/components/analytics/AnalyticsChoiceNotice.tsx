"use client";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {ANALYTICS_EVENT,analyticsChoice,setAnalyticsChoice} from '@/lib/privacy-consent';
import {PUBLIC_HEADER_LAYOUT_EVENT} from '@/components/layout/public-header-layout';
import {isPublicPagePath} from '@/lib/public-page-url';
export function AnalyticsChoiceNotice(){
 const pathname=usePathname(),[visible,setVisible]=useState(false),[settings,setSettings]=useState(false),[allowAnalytics,setAllowAnalytics]=useState(true);
 useEffect(()=>{const sync=()=>setVisible(analyticsChoice()===null);sync();window.addEventListener(ANALYTICS_EVENT,sync);window.addEventListener('storage',sync);return()=>{window.removeEventListener(ANALYTICS_EVENT,sync);window.removeEventListener('storage',sync);};},[pathname]);
 const notice=useRef<HTMLDivElement>(null);
 const shown=visible&&isPublicPagePath(pathname)&&!pathname.startsWith('/privacy/request');
 // On phones reserve the exact height before paint, including expanded settings.
 // The same offset moves the header and its dependent sticky controls together.
 useLayoutEffect(()=>{
  const node=notice.current;if(!shown||!node)return;
  const root=document.documentElement;
  const measure=()=>{
   const height=window.matchMedia('(max-width:767px)').matches?`${Math.ceil(node.getBoundingClientRect().height)}px`:'0px';
   if(root.style.getPropertyValue('--ac-analytics-height')===height)return;
   root.style.setProperty('--ac-analytics-height',height);
   window.dispatchEvent(new Event(PUBLIC_HEADER_LAYOUT_EVENT));
  };
  measure();
  const observer=new ResizeObserver(measure);observer.observe(node);
  window.addEventListener('resize',measure);
  window.visualViewport?.addEventListener('resize',measure);
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);root.style.removeProperty('--ac-analytics-height');window.dispatchEvent(new Event(PUBLIC_HEADER_LAYOUT_EVENT));};
 },[shown]);
 if(!shown)return null;
 return <><div className="ac-analytics-space" aria-hidden="true"/>{createPortal(<div ref={notice} data-nosnippet="" role="complementary" className="ac-analytics-choice" aria-label="Выбор аналитики">
 <div className="ac-analytics-choice-row"><span className="ac-analytics-icon" aria-hidden="true">🛸</span><p>С вашего согласия используем <button className="ac-analytics-settings" type="button" aria-expanded={settings} aria-controls="ac-analytics-options" onClick={()=>setSettings(!settings)}>Настройки</button>{' '}<Link href="/cookies" target="_blank">cookie</Link>{' '}Яндекс Метрики, чтобы делать сайт удобнее.</p><button className="ac-analytics-accept" type="button" onClick={()=>setAnalyticsChoice(true)}>Хорошо</button></div>
 {settings&&<div id="ac-analytics-options"><p>Аналитика помогает оценить посещения и результаты заявок.</p><div className="ac-analytics-options-row"><button type="button" className="ac-analytics-decline" onClick={()=>setAnalyticsChoice(allowAnalytics)}>{allowAnalytics ? 'Продолжить с аналитикой' : 'Продолжить без аналитики'}</button><div className="ac-analytics-toggle"><span aria-hidden="true">Да</span><button type="button" role="switch" aria-label="Разрешить аналитику Яндекс Метрики" aria-checked={allowAnalytics} className="ac-analytics-switch" onClick={()=>setAllowAnalytics(value=>!value)}><span /></button><span aria-hidden="true">Нет</span></div></div></div>}
 <style>{`.ac-analytics-space{height:var(--ac-analytics-height,0px);flex:none;overflow-anchor:none}html body .ac-public-header{top:var(--ac-analytics-height,0px)!important}.ac-analytics-choice{position:fixed;z-index:5001;left:0;right:0;top:0;box-sizing:border-box;max-height:calc(100dvh - 80px - env(safe-area-inset-bottom));overflow-y:auto;overscroll-behavior:contain;padding:calc(10px + env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) 10px max(12px,env(safe-area-inset-left));border-bottom:1px solid var(--ac-border);background:var(--ac-surface,#fff);color:var(--ac-text,#202633);font-size:12px;line-height:1.4}.ac-analytics-choice-row,#ac-analytics-options{max-width:1120px;margin-left:auto;margin-right:auto}.ac-analytics-choice-row{display:flex;align-items:center;gap:12px}.ac-analytics-icon{flex-shrink:0;font-size:24px;line-height:1}.ac-analytics-choice p{margin:0;flex:1;min-width:0}.ac-analytics-choice a{text-decoration:underline}.ac-analytics-choice button{font:inherit;cursor:pointer}.ac-analytics-accept{flex-shrink:0;min-height:40px;padding:8px 16px;border:0;border-radius:12px;background:#83e05b;color:#142410;font-weight:700!important}.ac-analytics-settings{display:inline;padding:0;border:0;background:transparent;color:inherit;text-decoration:underline}.ac-analytics-choice button:focus-visible{outline:2px solid currentColor;outline-offset:2px}#ac-analytics-options{margin-top:10px;padding-top:8px;border-top:1px solid var(--ac-border)}.ac-analytics-options-row{display:flex;align-items:center;flex-wrap:wrap;gap:12px 24px;margin-top:8px}.ac-analytics-toggle{display:flex;align-items:center;gap:10px;font-weight:600}.ac-analytics-switch{display:inline-flex;align-items:center;width:54px;min-width:54px;height:32px;padding:4px;border:1px solid var(--ac-border);border-radius:999px;background:var(--ac-surface-2,#ccd5df);color:inherit}.ac-analytics-switch[aria-checked=true]{background:#83e05b;border-color:#6cbe48}.ac-analytics-switch span{display:block;width:24px;height:24px;flex-shrink:0;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0004;transform:translateX(20px)}.ac-analytics-switch[aria-checked=true] span{transform:translateX(0)}.ac-analytics-decline{margin-top:0;min-height:40px;padding:8px 12px;border:1px solid var(--ac-border);border-radius:10px;background:var(--ac-surface-2);color:inherit}@media(min-width:768px){.ac-analytics-choice{z-index:65;left:12px;right:auto;top:auto;bottom:12px;width:560px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);border:1px solid var(--ac-border);border-radius:16px;padding:12px}}`}</style>
 </div>,document.body)}</>;
}
