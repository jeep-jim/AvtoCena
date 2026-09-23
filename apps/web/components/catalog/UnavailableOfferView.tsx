import Link from "next/link";
import type { ReactNode } from "react";
import { PublicHeader } from "@/components/layout/PublicHeader";
import type { UnavailableOffer } from "@/lib/catalog/offer-availability";

export function UnavailableOfferView({offer,calculationUnavailable=false,children}:{offer?:UnavailableOffer|null;calculationUnavailable?:boolean;children?:ReactNode}) {
 const title=calculationUnavailable?"Расчёт временно недоступен":offer?.reason==="sold"?"Этот автомобиль продан":"Этот автомобиль больше недоступен";
 return <div className="ac-unavailable-page"><PublicHeader/><main className="ac-unavailable-main"><section className="ac-unavailable-hero" aria-labelledby="unavailable-offer-title"><img className="ac-unavailable-key" src="/key-logo.png" alt="" width="300" height="260"/>{offer?.make?<p className="ac-unavailable-model">{[offer.make,offer.model].filter(Boolean).join(" ")}</p>:null}<h1 id="unavailable-offer-title">{title}</h1><p className="ac-unavailable-description">{calculationUnavailable?"Для точного расчёта нужны дополнительные данные. Вы можете посмотреть другие предложения.":"Ваш автомобиль ещё впереди. Посмотрите другие предложения в нашем каталоге."}</p><Link href={offer?.make?`/cars?${new URLSearchParams({make:offer.make})}`:"/cars"} className="ac-unavailable-cta">Выбрать автомобиль <span aria-hidden="true">→</span></Link></section>{children}</main><style>{`
 .ac-unavailable-page{min-height:100vh;background:#08090b!important;color:#fff!important;--ac-text:#fff;--ac-muted:#a5abb5;--ac-surface:#171a20;--ac-surface-2:#242932;--ac-border:#343943}
 html body:has(.ac-unavailable-page){background:#08090b!important}
 .ac-unavailable-main{width:min(100%,1500px);margin:auto;padding:96px 32px 64px}
 .ac-unavailable-hero{display:flex;flex-direction:column;align-items:center;text-align:center;padding:12px 0 64px}
 .ac-unavailable-key{width:clamp(170px,22vw,280px);height:220px;object-fit:contain;margin-bottom:20px;filter:drop-shadow(0 18px 32px #000)}
 .ac-unavailable-model{color:#a5abb5!important;font-size:14px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;margin-bottom:16px}
 .ac-unavailable-page .ac-unavailable-hero h1{color:#fff!important;font-size:clamp(40px,6.5vw,88px)!important;line-height:1.02!important;letter-spacing:-.045em;font-weight:900;max-width:1050px;text-wrap:balance;margin:0}
 .ac-unavailable-description{max-width:550px;font-size:18px;line-height:1.6;color:#a5abb5!important;margin:24px 0 28px}
 .ac-unavailable-page .ac-unavailable-cta{display:inline-flex;align-items:center;gap:24px;min-height:56px;border-radius:16px;background:#ff353d!important;color:#fff!important;padding:16px 24px;font-size:16px;font-weight:900}
 .ac-unavailable-alternatives{border-top:1px solid #292d35;padding-top:32px}
 .ac-unavailable-section-heading h2{color:#fff!important;font-size:clamp(26px,3vw,38px);font-weight:900;line-height:1.15;margin-bottom:24px}
 .ac-unavailable-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
 .ac-unavailable-loading{text-align:center;color:#a5abb5;padding:32px}
 @media(max-width:1023px){.ac-unavailable-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
 @media(max-width:600px){.ac-unavailable-main{padding:80px 16px 40px}.ac-unavailable-hero{padding-bottom:40px}.ac-unavailable-key{height:175px;margin-bottom:16px}.ac-unavailable-description{font-size:16px;margin-top:20px}.ac-unavailable-grid{grid-template-columns:minmax(0,1fr);gap:20px}}
 `}</style></div>;
}
