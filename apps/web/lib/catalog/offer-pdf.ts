import PDFDocument from "pdfkit";
import { catalogOfferTitle } from "./presentation";
import path from "node:path";
import { existsSync } from "node:fs";
import type { VehicleOffer } from "./types";
import type { SavedCalculationResult } from "./saved-offer-calculation";

export type PdfLine = {label:string; value:string};
export type OfferPdfData = {title:string; market:string; date:string; specs:string; city:string; rate:string; sections:{title:string;rows:PdfLine[]}[]; total:string; deposit:string; warnings:string[]; url:string};
const markets:Record<string,string>={japan:"Япония",china:"Китай",korea:"Корея",uae:"ОАЭ",europe:"Европа",georgia:"Грузия"};
const fuels:Record<string,string>={petrol:"Бензин",diesel:"Дизель",electric:"Электро",hybrid:"Гибрид",lpg:"Газ LPG",cng:"Газ CNG"};
const rub=(n:number|null|undefined)=>typeof n==="number" && Number.isFinite(n)?`${Math.round(n).toLocaleString("ru-RU")} ₽`:"Требует уточнения";
export function offerPdfData(offer:VehicleOffer,draft:Record<string,string>,calculation:SavedCalculationResult|null,warning?:string):OfferPdfData {
 const lines=calculation?.breakdown || [];
 const amount=(id:string)=>lines.find(line=>line.id===id)?.amountRub ?? (calculation ? 0 : undefined);
 const row=(id:string,label:string):PdfLine=>({label,value:rub(amount(id))});
 const source=offer.sourcePrice!=null && offer.sourceCurrency ? `${offer.sourcePrice.toLocaleString("ru-RU")} ${offer.sourceCurrency}`:"";
 const rate=calculation?.currencyRate || offer.calculationSnapshot?.currencyRate;
 const abroad=[row("car",`Цена автомобиля${source?` · ${source}`:""}`),row("logistics","Логистика до России")];
 if(!calculation)abroad[0].value=rub(offer.sellerPriceRub ?? offer.calculationSnapshot?.sourcePriceRub);
 const foreignSum=amount("car")!=null && amount("logistics")!=null ? Number(amount("car"))+Number(amount("logistics")):null;
 abroad.push({label:`Итого: ${markets[offer.market] || offer.market}`,value:rub(foreignSum)});
 const local=lines.filter(line=>!["car","logistics","topavto-commission"].includes(line.id)).map(line=>({label:line.title || line.label || line.id,value:rub(line.amountRub)}));
 if(!calculation)local.push({label:"Доставка / перегруз по РФ",value:rub(null)},{label:"Таможенные платежи и утилизационный сбор",value:rub(null)},{label:"Брокер, СВХ, лаборатория, СБКТС, ЭПТС",value:rub(null)});
 const commission=amount("topavto-commission");
 local.push({label:"Стоимость авто до комиссии",value:rub(calculation && commission!=null?calculation.totalRub-commission:null)});
 return {title:catalogOfferTitle(offer),market:markets[offer.market] || offer.market,date:new Date().toLocaleDateString("ru-RU",{timeZone:"UTC"}),
 specs:[draft.year?`${draft.year} г.`:"",draft.engineCc?`${draft.engineCc} см³`:"",fuels[draft.fuel] || "",draft.powerHp?`${draft.powerHp} л.с.`:"",draft.power30MinKw?`30 мин: ${draft.power30MinKw} кВт`:"",offer.mileageKm!=null?`${offer.mileageKm.toLocaleString("ru-RU")} км`:""].filter(Boolean).join("  /  "),
 city:draft.deliveryCity || "Город доставки не выбран",rate:rate?.currency && Number(rate?.effectiveRate)>0?`1 ${rate.currency} = ${Number(rate.effectiveRate).toLocaleString("ru-RU",{maximumFractionDigits:4})} ₽${rate.rateDate?` · ${rate.rateDate}`:""}`:"Курс требует уточнения",
 sections:[{title:`01 / ${markets[offer.market] || offer.market}`,rows:abroad},{title:"02 / Россия",rows:local},{title:"03 / Сопровождение",rows:[{label:'Комиссия компании «TOP AVTO»',value:rub(commission)}]}],
 total:rub(calculation?.totalRub),deposit:rub(calculation?.paymentPlan?.securityDepositRub),warnings:[...(warning?[warning]:[]),...(calculation?.warnings || [])],url:`https://avtocena.com/cars/offer/${encodeURIComponent(offer.id)}`};
}
export async function renderOfferPdf(data:OfferPdfData):Promise<Buffer> {
 const publicDir=existsSync(path.join(process.cwd(),"public/fonts/DejaVuSans.ttf"))?path.join(process.cwd(),"public"):path.join(process.cwd(),"apps/web/public");
 const regular=path.join(publicDir,"fonts/DejaVuSans.ttf");
 const doc=new PDFDocument({size:"A4",margin:38,font:regular,bufferPages:true,info:{Title:`Расчёт · ${data.title}`,Author:"TOP AVTO / АвтоЦена"}});
 doc.registerFont("regular",regular);doc.registerFont("bold",path.join(publicDir,"fonts/DejaVuSans-Bold.ttf"));
 const chunks:Buffer[]=[];
 const output=new Promise<Buffer>((resolve,reject)=>{doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
 const W=519,ink="#1B222C",muted="#6B7280",orange="#F59E0B";let y=38;
 const text=(s:string,x:number,top:number,width:number,size=9,bold=false,color=ink)=>{doc.font(bold?"bold":"regular").fontSize(size).fillColor(color).text(s,x,top,{width,lineGap:2});};
 const room=(h:number)=>{if(y+h>765){doc.addPage();y=42;}};
 doc.roundedRect(38,y,W,100,18).fill(ink);
 text("АВТОЦЕНА / TOP AVTO",56,y+17,330,10,true,"#FFFFFF");text(data.date,440,y+18,98,9,false,"#ABB2BE");
 text("РАСЧЁТ СТОИМОСТИ АВТОМОБИЛЯ",56,y+41,470,8,false,"#ABB2BE");
 doc.font("bold").fontSize(22);const titleHeight=doc.heightOfString(data.title,{width:480});
 // Keep long trim names complete and move following content with their height.
 const heroHeight=Math.max(100,titleHeight+68);
 if(heroHeight>100)doc.roundedRect(38,y,W,heroHeight,18).fill(ink);
 if(heroHeight>100){text("АВТОЦЕНА / TOP AVTO",56,y+17,330,10,true,"#FFFFFF");text(data.date,440,y+18,98,9,false,"#ABB2BE");text("РАСЧЁТ СТОИМОСТИ АВТОМОБИЛЯ",56,y+41,470,8,false,"#ABB2BE");}
 text(data.title,56,y+55,480,22,true,"#FFFFFF"); y+=heroHeight+15;
 text(data.specs || "Характеристики требуют уточнения",38,y,W,9,false,muted);doc.font("regular").fontSize(9);y+=doc.heightOfString(data.specs || "Характеристики требуют уточнения",{width:W})+14;
 text(`${data.market}  →  ${data.city}`,38,y,W,10,true);y+=20;text(data.rate,38,y,W,8,false,muted);y+=23;
 for(const section of data.sections){room(65);doc.roundedRect(38,y,W,24,7).fill("#EEF1F5");text(section.title.toUpperCase(),50,y+8,W-24,8,true);y+=29;
  for(const row of section.rows){doc.font("regular").fontSize(9);const h=Math.max(22,doc.heightOfString(row.label,{width:325})+12,doc.heightOfString(row.value,{width:160})+12);room(h);
   text(row.label,48,y+5,325,9);doc.font("bold").fontSize(9).fillColor(ink).text(row.value,382,y+5,{width:165,align:"right"});doc.moveTo(48,y+h-2).lineTo(547,y+h-2).strokeColor("#E9ECF0").lineWidth(.5).stroke();y+=h;
  }y+=8;
 }
 room(210);doc.roundedRect(38,y,W,59,12).fill(ink);text("ИТОГО ПОД КЛЮЧ",53,y+12,175,8,true,"#AEB6C3");doc.font("bold").fontSize(data.total.length>24?16:23).fillColor(orange).text(data.total,210,y+18,{width:330,align:"right"});y+=70;
 text(`Обеспечительный платёж: ${data.deposit}`,38,y,W,9,true);y+=18;
 const notes=["Обеспечительный платёж указан отдельно как этап оплаты; повторно к итогу не прибавляется.",...data.warnings,"Суммы в иностранной валюте пересчитаны по курсам на момент расчёта. Информация носит справочный характер и не является офертой."];
 for(const note of notes){doc.font("regular").fontSize(7);const h=doc.heightOfString(note,{width:W})+6;room(h);text(note,38,y,W,7,false,muted);y+=h;}
 room(88);y+=8;doc.moveTo(38,y).lineTo(557,y).strokeColor("#D8DDE4").stroke();y+=13;
 const contacts=[["Япония","+7 903 071-33-03","IvanTOPAVTO"],["Другие страны","+7 923 479-19-88","Anton_Molodykh90"],["Оформление документов","+7 923 623-47-77","nvkz_zenit"]];
 contacts.forEach(([label,phone,tg],i)=>{const x=38+i*176;text(label,x,y,172,8,true);doc.font("regular").fontSize(9).fillColor(ink).text(phone,x,y+17,{width:172,link:`tel:${phone.replace(/[^+0-9]/g,"")}`});doc.font("regular").fontSize(8).fillColor("#008CCB").text("Telegram",x,y+34,{link:`https://t.me/${tg}`,width:170});});y+=56;
 doc.font("regular").fontSize(8).fillColor(muted).text("topavto.online",38,y,{link:"https://topavto.online/",width:170});doc.text("@TopAvtoImport",214,y,{link:"https://t.me/TopAvtoImport",width:170});doc.text("Карточка автомобиля ↗",390,y,{link:data.url,width:170});
 const count=doc.bufferedPageRange().count;
 for(let i=0;i<count;i++){doc.switchToPage(i);text("АВТОЦЕНА  /  Индивидуальный расчёт",38,791,390,7,false,muted);doc.font("regular").fontSize(7).text(`${i+1} / ${count}`,510,791,{width:47,align:"right"});}
 doc.end();return output;
}
