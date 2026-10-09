import {getOfferFromCurrentShard as getEditorialSourceOffer} from "@/lib/catalog/storage";
import {CatalogEditorialEditor} from "@/components/catalog/CatalogEditorialEditor";
import {canEditCatalog} from "@/lib/catalog/editorial-access";
import {readCatalogEditorial,applyCatalogEditorial} from "@/lib/catalog/editorial";
import {commercialParameters} from "@/lib/catalog/commercial-parameters";
import {decodeShareDraft} from '@/lib/catalog/offer-share';
import {SpecTile,type SpecItem} from "@/components/catalog/OfferSpecTile";
import {offerParameterDraft} from '@/lib/catalog/offer-parameter-draft';
import {sharedOfferScenario} from '@/lib/catalog/shared-offer-scenario';
import {resolveOfferDisplay} from '@/lib/catalog/offer-display-data';
export {generateOfferMetadata as generateMetadata} from '@/lib/catalog/offer-metadata';
import {SpecialOfferPage} from "@/components/dealers/SpecialOfferPage";
import {parseSpecialId} from "@/lib/dealers/showcase-model";
import { canCopyOffer } from "@/lib/offer-copy";
import { directOfferScenario } from "@/lib/catalog/yandex-direct-scenario";
import { offerPath, offerRouteId } from "@/lib/catalog/offer-url";
import { permanentRedirect } from "next/navigation";
import { selectRelatedOfferGroups, isRenderableRelatedOffer } from "@/lib/catalog/related-offer-selection";
import { readRelatedModelFamily } from "@/lib/catalog/related-model-family";
import { readGreenCorner, publicGreenOffer } from "@/lib/catalog/green-corner";
import { filterGreenCorner } from "@/lib/catalog/green-corner-search";
import { PUBLIC_CATALOG_MARKETS, CATALOG_MARKET_LABELS } from "@/lib/catalog/runtime-config";
import { isGreenCornerOffer } from "@/lib/catalog/green-corner-contract";
import { OfferUpdatedStatus } from "@/components/catalog/OfferUpdatedStatus";
import { protectedPhotoUrl } from "@/lib/catalog/photo-proxy-policy";
import { OfferFinanceCards } from "@/components/catalog/OfferFinanceCards";
import { readCrmUsers } from "@/lib/crm-users";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { getSavedOfferCalculation } from "@/lib/catalog/saved-offer-calculation";
import { PageLeadBanner } from "@/components/leads/PublicLeadCaptureV2";
import {restoreProAuctionsPower,proAuctionsReportedVolume,proAuctionsHybridDraft} from "@/lib/catalog/proauctions-source-parameters";
import { businessPaymentPlan } from "../../../../../../../packages/engine/src/calculation/calculateAvtocena";
import { applyActiveBusinessPricing, applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
import { customerPriceBreakdown } from "@/lib/catalog/customer-price-breakdown";
import { recyclingPowerInfo, type RecyclingPowerInfo } from "@/lib/catalog/recycling-power";
import { RecyclingFeeHelp } from "@/components/catalog/RecyclingPower";
import { translatedSpecificationGroups } from "@/lib/catalog/specification-translation-storage";
import { enrichOfferWithSourceTableParameters } from "@/lib/catalog/source-table-displacement";
import { expandCustomsBreakdown } from "@/lib/catalog/customs-breakdown";
import { StickyOfferColumn } from "@/components/catalog/StickyOfferColumn";
import { confirmedProductionMonth, confirmedProductionDay } from "@/lib/catalog/production-month";
import { isSellerPricedOffer } from "@/lib/catalog/seller-price-contract";
import { JapanAuctionBadges } from "@/components/catalog/JapanAuctionBadges";
import { SellerPrice } from "@/components/catalog/SellerPrice";
import { InlineOfferParameters } from "@/components/catalog/InlineOfferParameters";
import { OfferSpecificationsDisclosure } from "@/components/catalog/OfferSpecificationsDisclosure";
import { offerSpecificationGroups } from "@/lib/catalog/offer-specification-groups";
import { assessJapanExportRestriction, japanRestrictionDescription } from "@/lib/catalog/japan-export-restriction";
import { hasModificationSelection, withoutDeliveredPrice } from "@/lib/catalog/modification-contract";
import { calculateSelectedModification, conditionalModificationRub } from "@/lib/catalog/modification-recovery";
import { Suspense, type ReactNode } from "react";
import {DealerLink as Link,DealerBrowsingProvider} from "@/components/dealers/DealerBrowsingContext";
import {resolveDealerBrowsingContext} from "@/lib/dealers/resolve-browsing-context";
import { UnavailableOffer } from "@/components/catalog/UnavailableOffer";
import { unavailableOfferRecord } from "@/lib/catalog/offer-availability";
import { money } from "@/lib/avtocena";
import { CatalogCard } from "@/components/catalog/CatalogCard";

import { VehicleResearchLink } from "@/components/catalog/VehicleResearchLink";
import { OfferContactActionsStyles, OfferCreditCalculator, OfferDesktopActions, OfferMobileActions } from "@/components/catalog/OfferContactActions";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { PreliminaryPrice } from "@/components/catalog/PreliminaryPrice";
import { AuctionResultPrice, PriceTrend } from "@/components/catalog/PriceTrend";
import { VehicleGallery } from "@/components/catalog/VehicleGallery";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { AFFILIATE_LINK_REL, AUTOCREDIT_AFFILIATE_URL, OSAGO_AFFILIATE_URL } from "@/lib/affiliate-links";
import { catalogBrandSlug } from "@/lib/catalog/brands";
import { enrichOfferForDisplay } from "@/lib/catalog/display-enrichment";
import { rankedCatalogImageUrls, catalogAuctionSheetUrls } from "@/lib/catalog/image-quality";
import { isRenderablePublicCatalogOffer } from "@/lib/catalog/offer-quality";
import { getOfferForPage, getOfferDetailRecord } from "@/lib/catalog/offer-page-data";
import { catalogPowerDisplay } from "@/lib/catalog/power-display";
import { publicCatalogPowerHp } from "@/lib/catalog/power-sanity";
import { safePublicPricing } from "@/lib/catalog/safe-public-pricing";
import { catalogOfferVisibleRub } from "@/lib/catalog/public-priority";
import { calculateOfferWithRussiaCustoms, calculateOfferWithUserPowerScenario } from "@/lib/catalog/customs-pricing";
import { readCatalogPowerScenario } from "@/lib/catalog/power-scenario";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { normalizeVehicleOfferSpecs } from "@/lib/catalog/spec-normalization";
import { getUnavailableOffer, getOfferFromCurrentProjection, getOfferFromCurrentShard, isJapanCatalogOfferId, publicOffer, searchOffers } from "@/lib/catalog/storage";

// Offer inventory changes independently from web deploys. Never persist a
// not-found render for an ID that can become available in a later generation.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function sentence(value: unknown) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toLocaleUpperCase("ru-RU") + text.slice(1) : "";
}

