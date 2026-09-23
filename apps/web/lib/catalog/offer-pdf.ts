import {offerPath} from "./offer-url";
import PDFDocument from "pdfkit";
import { TOPAVTO_DEALER } from "../topavto-dealer";
import { offerPdfLayers } from "./offer-pdf-layers";
import sharp from "sharp";
import { rankedCatalogImageUrls } from "./image-quality";
import { fetchOfferPdfPhoto } from "./offer-pdf-photo";
import { catalogOfferTitle } from "./presentation";
import path from "node:path";
import { existsSync } from "node:fs";
import type { VehicleOffer } from "./types";
import type { SavedCalculationResult } from "./saved-offer-calculation";

export type PdfLine = {label:string; value:string};
export type OfferPdfData = {title:string; market:string; marketKey?:string; date:string; specs:string; city:string; rate:string; rateDate?:string; rateDirection?:"up"|"down"|"flat"; rateChange?:string; valuationDate?:string; photoUrl?:string; sections:{title:string;rows:PdfLine[]}[]; total:string; deposit:string; warnings:string[]; url:string};
const markets:Record<string,string>={japan:"Япония",china:"Китай",korea:"Корея",uae:"ОАЭ",europe:"Европа",georgia:"Грузия"};
const fuels:Record<string,string>={petrol:"Бензин",diesel:"Дизель",electric:"Электро",hybrid:"Гибрид",lpg:"Газ LPG",cng:"Газ CNG"};
const rub=(n:number|null|undefined)=>typeof n==="number" && Number.isFinite(n)?`${Math.round(n).toLocaleString("ru-RU")} ₽`:"Требует уточнения";
export function offerPdfData(offer:VehicleOffer,draft:Record<string,string>,calculation:SavedCalculationResult|null,warning?:string,calculatedAt?:string):OfferPdfData {
 const lines=calculation?.breakdown || [];
 const amount=(id:string)=>lines.find(line=>line.id===id)?.amountRub ?? (calculation ? 0 : undefined);
 const row=(id:string,label:string):PdfLine=>({label,value:rub(amount(id))});
 const source=offer.sourcePrice!=null && offer.sourceCurrency ? `${offer.sourcePrice.toLocaleString("ru-RU")} ${offer.sourceCurrency}`:"";
 const rate=calculation?.currencyRate || offer.calculationSnapshot?.currencyRate;
 const previous=Number(rate?.previousEffectiveRate || 0);
 const delta=Number(rate?.rateDelta) || (previous>0 && Number(rate?.effectiveRate)>0 ? Number(rate.effectiveRate)-previous : 0);
 const rateDirection=Math.abs(delta)<1e-9?"flat":delta<0?"down":"up";
 const valuation=new Date(calculatedAt || new Date().toISOString());
 const abroad=[row("car",`Цена автомобиля${source?` · ${source}`:""}`),row("logistics","Логистика до России")];
 if(!calculation)abroad[0].value=rub(offer.sellerPriceRub ?? offer.calculationSnapshot?.sourcePriceRub);
 const foreignSum=amount("car")!=null && amount("logistics")!=null ? Number(amount("car"))+Number(amount("logistics")):null;
 abroad.push({label:"Обеспечительный платёж (аванс)",value:rub(calculation?.paymentPlan?.securityDepositRub)});
 abroad.push({label:`Итого: ${markets[offer.market] || offer.market}`,value:rub(foreignSum)});
 const local=lines.filter(line=>!["car","logistics","topavto-commission"].includes(line.id)).map(line=>({label:line.title || line.label || line.id,value:rub(line.amountRub)}));
 if(!calculation)local.push({label:"Доставка / перегруз по РФ",value:rub(null)},{label:"Таможенные платежи и утилизационный сбор",value:rub(null)},{label:"Брокер, СВХ, лаборатория, СБКТС, ЭПТС",value:rub(null)});
 const commission=amount("topavto-commission");
 local.push({label:'Комиссия компании «TOP AVTO»',value:rub(commission)});
 local.push({label:"Итого: Россия",value:rub(calculation && foreignSum!=null?calculation.totalRub-foreignSum:null)});
 return {title:catalogOfferTitle(offer),marketKey:offer.market,market:markets[offer.market] || offer.market,date:new Date().toLocaleDateString("ru-RU",{timeZone:"UTC"}),
 specs:[draft.year?`${draft.year} г.`:"",draft.engineCc?`${draft.engineCc} см³`:"",fuels[draft.fuel] || "",draft.powerHp?`${draft.powerHp} л.с.`:"",draft.power30MinKw?`30 мин: ${draft.power30MinKw} кВт`:"",offer.mileageKm!=null?`${offer.mileageKm.toLocaleString("ru-RU")} км`:""].filter(Boolean).join("  /  "),
 city:draft.deliveryCity || "Город доставки не выбран",rate:rate?.currency && Number(rate?.effectiveRate)>0?`1 ${rate.currency} = ${Number(rate.effectiveRate).toLocaleString("ru-RU",{maximumFractionDigits:4})} ₽`:"Курс требует уточнения",
 valuationDate:Number.isFinite(valuation.getTime())?valuation.toLocaleDateString("ru-RU",{timeZone:"UTC"}):undefined,
 photoUrl:rankedCatalogImageUrls({...offer,images:(offer.images || []).filter(image=>image.role!=="auction_sheet")})[0],
 rateDirection,rateDate:rate?.rateDate,rateChange:rateDirection!=="flat" && previous>0?`${delta>0?"+":""}${(delta/previous*100).toFixed(2).replace(".",",")}%`:undefined,
 sections:[{title:`01 / ${markets[offer.market] || offer.market}`,rows:abroad},{title:"02 / Россия",rows:local},{title:"03 / Сопровождение и доставка",rows:[]}],
 total:rub(calculation?.totalRub),deposit:rub(calculation?.paymentPlan?.securityDepositRub),warnings:[...(warning?[warning]:[]),...(calculation?.warnings || [])],url:`https://avtocena.com${offerPath(offer)}`};
}
export function offerPdfNotes(data:OfferPdfData) {
 const deposit=data.marketKey==="japan"
  ? "Обеспечительный платёж в разделе страны — аванс в счёт автомобиля. Он засчитывается при оплате и не прибавляется к стоимости повторно."
  : "Обеспечительный платёж в разделе страны — аванс в счёт услуг по договору. Он засчитывается при оплате и не прибавляется к стоимости повторно.";
 const warnings=data.warnings.map(w=>w.startsWith("Льготный утильсбор рассчитан как")
  ? "Возможность применения льготного утилизационного сбора подтверждается по документам автомобиля и покупателя до оплаты."
  : w);
 return [deposit,"Комиссия TOP AVTO включена в раздел «Россия» и итоговую стоимость. Порядок и сроки оплаты отдельных этапов определяются договором.",...warnings,
 "Подбор автомобиля, проверка доступных сведений, сопровождение покупки и организация доставки выполняются в согласованном по договору объёме. Комплектация и технические характеристики подтверждаются документами и осмотром.",
 "Суммы в рублях рассчитаны по указанному курсу на дату расчёта. До покупки стоимость, тарифы доставки и обязательные платежи подлежат уточнению. Расчёт носит информационный характер и не является публичной офертой."];
}
export async function renderOfferPdf(data:OfferPdfData,assets?:{photo?:Buffer|null}):Promise<Buffer> {
 const publicDir=existsSync(path.join(process.cwd(),"public/fonts/DejaVuSans.ttf"))?path.join(process.cwd(),"public"):path.join(process.cwd(),"apps/web/public");
 const marketKey=Object.hasOwn(markets,data.marketKey || "")?data.marketKey!:Object.keys(markets).find(k=>markets[k]===data.market)||"korea";
 const flag=(key:string)=>sharp(path.join(publicDir,`pdf-flags/${key}.svg`)).resize(84,60,{fit:"fill"}).png().toBuffer();
 const [photo,mark,marketFlag,russiaFlag]=await Promise.all([assets?.photo!==undefined?assets.photo:fetchOfferPdfPhoto(data.photoUrl),sharp(path.join(publicDir,"logo/avtocena-mark-light.svg")).resize(96,96).png().toBuffer(),flag(marketKey),flag("russia")]);
 const doc=new PDFDocument({size:"A4",pdfVersion:"1.5",margin:32,font:path.join(publicDir,"fonts/DejaVuSans.ttf"),bufferPages:true,info:{Title:`Расчёт · ${data.title}`,Author:"TOP AVTO / АвтоЦена"}});
 doc.registerFont("regular",path.join(publicDir,"fonts/DejaVuSans.ttf"));doc.registerFont("bold",path.join(publicDir,"fonts/DejaVuSans-Bold.ttf"));
 const chunks:Buffer[]=[];const output=new Promise<Buffer>((resolve,reject)=>{doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
 const X=32,W=346,R=396,RW=167,ink="#1B222C",muted="#68758A",border="#DCE2E9";
 const height=(s:string,w:number,size:number,bold=false)=>doc.font(bold?"bold":"regular").fontSize(size).heightOfString(s,{width:w,lineGap:1});
 const notes=offerPdfNotes(data);
 const supportGap=16;
 const layouts=[8.6,8.2,7.8,7.4].map(font=>{
  const titleFont=font+10,titleH=height(data.title,W,titleFont,true),specH=height(data.specs,W,font-1),routeH=height(`${data.market} → ${data.city}`,W,font+6,true);
  const start=38+titleH+10+specH+15+routeH+16;
  const rows=data.sections.slice(0,2).map(s=>s.rows.map(r=>Math.max(font+10,height(r.label,223,font)+8,height(r.value,100,font,true)+8)));
  const noteFont=Math.max(6.5,font-1),noteHeights=notes.map(n=>height(n,W,noteFont)+5);
  return {font,titleFont,titleH,specH,routeH,start,rows,noteFont,noteHeights,total:start+rows.reduce((t,rs)=>t+28+rs.reduce((a,b)=>a+b,0),0)+28+supportGap+noteHeights.reduce((a,b)=>a+b,0)};
 });
 const fit=layouts.find(l=>l.total<=776)||layouts.at(-1)!;
 const text=(s:string,x:number,y:number,w:number,size=fit.font,bold=false,color=ink)=>doc.font(bold?"bold":"regular").fontSize(size).fillColor(color).text(s,x,y,{width:w,lineGap:1});
 const layers=offerPdfLayers(doc,data.sections.map(s=>s.title));
 const heading=(index:number,y:number)=>{doc.roundedRect(X,y,W,19,5).fill("#EEF1F5");if(index<2)doc.image(index===0?marketFlag:russiaFlag,X+8,y+4,{width:17,height:12});text(data.sections[index].title.toUpperCase(),X+(index<2?32:9),y+6,W-45,7,true);layers.toggle(index,X,y,W,19);};
 const brand=(y:number)=>{doc.image(mark,R,y,{width:27,height:27});doc.font("bold").fontSize(16);const aw=doc.widthOfString("Авто");text("Авто",R+34,y+4,aw+1,16,true,"#ef4444");text("Цена",R+34+aw,y+4,80,16,true);};
 // The right-hand column follows the owner's reference: photo, quote, dealer, contacts.
 doc.roundedRect(R,38,RW,111,7).fill("#F3F5F8");if(photo){doc.save().roundedRect(R,38,RW,111,7).clip();doc.image(photo,R,38,{fit:[RW,111],align:"center",valign:"center"});doc.restore();}else text("Фото доступно в карточке автомобиля",R+12,79,RW-24,8,false,muted);
 doc.roundedRect(R,160,RW,25,7).fill("#F59E0B");doc.font("bold").fontSize(8).fillColor(ink).text("АвтоЦена рассчитана ↗",R,168,{width:RW,align:"center",link:data.url});doc.link(R,160,RW,25,data.url);
 text(`Актуально на ${data.valuationDate || data.date} г.`,R+5,201,RW-10,7.5);
 text("РАСЧЁТ СТОИМОСТИ АВТОМОБИЛЯ",R,244,RW,6.3,false,muted);brand(268);
 text("ИТОГО ПОД КЛЮЧ",R,328,RW,8,true,muted);text(data.total,R,346,RW,data.total.includes("уточнения")?12:20,true);
 doc.moveTo(R,379).lineTo(R+RW,379).lineWidth(.7).strokeColor(border).stroke();
 const rateColor=data.rateDirection==="down"?"#20a85e":data.rateDirection==="up"?"#ef3340":muted;
 const rateBg=data.rateDirection==="down"?"#cfe5d8":data.rateDirection==="up"?"#f2d1d5":"#EDF0F5";
 doc.roundedRect(R,389,RW,47,7).fill(rateBg);
 if(data.rateDirection && data.rateDirection!=="flat"){const down=data.rateDirection==="down";doc.save().translate(R+8,400).scale(.45).lineWidth(3).lineCap("round").lineJoin("round").strokeColor(rateColor);doc.path(down?"M3 5L11.5 13.5L18 9L34 25":"M3 25L11.5 16.5L18 21L34 5").stroke();doc.path(down?"M25 25H34V16":"M25 5H34V14").stroke();doc.restore();}
 text(`${data.rate}${data.rateChange?`  ${data.rateChange}`:""}`,R+30,398,RW-37,7.4,true,rateColor);if(data.rateDate)text(`Курс на ${data.rateDate}`,R+30,422,RW-37,6.3,false,muted);
 doc.moveTo(R,451).lineTo(R+RW,451).strokeColor(border).stroke();
 text("ВАШ ДИЛЕР ПО ПОДБОРУ АВТО",R,469,RW,6.5,false,muted);
 doc.image(path.join(publicDir,"brands/topavto-logo-black.png"),R,491,{fit:[RW,40],align:"center",valign:"center"});doc.link(R,491,RW,40,TOPAVTO_DEALER.website);
 text(`ИНН: ${TOPAVTO_DEALER.inn}\nОГРНИП: ${TOPAVTO_DEALER.ogrnip}`,R,543,RW,7.7);
 const contacts=[["Оформление документов","+7 923 623-47-77","nvkz_zenit"],["Япония","+7 903 071-33-03","IvanTOPAVTO"],["Другие страны","+7 923 479-19-88","Anton_Molodykh90"]];
 contacts.forEach(([label,phone,tg],i)=>{const y=586+i*57;text(label,R,y,RW,8,true);doc.font("regular").fontSize(8).fillColor(ink).text(phone,R,y+15,{width:RW,link:`tel:${phone.replace(/[^+0-9]/g,"")}`});doc.fontSize(7).fillColor("#008CCB").text("Telegram",R,y+29,{width:RW,link:`https://t.me/${tg}`});});
 doc.fontSize(7).fillColor(muted).text("topavto.online",R,758,{width:RW,link:TOPAVTO_DEALER.website});doc.text("@TopAvtoImport",R,772,{width:RW,link:"https://t.me/TopAvtoImport"});
 // Independent left column; unusually long warnings continue on another page.
 text(data.title,X,38,W,fit.titleFont,true);let y=38+fit.titleH+10;text(data.specs,X,y,W,fit.font-1,false,muted);y+=fit.specH+15;text(`${data.market} → ${data.city}`,X,y,W,fit.font+6,true);y=fit.start;
 const room=(h:number)=>{if(y+h>783){doc.addPage();y=38;}};
 data.sections.slice(0,2).forEach((section,si)=>{room(24+(fit.rows[si][0]||0));heading(si,y);y+=23;section.rows.forEach((row,ri)=>{const h=fit.rows[si][ri];room(h);layers.begin(si);const subtotal=row.label.startsWith("Итого:");if(subtotal)doc.roundedRect(X,y,W,h-1,4).fill("#F5F7F9");text(row.label,X+8,y+4,223,fit.font,subtotal);doc.font("bold").fontSize(fit.font).fillColor(ink).text(row.value,X+W-108,y+4,{width:100,align:"right",lineGap:1});doc.moveTo(X+8,y+h-1).lineTo(X+W-8,y+h-1).lineWidth(.4).strokeColor(border).stroke();layers.end();y+=h;});y+=5;});
 y+=supportGap;room(25+fit.noteHeights[0]);heading(2,y);y+=25;notes.forEach((note,i)=>{room(fit.noteHeights[i]);layers.begin(2);text(note,X,y,W,fit.noteFont,false,muted);layers.end();y+=fit.noteHeights[i];});
 const count=doc.bufferedPageRange().count;for(let i=0;i<count;i++){doc.switchToPage(i);text("АВТОЦЕНА / Индивидуальный расчёт",X,798,390,6,false,muted);doc.font("regular").fontSize(6).text(`${i+1} / ${count}`,523,798,{width:40,align:"right"});}
 doc.end();return output;
}
