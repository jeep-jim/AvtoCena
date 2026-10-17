'use client';
import {usePathname} from 'next/navigation';
import {siteRoute} from '@/lib/site-controls';
export function SitePageAccess({children}:{children:React.ReactNode}){
 const section=siteRoute(usePathname());
 if(!section)return <>{children}</>;
 return <div data-site-page={section}><div data-site-content>{children}</div><div data-site-disabled style={{display:'none'}} className="mx-auto max-w-xl px-5 py-20"><h1 className="text-2xl font-black">Раздел временно недоступен</h1><p className="my-4">Попробуйте другой раздел сайта.</p><a href="/" className="underline">На главную</a></div></div>;
}