function knownValue(value: unknown) {
  const normalized = sentence(value);
  if (!normalized || /уточняется|не указан|unknown|неизвест/i.test(normalized)) return "";
  // Never leak unresolved Chinese/Japanese/Korean source text into public specs.
  if (/[가-힣\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(normalized)) return "";
  return normalized;
}

function driveValue(value: unknown) {
  const normalized = knownValue(value);
  if (!normalized) return "";
  return /привод/i.test(normalized) ? normalized : `${normalized} привод`;
}

function safeExternalUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

async function SimilarOffers({ current, markets }: { current: any; markets?:string[] }) {
  const make = String(current.make || "").trim();
  const familyModel = await readRelatedModelFamily(make, String(current.model || "").trim());
  const greenCurrent = isGreenCornerOffer(current);
  const presented = presentCatalogOffer(current);
  const modelTitle = [presented.makeLabel, familyModel || presented.modelLabel].filter(Boolean).join(" ");
  const otherMarkets = PUBLIC_CATALOG_MARKETS.filter(market => market !== current.market);
  // Bounded model queries stream behind the primary offer; failures stay isolated by market.
  const safeSearch = (params: Parameters<typeof searchOffers>[0]) => searchOffers(params).catch(error => {
    console.error("offer_similar_search_failed", error); return {items:[],total:0};
  });
  const [modelResult, marketResult, crossResults, green] = await Promise.all([
    familyModel && make ? safeSearch({market:current.market,make,model: familyModel,pageSize:48,sort:"updatedAt"}) : Promise.resolve({items:[],total:0}),
    safeSearch({market:current.market,pageSize:48,sort:"updatedAt"}),
    Promise.all(otherMarkets.map(async market => ({market,...(familyModel && make ? await safeSearch({market,make,model: familyModel,pageSize:24,sort:"updatedAt"}) : {items:[],total:0})}))),
    familyModel && make ? readGreenCorner().catch(()=>null) : Promise.resolve(null),
  ]);
  const greenModels = green ? filterGreenCorner(green.items,{make,model:familyModel}).map(publicGreenOffer) : [];
  const {stockModels,sameModel,crossMarketGroups,marketRows} = await selectRelatedOfferGroups({
    current,modelRows:modelResult.items,marketRows:marketResult.items,crossResults,
    greenModels,greenRows:(green?.items||[]).map(publicGreenOffer),
    price:applyActiveBusinessPricingBatch,renderable:isRenderableRelatedOffer,
  });
  const marketTotal = Math.max(0,Number(marketResult.total||0)) + (current.market==='japan' ? green?.items.length||0 : 0);
  const modelParams = new URLSearchParams({market:String(current.market||""),make,model:familyModel});
  const marketParams = new URLSearchParams({market:String(current.market||"")});
  if(current.market==='japan')marketParams.set('stock','all');
  const marketLabel = String(presented.marketLabel || current.market || "рынка");
  const rail = (rows:any[]) => <div className="ac-result-rail ac-hide-scrollbar mt-5 md:!grid md:!grid-flow-row md:!grid-cols-2 md:!auto-cols-auto md:!overflow-visible xl:!grid-cols-4">{rows.map(item=><CatalogCard key={item.id} offer={item} compact />)}</div>;
  return <div className="mt-10 space-y-10 md:mt-14 md:space-y-14" data-related-offers>
    {stockModels.length && (!markets||markets.includes("japan")) ? <section data-related-section="stock-model"><div className="flex items-end justify-between gap-3"><h2 className="ac-green-heading text-[26px] font-black md:text-4xl">{modelTitle} · В наличии</h2><Link href={`/cars/green?${modelParams}`} className="ac-market-all-link ac-green-button shrink-0 text-sm font-black">Все →</Link></div>{rail(stockModels)}</section> : null}
    {sameModel.length ? <section data-related-section="market-model"><div className="flex items-end justify-between gap-3"><h2 className="min-w-0 text-[26px] font-black leading-none tracking-[-0.035em] md:text-4xl">Ещё {modelTitle} · {marketLabel}</h2><Link href={`/cars?${modelParams}${current.market==='japan'?'&stock='+ (greenCurrent?'auction':'all'):''}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link></div>{rail(sameModel)}</section> : null}
    {crossMarketGroups.length ? <section data-related-section="other-markets"><h2 className="text-[26px] font-black md:text-4xl">{modelTitle} на других рынках</h2><div className="space-y-8">{crossMarketGroups.filter(group=>!markets||markets.includes(group.market)).map(group=><section key={group.market}><div className="mt-5 flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-xl font-black"><CatalogMarketFlag market={group.market} className="h-5 w-7" />{CATALOG_MARKET_LABELS[group.market as keyof typeof CATALOG_MARKET_LABELS]}</h3><Link href={`/cars?${new URLSearchParams({make,model:familyModel,market:group.market,...(group.market==='japan'?{stock:'all'}:{})})}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link></div>{rail(group.items)}</section>)}</div></section> : null}
    <section data-related-section="market"><div className="mb-4 flex items-end justify-between gap-4"><h2 className="flex min-w-0 items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={String(current.market || "")} className="h-5 w-7 md:h-6 md:w-9" /><span>{marketLabel}</span><span className="text-sm text-[var(--ac-muted)] md:text-base">· {marketTotal}</span></h2><Link href={`/cars?${marketParams}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link></div>{marketRows.length?rail(marketRows):<p className="text-[var(--ac-muted)]">Другие предложения появятся после обновления каталога.</p>}</section>
  </div>;
}

