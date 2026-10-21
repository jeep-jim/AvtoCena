import { Car, BadgeCheck, Gavel, Gauge, Cog, Settings2, Ruler, Weight, Fuel, BatteryCharging, Battery, Zap, PlugZap, Shield, ShieldCheck, ShieldAlert, LockKeyhole, Armchair, Thermometer, Wind, Fan, Lightbulb, Lamp, Sun, PanelsTopLeft, ScanEye, Route, Radar, Camera, Navigation, CircleParking, Music, Radio, Speaker, Monitor, Smartphone, Wifi, Usb, KeyRound, CircleDot, Disc3, Mountain, Truck, Package, Wrench, ClipboardCheck, History, FileCheck, Paintbrush, DoorOpen, CircleGauge, ListChecks, Droplets, type LucideIcon } from "lucide-react";
const icons: Array<[RegExp,LucideIcon]> = [
 [/подтвержд|сертификат/i,BadgeCheck],[/аукцион|экспорт/i,Gavel],[/истори/i,History],[/документ/i,FileCheck],[/гарант/i,ShieldCheck],[/обслужив|ремонт/i,Wrench],[/состояни|осмотр/i,ClipboardCheck],
 [/30.мин|мощност/i,Gauge],[/электродвиг|электромотор/i,Zap],[/двигател/i,Cog],[/коробк|трансмис/i,Settings2],[/размер|габарит/i,Ruler],[/масса|вес/i,Weight],[/расход|топлив/i,Fuel],[/батар.*заряд|аккумулятор.*заряд/i,BatteryCharging],[/батар|аккумулятор/i,Battery],[/заряд.*салон|разъём/i,Usb],[/заряд/i,PlugZap],
 [/пассивн.*безопас/i,Shield],[/активн.*безопас/i,ShieldAlert],[/безопас/i,ShieldCheck],[/угон|охран/i,LockKeyhole],[/сиден|кресл/i,Armchair],[/климат|кондицион/i,Thermometer],[/вентиляц/i,Fan],[/воздух|очист/i,Wind],[/отоплен/i,Sun],[/аудио.*освещ/i,Speaker],[/освещ.*салон|внутрен.*свет/i,Lamp],[/освещ|фары|фонар/i,Lightbulb],[/стёкл|стекл|люк|крыш/i,PanelsTopLeft],[/зеркал/i,ScanEye],
 [/режим.*движ|управлен.*автомоб/i,Route],[/датчик|оборудован.*помощ/i,Radar],[/камер/i,Camera],[/навигац/i,Navigation],[/парков/i,CircleParking],[/помощ.*водител|ассистент/i,Radar],[/аудио|звук/i,Music],[/радио/i,Radio],[/мультимедиа|экран/i,Monitor],[/телефон/i,Smartphone],[/связь|интеллект|электрон/i,Wifi],[/ключ/i,KeyRound],
 [/тормоз/i,Disc3],[/колёс|шин/i,CircleDot],[/внедорож|полный привод/i,Mountain],[/рул/i,CircleGauge],[/шасси|подвес/i,Settings2],[/груз/i,Truck],[/багаж/i,Package],[/цвет|окраск/i,Paintbrush],[/двер/i,DoorOpen],[/вод[аы]|бак.*вод/i,Droplets],[/кузов|внешн/i,Car],[/салон|интерьер|комфорт/i,Armchair],[/автомобил|основн|общие|техническ/i,Car],
];
export function SpecificationSectionIcon({name}:{name:string}) {
 const Icon=icons.find(([pattern])=>pattern.test(name))?.[1] || ListChecks;
 return <Icon size={28} strokeWidth={1.7} aria-hidden className="shrink-0"/>;
}
