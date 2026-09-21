import PDFDocument from "pdfkit";
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
 abroad.push({label:`Итого: ${markets[offer.market] || offer.market}`,value:rub(foreignSum)});
 const local=lines.filter(line=>!["car","logistics","topavto-commission"].includes(line.id)).map(line=>({label:line.title || line.label || line.id,value:rub(line.amountRub)}));
 if(!calculation)local.push({label:"Доставка / перегруз по РФ",value:rub(null)},{label:"Таможенные платежи и утилизационный сбор",value:rub(null)},{label:"Брокер, СВХ, лаборатория, СБКТС, ЭПТС",value:rub(null)});
 const commission=amount("topavto-commission");
 local.push({label:"Стоимость авто до комиссии",value:rub(calculation && commission!=null?calculation.totalRub-commission:null)});
 return {title:catalogOfferTitle(offer),marketKey:offer.market,market:markets[offer.market] || offer.market,date:new Date().toLocaleDateString("ru-RU",{timeZone:"UTC"}),
 specs:[draft.year?`${draft.year} г.`:"",draft.engineCc?`${draft.engineCc} см³`:"",fuels[draft.fuel] || "",draft.powerHp?`${draft.powerHp} л.с.`:"",draft.power30MinKw?`30 мин: ${draft.power30MinKw} кВт`:"",offer.mileageKm!=null?`${offer.mileageKm.toLocaleString("ru-RU")} км`:""].filter(Boolean).join("  /  "),
 city:draft.deliveryCity || "Город доставки не выбран",rate:rate?.currency && Number(rate?.effectiveRate)>0?`1 ${rate.currency} = ${Number(rate.effectiveRate).toLocaleString("ru-RU",{maximumFractionDigits:4})} ₽`:"Курс требует уточнения",
 valuationDate:Number.isFinite(valuation.getTime())?valuation.toLocaleDateString("ru-RU",{timeZone:"UTC"}):undefined,
 photoUrl:rankedCatalogImageUrls({...offer,images:(offer.images || []).filter(image=>image.role!=="auction_sheet")})[0],
 rateDirection,rateDate:rate?.rateDate,rateChange:rateDirection!=="flat" && previous>0?`${delta>0?"+":""}${(delta/previous*100).toFixed(2).replace(".",",")}%`:undefined,
 sections:[{title:`01 / ${markets[offer.market] || offer.market}`,rows:abroad},{title:"02 / Россия",rows:local},{title:"03 / Сопровождение",rows:[{label:'Комиссия компании «TOP AVTO»',value:rub(commission)}]}],
 total:rub(calculation?.totalRub),deposit:rub(calculation?.paymentPlan?.securityDepositRub),warnings:[...(warning?[warning]:[]),...(calculation?.warnings || [])],url:`https://avtocena.com/cars/offer/${encodeURIComponent(offer.id)}`};
}
export async function renderOfferPdf(data:OfferPdfData, assets?:{photo?:Buffer|null}):Promise<Buffer> {
 const publicDir=existsSync(path.join(process.cwd(),"public/fonts/DejaVuSans.ttf"))?path.join(process.cwd(),"public"):path.join(process.cwd(),"apps/web/public");
 const marketKey=data.marketKey || Object.keys(markets).find(key=>markets[key]===data.market) || "korea";
 const flag=async(key:string)=>sharp(path.join(publicDir,`pdf-flags/${key}.svg`)).resize(84,60,{fit:"fill"}).png().toBuffer();
 const [photo,mark,marketFlag,russiaFlag]=await Promise.all([assets?.photo!==undefined?assets.photo:fetchOfferPdfPhoto(data.photoUrl),sharp(path.join(publicDir,"logo/avtocena-mark-light.svg")).resize(96,96).png().toBuffer(),flag(marketKey),flag("russia")]);
 const doc=new PDFDocument({size:"A4",pdfVersion:"1.5",margin:32,font:path.join(publicDir,"fonts/DejaVuSans.ttf"),bufferPages:true,info:{Title:`Расчёт · ${data.title}`,Author:"TOP AVTO / АвтоЦена"}});
 doc.registerFont("regular",path.join(publicDir,"fonts/DejaVuSans.ttf"));doc.registerFont("bold",path.join(publicDir,"fonts/DejaVuSans-Bold.ttf"));
 const chunks:Buffer[]=[];const output=new Promise<Buffer>((resolve,reject)=>{doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
 const layers=offerPdfLayers(doc,data.sections.map(s=>s.title));
 const X=32,W=531,ink="#1B222C",muted="#68758A",orange="#F59E0B";
 const notes=["Обеспечительный платёж указан отдельно как этап оплаты; повторно к итогу не прибавляется.",...data.warnings,"Суммы в иностранной валюте пересчитаны по курсам на момент расчёта. Информация носит справочный характер и не является офертой."];
 const height=(s:string,width:number,size:number,bold=false)=>doc.font(bold?"bold":"regular").fontSize(size).heightOfString(s,{width,lineGap:1});
 const spec=data.specs || "Характеристики требуют уточнения";
 const route=`${data.market} → ${data.city}`;
 const layout=(font:number)=>{
  const noteFont=Math.max(6.3,font-.9),titleFont=font+10;
  const titleH=height(data.title,314,titleFont,true),specH=height(spec,314,font-1);
  const hero=Math.max(128,titleH+specH+59);
  const routeH=Math.max(22,height(route,270,font,true)+6);
  const rows=data.sections.map(s=>s.rows.map(r=>Math.max(font+8,height(r.label,332,font)+7,height(r.value,164,font,true)+7)));
  const noteHeights=notes.map(n=>height(n,W,noteFont)+3);
  const total=hero+routeH+rows.reduce((sum,rs)=>sum+24+rs.reduce((a,b)=>a+b,0),0)+79+noteHeights.reduce((a,b)=>a+b,0)+64+47;
  return {font,noteFont,titleFont,titleH,specH,hero,routeH,rows,noteHeights,total};
 };
 // Fit by measured content, preserving every expense and warning. Exceptionally
 // long reports paginate at the readable minimum instead of truncating content.
 const variants=[8.6,8.2,7.8,7.4].map(layout);
 const fit=variants.find(v=>v.total<=756) || variants.at(-1)!;
 const text=(s:string,x:number,y:number,w:number,size=fit.font,bold=false,color=ink)=>doc.font(bold?"bold":"regular").fontSize(size).fillColor(color).text(s,x,y,{width:w,lineGap:1});
 let y=32;
 const room=(h:number)=>{if(y+h>792){doc.addPage();y=32;}};

 text("АВТОЦЕНА / TOP AVTO",X+14,y+13,310,8,true,"#ef3340");
 text("РАСЧЁТ СТОИМОСТИ АВТОМОБИЛЯ",X+14,y+29,310,6.4,false,muted);
 text(data.title,X+14,y+44,314,fit.titleFont,true,ink);
 text(spec,X+14,y+fit.titleH+51,314,fit.font-1,false,muted);
 const px=385,py=y+12,pw=164,ph=83;
 doc.roundedRect(px,py,pw,ph,8).fill("#F3F5F8");
 if(photo){doc.save().roundedRect(px,py,pw,ph,8).clip();doc.image(photo,px,py,{fit:[pw,ph],align:"center",valign:"center"});doc.restore();}
 else text("Фото доступно\nв карточке автомобиля",px+12,py+29,pw-24,8,false,muted);
 doc.roundedRect(px,py+91,pw,25,7).fill(orange);
 doc.font("bold").fontSize(8).fillColor(ink).text("АвтоЦена рассчитана ↗",px,py+99,{width:pw,align:"center",link:data.url});doc.link(px,py+91,pw,25,data.url);
 y+=fit.hero+8;
 text(route,X,y,270,fit.font,true);
 y+=fit.routeH-8;
 data.sections.forEach((section,si)=>{
  room(22+fit.rows[si][0]);doc.roundedRect(X,y,W,18,5).fill("#EEF1F5");
  if(si<2){doc.image(si===0?marketFlag:russiaFlag,X+8,y+3,{width:17,height:12});doc.roundedRect(X+8,y+3,17,12,2).lineWidth(.3).strokeColor("#CBD2DD").stroke();}
  text(section.title.toUpperCase(),X+(si<2?32:9),y+5,350,7,true);
  text("Показать / скрыть",X+W-91,y+5,80,6.1,false,muted);layers.toggle(si,X,y,W,18);y+=21;
  section.rows.forEach((row,ri)=>{const h=fit.rows[si][ri];room(h);layers.begin(si);const subtotal=/^(Итого|Стоимость авто до)/.test(row.label);
   if(subtotal)doc.roundedRect(X,y,W,h-1,4).fill("#F5F7F9");
   text(row.label,X+8,y+3,332,fit.font,subtotal);doc.font("bold").fontSize(fit.font).fillColor(ink).text(row.value,389,y+3,{width:166,align:"right",lineGap:1});
   doc.moveTo(X+8,y+h-1).lineTo(X+W-8,y+h-1).lineWidth(.4).strokeColor("#E4E9EF").stroke();layers.end();y+=h;
  });y+=3;
 });
 room(79);
 const rateColor=data.rateDirection==="down"?"#20a85e":data.rateDirection==="up"?"#ef3340":muted;
 const rateBg=data.rateDirection==="down"?"#cfe5d8":data.rateDirection==="up"?"#f2d1d5":"#E5EAF1";
 doc.roundedRect(X,y,W,60,10).fill("#EDF0F5");
 text("ИТОГО ПОД КЛЮЧ",X+12,y+12,168,7,true,muted);
 text(`Актуально на ${data.valuationDate || data.date} г.`,X+12,y+30,168,7.5,false,ink);
 const rx=242,arrowX=218;
 doc.roundedRect(210,y+7,169,46,7).fill(rateBg);
 if(data.rateDirection && data.rateDirection!=="flat"){
  const down=data.rateDirection==="down";doc.save().translate(arrowX,y+13).scale(.45).lineWidth(3).lineCap("round").lineJoin("round").strokeColor(rateColor);
  doc.path(down?"M3 5L11.5 13.5L18 9L34 25":"M3 25L11.5 16.5L18 21L34 5").stroke();doc.path(down?"M25 25H34V16":"M25 5H34V14").stroke();doc.restore();
 }
 text(`${data.rate}${data.rateChange?`  ${data.rateChange}`:""}`,rx,y+14,130,7.5,true,rateColor);
 if(data.rateDate)text(`Курс на ${data.rateDate}`,rx,y+35,130,6.3,false,muted);
 doc.font("bold").fontSize(data.total.includes("уточнения") || data.total.length>24?10:17).fillColor(ink).text(data.total,389,y+22,{width:161,align:"right"});y+=66;
 text(`Обеспечительный платёж: ${data.deposit}`,X,y,W,fit.font,true);y+=13;
 notes.forEach((note,i)=>{room(fit.noteHeights[i]);text(note,X,y,W,fit.noteFont,false,muted);y+=fit.noteHeights[i];});
 room(111);y+=5;doc.moveTo(X,y).lineTo(X+W,y).strokeColor("#DCE2E9").stroke();y+=9;
 const contacts=[["Япония","+7 903 071-33-03","IvanTOPAVTO"],["Другие страны","+7 923 479-19-88","Anton_Molodykh90"],["Оформление документов","+7 923 623-47-77","nvkz_zenit"]];
 contacts.forEach(([label,phone,tg],i)=>{const x=X+i*180;text(label,x,y,174,7.3,true);doc.font("regular").fontSize(8).fillColor(ink).text(phone,x,y+13,{width:174,link:`tel:${phone.replace(/[^+0-9]/g,"")}`});doc.fontSize(7).fillColor("#008CCB").text("Telegram",x,y+26,{width:174,link:`https://t.me/${tg}`});});y+=40;
 doc.font("regular").fontSize(7).fillColor(muted).text("topavto.online",X,y,{width:170,link:"https://topavto.online/"});doc.text("@TopAvtoImport",X+180,y,{width:174,link:"https://t.me/TopAvtoImport"});doc.text("Карточка автомобиля ↗",X+360,y,{width:174,link:data.url});y+=16;
 // Original calculator + the red/black wordmark and original red/black TOP AVTO asset.
 const logoY=Math.max(y,746);doc.image(mark,X+13,logoY+6,{width:27,height:27});
 doc.font("bold").fontSize(14);const autoWidth=doc.widthOfString("Авто");text("Авто",X+48,logoY+11,autoWidth+1,14,true,"#ef4444");text("Цена",X+48+autoWidth,logoY+11,90,14,true,ink);doc.link(X+8,logoY+3,180,33,"https://avtocena.com/");
 doc.image(path.join(publicDir,"brands/topavto-logo-black.png"),X+W-157,logoY+4,{fit:[143,31],align:"center",valign:"center"});doc.link(X+W-164,logoY+3,156,33,"https://topavto.online/");
 const count=doc.bufferedPageRange().count;
 for(let i=0;i<count;i++){doc.switchToPage(i);text("АВТОЦЕНА / Индивидуальный расчёт",X,794,390,6,false,muted);doc.font("regular").fontSize(6).text(`${i+1} / ${count}`,X+W-40,794,{width:40,align:"right"});}
 doc.end();return output;
}