function SimilarOffersFallback() {
  return <section className="mt-10 md:mt-14" aria-label="Загружаем похожие предложения"><div className="h-9 w-52 animate-pulse rounded-xl bg-white/[0.08]" /><div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="min-h-64 animate-pulse rounded-[1.35rem] bg-white/[0.045]" />)}</div></section>;
}

type BreakdownLine = { note?: string; id?: string; title: string; amountRub: number };
function customerBreakdownTitle(id: string, title: string) {
  if (id === "topavto-commission" || /комиссия\s+topavto/i.test(title)) return "Комиссия Автодилера";
  if (id === "customs") return "Таможенные платежи";
  if (id === "utilization-fee") return "Утилизационный сбор";
  return title;
}

function priceBreakdown(offer: any): BreakdownLine[] {
  const actual = Array.isArray(offer?.calculationSnapshot?.breakdown)
    ? offer.calculationSnapshot.breakdown
      .map((line: any) => {
        const id = String(line?.id || line?.title || "");
        const title = customerBreakdownTitle(id, String(line?.title || "Расход"));
        return { id, title, amountRub: Number(line?.amountRub || 0) };
      })
      .filter((line: BreakdownLine) => line.amountRub !== 0)
    : [];
  if (actual.length) {
    const customs = offer?.calculationSnapshot?.customs || {};
    const knownCustomsRub = Number(customs?.knownCustomsRub || 0);
    const utilizationFeeRub = Number(customs?.utilizationFeeRub || 0);
    const alreadySplit = actual.some((line: BreakdownLine) => line.id === "utilization-fee");
    if (!alreadySplit && knownCustomsRub > 0 && utilizationFeeRub > 0) {
      const combinedIndex = actual.findIndex((line: BreakdownLine) => line.id === "customs");
      const combined = actual[combinedIndex];
      const expectedCombined = knownCustomsRub + utilizationFeeRub;
      if (combined && Math.abs(combined.amountRub - expectedCombined) <= 2) {
        actual.splice(
          combinedIndex,
          1,
          { id: "customs", title: "Таможенные платежи", amountRub: knownCustomsRub },
          { id: "utilization-fee", title: "Утилизационный сбор", amountRub: utilizationFeeRub },
        );
      }
    }
    return customerPriceBreakdown(expandCustomsBreakdown(actual,customs), offer.calculationSnapshot?.marketConfig?.securityDepositRub);
  }
  const total = Number(offer?.totalRub || 0);
  return total ? [{ id: "total", title: "Стоимость автомобиля", amountRub: total }] : [];
}

