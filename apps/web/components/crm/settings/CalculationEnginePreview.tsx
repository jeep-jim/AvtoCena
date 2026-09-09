import { expandCustomsBreakdown } from "@/lib/catalog/customs-breakdown";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { calculateCustomerParameterScenario, isOfficialCustomsCurrencyRate } from "@/lib/catalog/customs-pricing";
import { resolveCatalogMarketConfig } from "@/lib/catalog/estimated-market-config";
import {
  utilizationPowerKwForInput,
  type RussiaPowertrainKind,
} from "../../../../../packages/engine/src/calculation/russiaCustomsV2";

type SearchParams = Record<string, string | string[] | undefined>;

type Props = {
  markets: any[];
  query: SearchParams;
};

const MARKET_ORDER = ["japan", "china", "korea", "uae", "europe", "georgia"];
const POWERTRAINS: Array<{ value: RussiaPowertrainKind; label: string }> = [
  { value: "combustion", label: "Бензин / дизель" },
  { value: "electric", label: "Электромобиль" },
  { value: "series_hybrid", label: "Последовательный гибрид / EREV" },
  { value: "other_hybrid", label: "Другой гибрид / PHEV / HEV" },
];

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

function positive(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function num(query: SearchParams, key: string, fallback = 0) {
  return positive(first(query[key]), fallback);
}

function rub(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? `${new Intl.NumberFormat("ru-RU").format(Math.round(parsed))} ₽` : "—";
}

function number(value: unknown, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(parsed);
}

function rateSourceLabel(value: unknown) {
  const source = String(value || "");
  if (source === "cbr_live") return "ЦБ РФ · live";
  if (source === "cbr") return "ЦБ РФ";
  if (source === "moex") return "MOEX";
  if (source === "fallback_env") return "резервный курс";
  if (source === "legacy_json") return "старый снимок";
  return source || "нет курса";
}

function inputClass() {
  return "soft-input min-w-0 rounded-xl px-3 py-3 text-sm font-black";
}

function formulaForPower(kind: RussiaPowertrainKind, powerHp: number, icePowerKw: number, power30MinKw: number) {
  if (kind === "combustion") return powerHp ? `${number(powerHp)} л.с. × 0,73549875` : "Нужна мощность ДВС";
  if (kind === "electric" || kind === "series_hybrid") return power30MinKw ? `${number(power30MinKw)} кВт · 30-минутная мощность` : "Нужна подтверждённая 30-минутная мощность";
  if (kind === "other_hybrid") {
    return icePowerKw && power30MinKw
      ? `${number(icePowerKw)} кВт ДВС + ${number(power30MinKw)} кВт · 30 мин`
      : "Нужны кВт ДВС + подтверждённая 30-минутная мощность";
  }
  return "Недостаточно данных";
}

export async function CalculationEnginePreview({ markets, query }: Props) {
  const requestedMarket = first(query.calcMarket) || "korea";
  const marketId = MARKET_ORDER.includes(requestedMarket) ? requestedMarket : "korea";
  const market = markets.find((item) => item.id === marketId) || markets.find((item) => item.id === "korea") || markets[0];
  const configured = market?.effectiveVersion || market?.versions?.find((item: any) => item.id === market?.activeVersionId) || market?.versions?.[0] || null;
  const resolved = resolveCatalogMarketConfig(marketId as any, configured);
  const currency = String(resolved.config?.currency || configured?.currency || "RUB").toUpperCase();

  const defaultSourcePrice = marketId === "korea" ? 40_000_000 : 1_000_000;
  const sourcePrice = num(query, "calcSourcePrice", defaultSourcePrice);
  const productionDate = first(query.calcProductionDate) || "2025-01";
  const engineCc = num(query, "calcEngineCc", marketId === "korea" ? 2_497 : 2_000);
  const powerHp = num(query, "calcPowerHp", marketId === "korea" ? 304 : 150);
  const power30MinKw = num(query, "calcPower30MinKw", 0);
  const icePowerKw = num(query, "calcIcePowerKw", 0);
  const requestedKind = first(query.calcPowertrain) as RussiaPowertrainKind;
  const powertrainKind = POWERTRAINS.some((item) => item.value === requestedKind) ? requestedKind : "combustion";

  const vehicleCategory = first(query.calcCategory) === "N1" ? "N1" : "M1";
  const fuel = first(query.calcFuel) === "diesel" ? "diesel" : "petrol";
  const grossVehicleWeightKg = num(query,"calcGrossWeight",0);
  const calculationDate = first(query.calcDate) || new Date().toISOString().slice(0,10);
  const transportRaw = first(query.calcBorderTransport);
  const transportToBorderRub = transportRaw === "" ? Number(resolved.config.logisticsRub || 0) : Number(transportRaw);
  const customsInput = {
    engineCc: powertrainKind === "electric" ? undefined : engineCc || undefined,
    powerHp: powerHp || undefined, icePowerKw:icePowerKw || undefined,
    power30MinKw:power30MinKw || undefined, powertrainKind, productionDate,
    fuel:powertrainKind === "combustion" ? fuel : powertrainKind === "electric" ? "electric" : "hybrid",
    vehicleCategory, grossVehicleWeightKg, n1IceFuel:fuel,
    transportToBorderRub, customsCalculationDate:calculationDate, personalUseEligible:true,
  } as const;
  const inputErrors: string[] = [];
  for (const key of ["calcSourcePrice","calcEngineCc","calcPowerHp","calcIcePowerKw","calcPower30MinKw","calcGrossWeight","calcBorderTransport"]) {
    const raw = first(query[key]);
    if (raw && (!Number.isFinite(Number(raw)) || Number(raw) < 0 || (key === "calcSourcePrice" && Number(raw) === 0))) inputErrors.push(`Некорректное значение: ${key}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calculationDate) || !Number.isFinite(Date.parse(calculationDate)) || new Date(calculationDate).toISOString().slice(0,10) !== calculationDate) inputErrors.push("Укажите существующую дату расчёта");
  const preview = inputErrors.length ? {totalRub:null,calculationSnapshot:{missing:inputErrors,warnings:inputErrors}} : await calculateCustomerParameterScenario({id:"crm-preview",market:marketId,sourcePrice,sourceCurrency:currency} as any,customsInput);
  const snapshot: any = preview.calculationSnapshot || {};
  const sourceRate = snapshot.currencyRate;
  const eurRate = snapshot.eurRate;
  const sourceRateExact = Boolean(sourceRate && isOfficialCustomsCurrencyRate(sourceRate));
  const eurRateExact = Boolean(eurRate && isOfficialCustomsCurrencyRate(eurRate));
  const customs = snapshot.customs;
  const utilizationPowerKw = vehicleCategory === "N1" ? undefined : utilizationPowerKwForInput({...customsInput,customsValueRub:0,eurRateRub:0});
  const business = preview.totalRub && customs?.status === "ready" && snapshot.priceIncludesAllCustoms === true
    ? {totalRub:preview.totalRub,breakdown:expandCustomsBreakdown(snapshot.breakdown || [],customs)} : null;

  const marketExtras = business
    ? Math.max(0, business.totalRub - Number(sourceRate?.sourcePriceRub || 0) - Number(customs?.totalCustomsRub || 0))
    : 0;
  const missing = [...new Set([...(customs?.missing || []),...(snapshot.missing || [])])];
  const warnings = snapshot.warnings || [];

  return (
    <section className="ac-calc-preview glass mb-4 overflow-hidden rounded-[1.8rem]">
      <div className="border-b border-white/8 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-400/12 px-2.5 py-1 text-[11px] font-black uppercase tracking-[.08em] text-emerald-300">живой контроль ядра</span>
              <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-black text-white/55">RF {vehicleCategory} · 2026</span>
              {resolved.estimated ? <span className="rounded-full bg-amber-400/12 px-2.5 py-1 text-[11px] font-black text-amber-200">коммерческие расходы: средний профиль</span> : null}
            </div>
            <h2 className="text-2xl font-black md:text-3xl">Как сайт считает цену прямо сейчас</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-white/52">
              Это не справочная таблица с продублированными формулами. Блок запускает то же ядро таможни, ту же таблицу утильсбора 2026, тот же курс и тот же коммерческий калькулятор, которыми считаются публичные карточки. Меняется ядро или активная версия рынка — меняется и этот контрольный расчёт.
            </p>
          </div>
          <div className="rounded-2xl bg-white/[.055] px-4 py-3 text-right">
            <div className="text-[11px] font-black uppercase tracking-[.08em] text-white/38">активная конфигурация</div>
            <div className="mt-1 text-sm font-black">{resolved.config?.id || `market_${marketId}`} · v{resolved.config?.version || 1}</div>
          </div>
        </div>
      </div>

      <form method="get" action="/crm/settings" className="grid gap-3 border-b border-white/8 p-5 md:grid-cols-2 md:p-6 xl:grid-cols-4">
        <label className="grid gap-1.5 text-xs font-black uppercase tracking-[.07em] text-white/45">
          Рынок
          <select name="calcMarket" defaultValue={marketId} className={inputClass()}>
            {markets.filter((item) => MARKET_ORDER.includes(item.id)).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-black uppercase tracking-[.07em] text-white/45">
          Цена объявления, {currency}
          <input name="calcSourcePrice" type="number" min="1" step="1" defaultValue={sourcePrice} className={inputClass()} />
        </label>
        <label className="grid gap-1.5 text-xs font-black uppercase tracking-[.07em] text-white/45">
          Дата производства
          <input name="calcProductionDate" placeholder="ГГГГ-ММ-ДД или ГГГГ-ММ" defaultValue={productionDate} className={inputClass()} />
        </label>
        <label className="grid gap-1.5 text-xs font-black uppercase tracking-[.07em] text-white/45">
          Силовая установка
          <select name="calcPowertrain" defaultValue={powertrainKind} className={inputClass()}>
            {POWERTRAINS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-black uppercase tracking-[.07em] text-white/45">
          Объём ДВС, см³
          <input name="calcEngineCc" type="number" min="0" step="1" defaultValue={engineCc || ""} className={inputClass()} />
        </label>
        <label className="grid gap-1.5 text-xs font-black uppercase tracking-[.07em] text-white/45">
          Мощность ДВС, л.с. / PS
          <input name="calcPowerHp" type="number" min="0" step="0.01" defaultValue={powerHp || ""} className={inputClass()} />
        </label>
        <label className="grid gap-1.5 text-xs font-black uppercase tracking-[.07em] text-white/45">
          ДВС для гибрида, кВт
          <input name="calcIcePowerKw" type="number" min="0" step="0.01" defaultValue={icePowerKw || ""} className={inputClass()} />
        </label>
        <label className="grid gap-1.5 text-xs font-black uppercase tracking-[.07em] text-white/45">
          30-мин. мощность электромоторов, кВт
          <input name="calcPower30MinKw" type="number" min="0" step="0.01" defaultValue={power30MinKw || ""} className={inputClass()} />
        </label>
        <label className="grid gap-1.5 text-xs font-black text-white/45">Категория<select name="calcCategory" defaultValue={vehicleCategory} className={inputClass()}><option value="M1">M1 · Легковой</option><option value="N1">N1 · Грузовой до 3,5 т</option></select></label>
        <label className="grid gap-1.5 text-xs font-black text-white/45">Топливо ДВС<select name="calcFuel" defaultValue={fuel} className={inputClass()}><option value="petrol">Бензин</option><option value="diesel">Дизель</option></select></label>
        <label className="grid gap-1.5 text-xs font-black text-white/45">Полная масса N1, кг<input name="calcGrossWeight" type="number" min="1" max="3500" defaultValue={grossVehicleWeightKg||""} className={inputClass()}/></label>
        <label className="grid gap-1.5 text-xs font-black text-white/45">Дата таможенного расчёта<input name="calcDate" type="date" defaultValue={calculationDate} className={inputClass()}/></label>
        <label className="grid gap-1.5 text-xs font-black text-white/45">Доставка N1 до границы, ₽<input name="calcBorderTransport" type="number" min="0" defaultValue={transportToBorderRub} className={inputClass()}/><span>Заменяет строку логистики для N1; входит в таможенную стоимость.</span></label>
        <button className="rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black text-white md:col-span-2 xl:col-span-4">Пересчитать тем же движком, что и сайт</button>
      </form>

      <div className="grid gap-3 p-5 md:grid-cols-2 md:p-6 xl:grid-cols-5">
        <div className="rounded-2xl bg-white/[.055] p-4">
          <div className="text-[11px] font-black uppercase tracking-[.08em] text-white/38">цена после курса</div>
          <div className="mt-2 text-2xl font-black">{sourceRate ? rub(sourceRate.sourcePriceRub) : "нет курса"}</div>
          <div className="mt-1 text-xs font-bold text-white/42">{rateSourceLabel(sourceRate?.rateSource)} · {sourceRate?.rateDate || "—"}</div>
        </div>
        <div className="rounded-2xl bg-white/[.055] p-4">
          <div className="text-[11px] font-black uppercase tracking-[.08em] text-white/38">таможенные платежи</div>
          <div className="mt-2 text-2xl font-black">{customs ? rub(customs.knownCustomsRub) : "нужны данные"}</div>
          <div className="mt-1 text-xs font-bold text-white/42">{customs?.ruleVersion || "расчёт заблокирован"}</div>
        </div>
        <div className="rounded-2xl bg-white/[.055] p-4">
          <div className="text-[11px] font-black uppercase tracking-[.08em] text-white/38">утилизационный сбор</div>
          <div className="mt-2 text-2xl font-black">{customs?.utilizationFeeRub !== undefined ? rub(customs.utilizationFeeRub) : "нужны данные"}</div>
          <div className="mt-1 text-xs font-bold text-white/42">коэффициент {customs?.utilizationCoefficient !== undefined ? number(customs.utilizationCoefficient, 4) : "—"}</div>
        </div>
        <div className="rounded-2xl bg-white/[.055] p-4">
          <div className="text-[11px] font-black uppercase tracking-[.08em] text-white/38">расходы рынка + резерв</div>
          <div className="mt-2 text-2xl font-black">{business ? rub(marketExtras) : "—"}</div>
          <div className="mt-1 text-xs font-bold text-white/42">активная версия CRM</div>
        </div>
        <div className="rounded-2xl bg-red-500/12 p-4 ring-1 ring-red-400/20">
          <div className="text-[11px] font-black uppercase tracking-[.08em] text-red-200/65">итог на сайте</div>
          <div className="mt-2 text-2xl font-black text-white">{business ? rub(business.totalRub) : "не публикуется"}</div>
          <div className="mt-1 text-xs font-bold text-red-100/55">только когда обязательные данные подтверждены</div>
        </div>
      </div>

      <div className="px-5 pb-5 md:px-6 md:pb-6">
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-white/[.035] px-4 py-3 text-sm font-bold text-white/58">
          <CatalogMarketFlag market={marketId as any} className="h-5 w-7 shrink-0" />
          <span>{market?.name || marketId}</span>
          <span className="text-white/25">→</span>
          <span>{number(sourcePrice, 2)} {currency}</span>
          <span className="text-white/25">→</span>
          <span>{sourceRate ? `${number(sourceRate.effectiveRate, 6)} ₽/${currency}` : "курс не найден"}</span>
          <span className="text-white/25">→</span>
          <span>{rub(sourceRate?.sourcePriceRub)}</span>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/8">
          <table className="min-w-[780px] w-full text-left text-sm">
            <thead className="bg-white/[.055] text-[11px] font-black uppercase tracking-[.08em] text-white/42">
              <tr>
                <th className="px-4 py-3">Этап</th>
                <th className="px-4 py-3">Что делает сайт</th>
                <th className="px-4 py-3">Данные / формула</th>
                <th className="px-4 py-3 text-right">Результат</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/7 font-bold">
              <tr>
                <td className="px-4 py-3 font-black">1. Курс</td>
                <td className="px-4 py-3 text-white/62">Переводит цену объявления в рубли по курсу ЦБ РФ.</td>
                <td className="px-4 py-3 text-white/45">{number(sourcePrice)} {currency} × {sourceRate ? number(sourceRate.effectiveRate, 8) : "—"}</td>
                <td className="px-4 py-3 text-right font-black">{sourceRate ? rub(sourceRate.sourcePriceRub) : "—"}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-black">2. Мощность</td>
                <td className="px-4 py-3 text-white/62">Приводит мощность к юридически используемым кВт. Для EV/EREV берёт подтверждённую 30-минутную мощность, а не пик.</td>
                <td className="px-4 py-3 text-white/45">{formulaForPower(powertrainKind, powerHp, icePowerKw, power30MinKw)}</td>
                <td className="px-4 py-3 text-right font-black">{vehicleCategory === "N1" ? `${number(grossVehicleWeightKg)} кг · по полной массе` : utilizationPowerKw ? `${number(utilizationPowerKw, 5)} кВт` : "нужны данные"}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-black">3. Возраст</td>
                <td className="px-4 py-3 text-white/62">Определяет юридическую дату производства и возрастную группу на дату расчёта.</td>
                <td className="px-4 py-3 text-white/45">{productionDate}</td>
                <td className="px-4 py-3 text-right font-black">{customs?.productionReferenceDate || "—"} · {customs?.ageBand || "—"}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-black">4. Утильсбор</td>
                <td className="px-4 py-3 text-white/62">Выбирает строку таблицы 2026 по типу силовой установки, объёму ДВС, мощности и возрасту.</td>
                <td className="px-4 py-3 text-white/45">коэффициент {customs?.utilizationCoefficient !== undefined ? number(customs.utilizationCoefficient, 4) : "—"} × 20 000 ₽</td>
                <td className="px-4 py-3 text-right font-black">{customs?.utilizationFeeRub !== undefined ? rub(customs.utilizationFeeRub) : "—"}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-black">5. Таможня</td>
                <td className="px-4 py-3 text-white/62">Считает оформление, ввозную пошлину, акциз и НДС, где они применимы. Утильсбор остаётся отдельной строкой.</td>
                <td className="px-4 py-3 text-white/45">EUR {eurRate ? number(eurRate.effectiveRate, 4) : "—"} ₽ · {rateSourceLabel(eurRate?.rateSource)}</td>
                <td className="px-4 py-3 text-right font-black">{customs ? rub(customs.knownCustomsRub) : "—"}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-black">6. Коммерческие расходы</td>
                <td className="px-4 py-3 text-white/62">Добавляет только активную версию расходов выбранного рынка и резерв курса.</td>
                <td className="px-4 py-3 text-white/45">{resolved.config?.id || "—"} · резерв {number(resolved.config?.exchangeRateReservePercent || 0)}%</td>
                <td className="px-4 py-3 text-right font-black">{business ? rub(marketExtras) : "—"}</td>
              </tr>
              <tr className="bg-red-500/[.07]">
                <td className="px-4 py-4 text-base font-black">7. Итог</td>
                <td className="px-4 py-4 text-white/70">Цена карточки = автомобиль + таможенные платежи + утильсбор + расходы рынка.</td>
                <td className="px-4 py-4 text-white/50">без двойного учёта обеспечительного платежа</td>
                <td className="px-4 py-4 text-right text-lg font-black">{business ? rub(business.totalRub) : "расчёт заблокирован"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {customs?.breakdown?.length ? (
          <details className="mt-4 rounded-2xl bg-white/[.035]">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-black [&::-webkit-details-marker]:hidden">Развернуть пошлину и утилизационный сбор</summary>
            <div className="border-t border-white/7 px-4 py-2">
              {customs.breakdown.map((line: any) => (
                <div key={line.id} className="flex items-start justify-between gap-4 border-b border-white/6 py-2.5 last:border-0">
                  <div>
                    <div className="text-sm font-black">{line.title}</div>
                    {line.note ? <div className="mt-0.5 text-xs font-bold text-white/40">{line.note}</div> : null}
                  </div>
                  <div className="shrink-0 text-sm font-black">{line.amountRub !== undefined ? rub(line.amountRub) : "—"}</div>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {business?.breakdown?.length ? (
          <details className="mt-3 rounded-2xl bg-white/[.035]">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-black [&::-webkit-details-marker]:hidden">Развернуть структуру итоговой цены сайта</summary>
            <div className="border-t border-white/7 px-4 py-2">
              {business.breakdown.map((line: any) => (
                <div key={line.id} className="flex items-start justify-between gap-4 border-b border-white/6 py-2.5 last:border-0">
                  <div>
                    <div className="text-sm font-black">{line.title}</div>
                    <div className="mt-0.5 text-xs font-bold text-white/40">{line.source}{line.note ? ` · ${line.note}` : ""}</div>
                  </div>
                  <div className="shrink-0 text-sm font-black">{rub(line.amountRub)}</div>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 py-3 text-base font-black">
                <span>Итого на сайте</span><span>{rub(business.totalRub)}</span>
              </div>
            </div>
          </details>
        ) : null}

        {!sourceRateExact || !eurRateExact ? (
          <div className="mt-4 rounded-2xl bg-red-500/12 px-4 py-3 text-sm font-bold leading-6 text-red-100">
            Точный расчёт остановлен: для таможни публичный движок принимает только официальный курс ЦБ РФ. Источник цены: {rateSourceLabel(sourceRate?.rateSource)}, EUR: {rateSourceLabel(eurRate?.rateSource)}.
          </div>
        ) : null}
        {missing.length ? (
          <div className="mt-4 rounded-2xl bg-amber-400/10 px-4 py-3 text-sm font-bold leading-6 text-amber-100">
            Не хватает обязательных данных: {missing.join(", ")}. Как и публичный сайт, контрольный блок не показывает финальную рассчитанную цену, пока они не подтверждены.
          </div>
        ) : null}
        {warnings.length ? (
          <details className="mt-3 rounded-2xl bg-amber-400/[.06]">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-black text-amber-100 [&::-webkit-details-marker]:hidden">Предупреждения и допущения ({warnings.length})</summary>
            <div className="border-t border-amber-300/10 px-4 py-3 text-xs font-bold leading-5 text-amber-100/70">
              {warnings.map((warning, index) => <div key={`${warning}-${index}`}>• {warning}</div>)}
            </div>
          </details>
        ) : null}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        html[data-theme="light"] .ac-calc-preview{color:#1e2430!important}
        html[data-theme="light"] .ac-calc-preview .text-white{color:#1e2430!important}
        html[data-theme="light"] .ac-calc-preview [class*="text-white/"]{color:rgba(30,36,48,.62)!important}
      ` }} />
    </section>
  );
}