function OfferPriceBreakdown({ offer, powerInfo }: { offer: any; powerInfo: RecyclingPowerInfo | null }) {
  const lines = priceBreakdown(offer);
  if (!lines.length) return null;
  const vehicleLine = lines.find((line) => line.id === "car")
    || lines.find((line) => /цена автомобиля|стоимость автомобиля/i.test(line.title))
    || lines[0];
  const detailLines = lines.filter((line) => line !== vehicleLine);
  return <details className="ac-offer-breakdown group min-w-0 rounded-[1.35rem] bg-[var(--ac-surface-2)]">
    <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
      <div className="flex items-center justify-between gap-3">
        <h2 className="ac-offer-block-title text-lg font-bold tracking-[-0.02em] text-[var(--ac-text)] md:text-xl">Структура цены</h2>
        <svg className="mr-1 shrink-0 transition-transform group-open:rotate-180" width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div data-price-line={vehicleLine.id} data-price-amount-rub={vehicleLine.amountRub} className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 text-[12px] font-medium md:text-[13px]">
        <span className="ac-offer-breakdown-label ac-cost-label"><span className="shrink-0">Цена автомобиля</span></span>
        <span className="ac-offer-breakdown-value ac-cost-amount">{money(vehicleLine.amountRub)} ₽</span>
      </div>
    </summary>
    {detailLines.length ? <div className="ac-offer-breakdown-lines px-4 pb-3">{detailLines.map((line, index) => <div key={`${line.id || line.title}-${index}`} data-price-line={line.id} data-price-amount-rub={line.amountRub} className="ac-cost-row gap-y-1"><span className="ac-offer-breakdown-label ac-cost-label"><span className="min-w-0 leading-snug">{line.title}</span></span><span className="ac-offer-breakdown-value ac-cost-amount">{money(line.amountRub)} ₽</span>{/utilization|утил/i.test(`${line.id} ${line.title}`) ? <div className="col-span-2"><RecyclingFeeHelp info={powerInfo} /></div> : null}</div>)}</div> : null}
  </details>;
}

async function OfferPageContent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ powerHp?: string; modificationId?: string; direct?: string; calculation?:string;estimate?:string;preview?:string;dealer?:string;edit?:string }> }) {
  const { id: routeId } = await params;
  if (parseSpecialId(offerRouteId(routeId))) return <SpecialOfferPage id={offerRouteId(routeId)} initialCity={(await searchParams)?.estimate ? decodeShareDraft((await searchParams)!.estimate!)?.deliveryCity || "" : undefined} previewRequested={(await searchParams)?.preview === "1"}/>;
  let id = offerRouteId(routeId);
  try { id = offerRouteId(decodeURIComponent(routeId)); } catch { /* Keep the route value. */ }
  const query = searchParams ? await searchParams : {};
  const dealer=await resolveDealerBrowsingContext(query.dealer||"",query.preview==="1");
  const requestedPowerHp = Number(query?.powerHp || 0);
  const safeRequestedPowerHp = Number.isFinite(requestedPowerHp) && requestedPowerHp >= 20 && requestedPowerHp <= 2500 ? Math.round(requestedPowerHp) : 0;
  // The hashed current shard is the bounded authoritative detail record: unlike
  // a search projection it contains the complete gallery, price breakdown and
  // source URL. A projection remains the fast publication-cutover fallback so a
  // live card never becomes a 404 while the immutable indexes catch up.
  // Japan must prefer the current full shard because its compact projection
  // intentionally has one card image and no calculation/source details. Other
  // markets keep the immutable detail record first because it retains exact
  // identity evidence (for example Encar's resolver-backed Lexus UX250h model)
  // which can be absent from a compact current shard.
  let storedOffer = await getOfferDetailRecord(id);
  const editorialPreview = query.edit === "1" && canEditCatalog(await getCurrentUser());
  if(!storedOffer && editorialPreview){
    const source=await getEditorialSourceOffer(id);
    if(source)storedOffer=applyCatalogEditorial(source,await readCatalogEditorial());
  }
  const sourceHybridDraft = storedOffer ? proAuctionsHybridDraft(storedOffer) : {};
  // getOfferForPage reads only immutable records that already passed the
  // publication gate. Re-validating their compact representation here can no
  // longer see source-only evidence removed from operational.raw and used to
  // turn valid Georgia cards into a soft 404.
  if (!storedOffer) return <UnavailableOffer offer={await getUnavailableOffer(id)} />;
  const canonicalPath = offerPath(storedOffer);
  if (`/cars/offer/${encodeURIComponent(routeId)}` !== canonicalPath && `/cars/offer/${routeId}` !== canonicalPath) {
    const preserved = new URLSearchParams();
    for (const [key,value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach(item=>preserved.append(key,String(item)));
      else if (value !== undefined) preserved.set(key,String(value));
    }
    permanentRedirect(canonicalPath + (preserved.size ? `?${preserved}` : ''));
  }
  const [savedCalculation,clientScenario,currentUser] = await Promise.all([getSavedOfferCalculation(storedOffer),query.calculation ? getSavedOfferCalculation(storedOffer,query.calculation) : Promise.resolve(null),getCurrentUser()]);
  const sharedScenario = query.estimate ? await sharedOfferScenario(storedOffer,query.estimate) : null;
  const directScenario = sharedScenario || (clientScenario ? {draft:clientScenario.draft,calculation:clientScenario.calculation} : (query.direct === "novokuznetsk" ? await directOfferScenario(storedOffer) : null));
  const savedByName = isCrmRole(currentUser?.role) && savedCalculation
    ? savedCalculation.savedByName || (await readCrmUsers()).find(user=>user.id===savedCalculation.savedBy)?.displayName || "Сотрудник"
    : undefined;
  const {offer,sellerPricing,selectionRequired,selectedModification,enrichedOffer,normalizedEnrichedOffer,initialPublic,pricedOffer,raw} = await resolveOfferDisplay(storedOffer,safeRequestedPowerHp,query.modificationId || '');
  const sourceUrl = enrichedOffer.market === "japan" && !isGreenCornerOffer(enrichedOffer)
    ? undefined
    : safeExternalUrl((enrichedOffer as any)?.operational?.sourceUrl);
  const presented = presentCatalogOffer(raw);
  const powerScenario = readCatalogPowerScenario(raw);
  // A user-entered horsepower value is an explicit on-page calculation scenario.
  // It never mutates the stored/catalog price, but the detail page must show the
  // resulting estimate instead of reverting to “Цена по запросу”.
  const customerScenarioRub = safeRequestedPowerHp
    && !selectionRequired
    && raw.calculationSnapshot?.customs?.status === "ready"
    && raw.calculationSnapshot?.priceIncludesAllCustoms === true
    && powerScenario?.source === "customer_input"
    && Number(raw.totalRub || 0) > 0
    && Number(raw.totalRub || 0) <= 15_000_000
      ? Math.round(Number(raw.totalRub))
      : 0;
  const modificationRub = selectedModification ? conditionalModificationRub(selectedModification) : 0;
  const visibleRub = modificationRub || customerScenarioRub || catalogOfferVisibleRub(raw);
  // Give current source/CORE knowledge and an explicit customer power scenario
  // one last chance to finish an older stored row. If that still cannot produce
  // an admitted delivered price, keep the row internal instead of rendering a
  // public "price on request" page.
  if (!directScenario && !savedCalculation && !visibleRub && !selectionRequired && !sellerPricing) return <UnavailableOffer offer={unavailableOfferRecord(offer)} calculationUnavailable />;
  const specificationGroups = await translatedSpecificationGroups(offerSpecificationGroups(offer, { bodyLabel: presented.bodyLabel }));
  const o = {
    ...presented,
    japanExportRestriction: assessJapanExportRestriction(offer),
    totalRub: visibleRub || null,
    previousTotalRub: visibleRub && !selectionRequired && !customerScenarioRub ? presented.previousTotalRub : null,
    priceDeltaRub: visibleRub && !selectionRequired && !customerScenarioRub ? presented.priceDeltaRub : null,
    // Rank before the public DTO removes the source identity and image checksums.
    images: rankedCatalogImageUrls(pricedOffer).map(url => protectedPhotoUrl(url, pricedOffer.market)),
  };
  const updatedAt = new Date(o.updatedAt);
  const updatedDate = Number.isNaN(updatedAt.getTime()) ? "" : updatedAt.toLocaleDateString("ru-RU");
  const updatedTime = Number.isNaN(updatedAt.getTime()) ? "" : updatedAt.toLocaleTimeString("ru-RU");
  const auctionAt = new Date(o.auctionDate || "");
  const auctionDateLabel = Number.isNaN(auctionAt.getTime()) ? "" : auctionAt.toLocaleDateString("ru-RU");
  const favoriteRub = directScenario?.calculation.totalRub || savedCalculation?.calculation.totalRub || catalogOfferVisibleRub(initialPublic);
  const snapshot = { sourceId: offer.sourceId, offerType: offer.offerType, fuel:offer.fuel,powertrainKind:offer.powertrainKind, catalogPricingMode: offer.catalogPricingMode, sellerPriceRub: offer.sellerPriceRub, calculationStatus: initialPublic.calculationStatus, catalogKind: offer.catalogKind, id: o.id, title: o.title, price: favoriteRub || null, totalRub: favoriteRub || null, previousTotalRub: o.previousTotalRub, priceDeltaRub: o.priceDeltaRub, priceChangedAt: o.priceChangedAt, sourcePrice: o.sourcePrice, sourceCurrency: o.sourceCurrency, calculationSnapshot: selectionRequired ? {} : initialPublic.calculationSnapshot, imageUrl: o.images[0], year: o.year, mileageKm: o.mileageKm, market: raw.market, marketLabel: o.marketLabel, auctionDate: o.auctionDate, auctionGrade: o.auctionGrade, japanExportRestriction: o.japanExportRestriction, href: offerPath(storedOffer) + (directScenario ? "?direct=novokuznetsk" : "") };
  const marketHref = isGreenCornerOffer(offer) ? "/cars/green" : `/cars?market=${encodeURIComponent(raw.market || "")}`;
  const makeHref = `/cars/brand/${catalogBrandSlug(raw.make || "")}`;
  const powerDisplay = catalogPowerDisplay(raw);
  const safePowerHp = publicCatalogPowerHp(raw);
  const preliminaryPricing = Boolean(powerScenario)
    || String(raw?.calculationStatus || "") === "preliminary_power_pending"
    || raw?.calculationSnapshot?.pricingConfidence === "preliminary";
  const powertrainKind = String(raw.powertrainKind || "").toLowerCase();
  const fuelKind = String(raw.fuel || o.fuelLabel || "").toLowerCase();
  const isElectric = powertrainKind === "electric" || ["electric", "электро", "электромобиль", "bev"].includes(fuelKind);
  const isHybrid = ["series_hybrid", "other_hybrid"].includes(powertrainKind) || /hybrid|гибрид|phev|hev/.test(fuelKind);
  const electrified = isElectric || isHybrid;
  const greenCorner = isGreenCornerOffer(offer);
  const japanAuction = String(raw.market || "").toLowerCase() === "japan" && !greenCorner;
  const powerValue = electrified
    ? o.powerKw ? `${o.powerKw} кВт` : safePowerHp ? `${safePowerHp} л.с.` : ""
    : safePowerHp ? `${safePowerHp} л.с.` : o.powerKw ? `${o.powerKw} кВт` : "";
  const mileageKm = Number(o.mileageKm || 0);
  const mileageTile = mileageKm > 0 ? { label: "Пробег", value: `${money(mileageKm)} км`, icon: "mileage" as const } : null;
  const transmissionValue = knownValue(o.transmissionLabel);
  const fuelValue = knownValue(o.fuelLabel);
  const driveLabel = driveValue(o.driveLabel);
  const bodyValue = knownValue(o.bodyLabel);
  const thirtyMinuteInfo = powerDisplay?.estimated
    ? "Для предварительной цены использована доступная расчётная мощность. Точную 30-минутную мощность менеджер подтвердит по документам автомобиля."
    : "Максимальная мощность электромотора, которую автомобиль может поддерживать в течение 30 минут. По этому значению рассчитывается утилизационный сбор.";
  const peakPowerTile = { label: "Мощность", value: powerValue || "Мощность уточняется", icon: "power" as const };
  const powerTile = powerDisplay && electrified
    ? { label: "30-минутная мощность", value: powerDisplay.thirtyMinuteLabel, icon: "thirtyMinute" as const, info: thirtyMinuteInfo }
    : null;

  const specs = (isElectric ? [
    { label: "Год", value: `${o.year} г.`, icon: "year" as const },
    mileageTile,
    { label: "Силовая установка", value: "Электромотор", icon: "electricMotor" as const },
    transmissionValue ? { label: "Коробка", value: transmissionValue, icon: "transmission" as const } : null,
    peakPowerTile,
    powerTile,
    driveLabel ? { label: "Привод", value: driveLabel, icon: "drive" as const } : null,
    bodyValue ? { label: "Кузов", value: bodyValue, icon: "body" as const } : null,
  ] : [
    { label: "Год", value: `${o.year} г.`, icon: "year" as const },
    mileageTile,
    o.engineCc ? { label: "Двигатель", value: `${money(o.engineCc)} см³`, icon: "engine" as const } : null,
    fuelValue ? { label: "Топливо", value: fuelValue, icon: "fuel" as const } : null,
    peakPowerTile,
    powerTile,
    transmissionValue ? { label: "Коробка", value: transmissionValue, icon: "transmission" as const } : null,
    driveLabel ? { label: "Привод", value: driveLabel, icon: "drive" as const } : null,
    bodyValue ? { label: "Кузов", value: bodyValue, icon: "body" as const } : null,
  ]).filter(Boolean) as SpecItem[];
  // Keep the editable power control out of the two-column spec grid entirely.
  // This prevents a tall half-width grid row on narrow phones and guarantees the
  // same full-width two-control layout on desktop and mobile.
  const nonEditableSpecs = specs.filter((spec) => selectionRequired
    ? !["Мощность", "Двигатель", "Топливо", "30-минутная мощность", "Силовая установка"].includes(spec.label)
    : spec.label !== "Мощность");
  const displayOnlySpecs = nonEditableSpecs.filter(spec=>!["Год","Двигатель","Топливо","Силовая установка","30-минутная мощность"].includes(spec.label));
  const primarySpecs = displayOnlySpecs.slice(0, 4);
  const secondarySpecs = displayOnlySpecs.slice(4);

  const auctionStatus = japanAuction ? <div data-japan-auction-status className="flex min-h-14 min-w-0 items-center justify-between gap-3 rounded-2xl bg-[var(--ac-surface-2)] px-4 py-2">
    <p className="min-w-0 text-xs font-semibold leading-5 text-[var(--ac-muted)]"><span>Продано на торгах{enrichedOffer.auctionName ? ` · ${enrichedOffer.auctionName}` : ""}</span>{" · "}<span className="whitespace-nowrap">{auctionDateLabel || updatedDate}</span>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="Открыть результат аукциона" className="ml-2">↗</a> : null}</p>
    <JapanAuctionBadges offer={o} interactive hideRestriction />
  </div> : null;

  const updatedStatus = <OfferUpdatedStatus date={updatedDate} time={updatedTime} sourceUrl={sourceUrl} />;

  return <main data-offer-id={o.id} data-offer-share-name={o.title} data-offer-share-year={directScenario?.draft.year || savedCalculation?.draft.year || offer.year} data-offer-share-engine-cc={directScenario?.draft.engineCc || savedCalculation?.draft.engineCc || offer.engineCc} data-offer-share-fuel={offer.fuel} data-offer-saved-version={clientScenario?.version} data-offer-price-rub={directScenario?.calculation.totalRub || savedCalculation?.calculation.totalRub || (sellerPricing ? offer.sellerPriceRub : visibleRub || undefined)} data-offer-preview={JSON.stringify({id:o.id,title:o.title,imageUrl:o.images[0],fuel:offer.fuel,powertrainKind:offer.powertrainKind,year:o.year,totalRub:favoriteRub || null,marketLabel:o.marketLabel})} className="ac-offer-page ac-page-copy min-h-screen overflow-x-clip bg-[#07080d] text-white">
    <PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="relative z-0 mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
      <div className="ac-offer-layout grid min-w-0 gap-3 xl:gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(390px,.75fr)] xl:items-start 2xl:grid-cols-[minmax(0,1.6fr)_480px]">
        <div className="min-w-0">
          <header className="min-w-0">
            <nav aria-label="Хлебные крошки" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-black normal-case tracking-normal text-[var(--ac-muted)] md:text-xs"><Link href={marketHref} className="transition hover:text-red-500">{o.marketLabel}</Link><span aria-hidden="true">/</span><Link href={makeHref} className="transition hover:text-red-500">{o.makeLabel}</Link>{o.modelLabel && o.modelLabel !== o.makeLabel ? <><span aria-hidden="true">/</span><span className="min-w-0 truncate">{o.modelLabel}</span></> : null}</nav>
            <div className="relative mt-2 min-w-0"><h1 className="min-w-0 break-words text-3xl font-black leading-[1.02] tracking-[-0.04em] md:text-5xl">{o.title}</h1></div>
          </header>
          <div className="mt-5 min-w-0 overflow-hidden"><VehicleGallery editor={canEditCatalog(currentUser)?<CatalogEditorialEditor offerId={o.id} originalTitle={o.title} sourcePhotos={rankedCatalogImageUrls(await getOfferFromCurrentShard(o.id))} initial={(await readCatalogEditorial()).entries[o.id]||null}/>:undefined} images={o.images} title={o.title} offerId={o.id} snapshot={snapshot} auctionSheetUrls={catalogAuctionSheetUrls(storedOffer)} /></div>
          <OfferSpecificationsDisclosure groups={specificationGroups} title={o.title} mode="desktop" sourceUrl={sourceUrl} headerAside={auctionStatus || updatedStatus} />
          <OfferDesktopActions position="below" offerId={o.id} snapshot={snapshot} />
          {!selectionRequired && !sellerPricing ? <OfferCreditCalculator /> : null}
          <OfferFinanceCards />
        </div>

        <StickyOfferColumn>
          {auctionStatus ? <div className="mb-3 xl:hidden">{auctionStatus}</div> : null}
          <div id="offer-parameters" className="scroll-mt-24"/>
          <InlineOfferParameters initialCurrencyRate={raw.calculationSnapshot?.currencyRate} localCitySelection={Boolean(currentUser)} initialScenario={directScenario} copyOffer={canCopyOffer(currentUser) ? {title:o.title,mileageKm:o.mileageKm} : undefined} priceIdentity={{id:offer.id,sourceId:offer.sourceId,offerType:offer.offerType,market:offer.market,auctionGrade:offer.auctionGrade}} afterPrice={<OfferMobileActions offerId={o.id} snapshot={snapshot} />} originalBreakdown={!selectionRequired && visibleRub > 0 ? <div className="ac-original-calculation mt-4"><OfferPriceBreakdown offer={o} powerInfo={recyclingPowerInfo(raw)} /></div> : null} canSave={isCrmRole(currentUser?.role)} savedCalculation={savedCalculation ? {version:savedCalculation.version,draft:savedCalculation.draft,calculation:savedCalculation.calculation,savedAt:isCrmRole(currentUser?.role) ? savedCalculation.savedAt : undefined,savedByName} : null} deliveryMarket={offer.market} exportWarning={japanRestrictionDescription(o.japanExportRestriction)} sourcePriceOnly={sellerPricing || (selectionRequired && !selectedModification)} autoCalculate={sellerPricing || (selectionRequired && !selectedModification)} isPickup={commercialParameters(offer).isPickup} researchContext={[offer.make,offer.model,offer.trim,offer.market].filter(Boolean).join(" ")} showCommercial={commercialParameters(offer).showCommercial} key={offer.id} offerId={offer.id} reportedVolume={proAuctionsReportedVolume(offer)} initial={offerParameterDraft(offer,raw)} price={sellerPricing ? <SellerPrice hideJapanBadges offer={{...offer, japanExportRestriction:o.japanExportRestriction}} /> : selectionRequired
            ? <div className="ac-offer-price-panel rounded-[1.35rem] bg-[var(--ac-surface-2)] p-5"><p className="text-xs font-bold normal-case">Цена продавца</p><p className={`ac-price mt-2 text-3xl font-black ${electrified ? "ac-price--electrified" : ""}`}>{Number(offer.sourcePrice).toLocaleString("ru-RU")} {offer.sourceCurrency}</p><p className="mt-2 text-xs text-[var(--ac-muted)]">Без доставки и платежей. Уточните параметры ниже для расчёта.</p></div>
            : japanAuction
            ? <AuctionResultPrice offer={{...o,auctionGrade:undefined,japanExportRestriction:undefined}} label="Завершённый аукцион" priceClassName="text-3xl md:text-4xl" className="ac-offer-price-panel" panel />
            : preliminaryPricing
            ? <PreliminaryPrice offer={o} label="Предварительно от" priceClassName="text-3xl md:text-4xl" className="ac-offer-price-panel" panel highlightElectrified={electrified} />
            : <PriceTrend hideAuctionGrade offer={o} label="Ориентир без доставки" priceClassName="text-3xl md:text-4xl" className="ac-offer-price-panel" panel highlightElectrified={electrified} />}>
          {!japanAuction && o.priceMode === "auction_start" ? <p className="mt-2 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold text-amber-200">Расчёт сделан от стартовой цены. Финальная стоимость аукциона может измениться.</p> : null}
          <aside className="ac-offer-detail-stack mt-4 min-w-0">
            <div className="ac-offer-spec-stack min-w-0 space-y-2.5">
              <div className="ac-offer-spec-grid grid min-w-0 grid-cols-2 gap-2.5" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridAutoFlow: "row" }}>{primarySpecs.map((spec, index) => <SpecTile key={spec.label} {...spec} fullWidth={primarySpecs.length % 2 === 1 && index === primarySpecs.length - 1} />)}</div>
              {secondarySpecs.length ? <div className="ac-offer-spec-grid grid min-w-0 grid-cols-2 gap-2.5" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridAutoFlow: "row" }}>{secondarySpecs.map((spec, index) => <SpecTile key={spec.label} {...spec} fullWidth={secondarySpecs.length % 2 === 1 && index === secondarySpecs.length - 1} />)}</div> : null}
              <VehicleResearchLink offerId={offer.id} identity={{ make: offer.make, model: offer.model, year: offer.year, trim: offer.trim, market: offer.market, powertrainKind: offer.powertrainKind, chassisCode: typeof offer.operational?.chassisCode === "string" ? offer.operational.chassisCode : typeof offer.operational?.modelCode === "string" ? offer.operational.modelCode : undefined }} />
              <OfferSpecificationsDisclosure groups={specificationGroups} title={o.title} mode="mobile" sourceUrl={sourceUrl} />
            </div>

            {!japanAuction ? <div className="mt-3 xl:hidden">{updatedStatus}</div> : null}
            <OfferDesktopActions offerId={o.id} snapshot={snapshot} />
          </aside>
          </InlineOfferParameters>
        </StickyOfferColumn>
      </div>


      <Suspense fallback={<SimilarOffersFallback />}><SimilarOffers markets={dealer?.markets} current={{...raw,sourceId:offer.sourceId,offerType:offer.offerType}} /></Suspense>
      <PageLeadBanner kind="offer" />
    </section>
    <OfferContactActionsStyles />
    <style dangerouslySetInnerHTML={{ __html: `
      html:not([data-theme="light"]) .ac-offer-page .ac-offer-spec-tile{background:#11141c!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-spec-tile{background:#d9e0e9!important}
      html[data-theme="light"] .ac-offer-page [data-japan-auction-status]{background:#fff!important;border:1px solid var(--ac-border)}
      html body .ac-offer-page .ac-offer-detail-stack>.ac-offer-spec-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;grid-auto-flow:row!important}
      html body .ac-offer-page .ac-offer-detail-stack>.ac-offer-spec-grid>.ac-offer-spec-tile:last-child:nth-child(odd){grid-column:1/-1!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-breakdown,
      html[data-theme="light"] .ac-offer-page .ac-offer-status,
      html[data-theme="light"] .ac-offer-page .ac-offer-form{background:#f8f9fb!important;border:1px solid rgba(30,36,48,.10)!important;box-shadow:0 14px 34px rgba(38,43,57,.10)!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-price-panel{background:#fff!important;background-color:#fff!important;border:1px solid rgba(30,36,48,.10)!important;box-shadow:0 14px 34px rgba(38,43,57,.12)!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-form .soft-input{background:#e3e7ed!important;border:1px solid #c7ced9!important;color:#171b24!important;box-shadow:none!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-form .soft-input::placeholder{color:#737d8e!important;opacity:1!important}
      html[data-theme="light"] .ac-offer-page .ac-preliminary-notice{background:#fff2cc!important;border-color:#e9c56b!important;color:#704500!important;box-shadow:0 8px 24px rgba(111,75,0,.08)!important}
      html[data-theme="light"] .ac-offer-page .ac-spec-info-popover{background:#fff!important;border-color:rgba(30,36,48,.14)!important;color:#394150!important}
      html:not([data-theme="light"]) .ac-offer-page .ac-offer-price-panel.is-down{background:#0b3021!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-price-panel.is-down{background:#cfe5d8!important}
      @media (max-width:639px){.ac-offer-page .ac-public-header{z-index:1000!important;isolation:isolate!important;background:var(--ac-surface)!important}.ac-offer-page .ac-price-trend-arrow{z-index:0!important}.ac-offer-page .ac-price-trend-popover{z-index:40!important}.ac-offer-page button[aria-label="Открыть фотографии автомобиля"]{height:auto!important;aspect-ratio:4/3!important}.ac-offer-page .ac-vehicle-thumbnails{margin-top:10px!important}.ac-offer-page .ac-offer-spec-tile:nth-child(odd) .ac-spec-info-popover{left:0!important;right:auto!important}.ac-offer-page .ac-offer-spec-tile:nth-child(even) .ac-spec-info-popover{left:auto!important;right:0!important}}
    ` }} />
  </main>;
}

export default async function OfferPage(props:Parameters<typeof OfferPageContent>[0]) {
 const query=await props.searchParams;
 const dealer=await resolveDealerBrowsingContext(query?.dealer||'',query?.preview==='1');
 return <DealerBrowsingProvider dealer={dealer}><OfferPageContent {...props}/></DealerBrowsingProvider>;
}
