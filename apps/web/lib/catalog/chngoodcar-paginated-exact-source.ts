import type { CatalogFetchResult, VehicleOffer } from "./types";
import {
  ChnGoodCarExactAdapter,
  parseGoodCarDetailHtml,
  type GoodCarExactRawOffer,
} from "./chngoodcar-exact-source";
import {
  GOOD_CAR_CARSLIST_PAGE_SIZE,
  GoodCarCarsListClient,
  type GoodCarCarsListIdentityRow,
} from "./chngoodcar-carslist";
import { namedElectrifiedPowertrainKind } from "./powertrain-safety";

const BASE_URL = "https://www.chngoodcar.com";
const USER_AGENT = "AvtoCenaGoodCarPaginatedExact/1.1 (+read-only until source promotion)";
const HEADERS = {
  accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": USER_AGENT,
};

export type GoodCarPaginatedExactRawOffer = GoodCarExactRawOffer & {
  listCurrencyVerified: boolean;
  listProductionDate: string;
  listMileageKm: number;
  listDetailProductionDateParity: boolean;
  listDetailMileageParity: boolean;
  listFuelName?: string;
  listVehicleTypeName?: string;
  listGearboxName?: string;
  listDrivingName?: string;
  listImageUrl?: string;
  discoverySource: "CarsList/SearchCarList";
};

function normalizeIdentity(value: unknown) {
  return String(value ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/[\s_]+/g, " ").trim().toLowerCase();
}

function sameNumber(a: unknown, b: unknown) {
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-9;
}

async function fetchDetail(url: string) {
  const response = await fetch(url, {
    headers: { ...HEADERS, referer: `${BASE_URL}/Home/CarsList` },
    redirect: "follow",
    signal: AbortSignal.timeout(Math.max(8_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000))),
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`chngoodcar_detail_http_${response.status}:${url}`);
  return { response, html };
}

export function goodCarIdentityNamedElectrifiedKind(sourceTitle: unknown) {
  return namedElectrifiedPowertrainKind({ sourceTitle: String(sourceTitle || "") });
}

export function joinGoodCarCarsListAndDetail(
  list: GoodCarCarsListIdentityRow,
  detail: ReturnType<typeof parseGoodCarDetailHtml>,
  currencyLabelVerified: boolean,
): GoodCarPaginatedExactRawOffer | null {
  if (!detail || detail.sourceOfferId !== list.sourceOfferId) return null;
  const listDetailTitleParity = normalizeIdentity(list.sourceTitle) === normalizeIdentity(detail.sourceTitle);
  const listDetailPriceParity = sameNumber(list.listPrice, detail.sourcePrice);
  const listDetailProductionDateParity = list.listProductionDate === detail.productionDate;
  const listDetailMileageParity = sameNumber(list.listMileageKm, detail.mileageKm);
  return {
    ...detail,
    listTitle: list.sourceTitle,
    listPrice: list.listPrice,
    currency: "USD",
    currencyLabelVerified,
    listCurrencyVerified: list.listCurrency === "USD",
    listDetailPriceParity,
    listDetailTitleParity,
    listProductionDate: list.listProductionDate,
    listMileageKm: list.listMileageKm,
    listDetailProductionDateParity,
    listDetailMileageParity,
    listFuelName: list.listFuelName,
    listVehicleTypeName: list.listVehicleTypeName,
    listGearboxName: list.listGearboxName,
    listDrivingName: list.listDrivingName,
    listImageUrl: list.listImageUrl,
    discoverySource: "CarsList/SearchCarList",
  };
}

export class ChnGoodCarPaginatedExactAdapter extends ChnGoodCarExactAdapter {
  private readonly carsList = new GoodCarCarsListClient();

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Math.trunc(Number(cursor || 1) || 1));
    const list = await this.carsList.fetchPage(page);
    const items: GoodCarPaginatedExactRawOffer[] = [];
    let detailFetchErrors = 0;
    let detailUnparsed = 0;

    for (const row of list.items) {
      try {
        const detail = await fetchDetail(row.detailUrl);
        const parsed = parseGoodCarDetailHtml(detail.html, detail.response.url || row.detailUrl);
        const joined = joinGoodCarCarsListAndDetail(row, parsed, list.currencyLabelVerified);
        if (!joined) {
          detailUnparsed += 1;
          continue;
        }
        items.push(joined);
      } catch {
        detailFetchErrors += 1;
      }
    }

    const finished = list.rawRowCount === 0 || page * GOOD_CAR_CARSLIST_PAGE_SIZE >= list.total;
    return {
      items,
      nextCursor: finished ? null : String(page + 1),
      finished,
      count: list.total,
      health: {
        ok: list.rawRowCount > 0 && detailFetchErrors === 0,
        message: `Good Car CarsList exact:page_${page}:raw_${list.rawRowCount}:identity_${list.items.length}:identityRejected_${list.rejectedIdentityRowCount}:detail_${items.length}:unparsed_${detailUnparsed}:errors_${detailFetchErrors}:total_${list.total}`,
        checkedAt: new Date().toISOString(),
        httpStatus: 200,
        contentType: "application/json",
      },
    };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as GoodCarPaginatedExactRawOffer;
    if (row?.discoverySource !== "CarsList/SearchCarList") return null;
    if (row.listCurrencyVerified !== true || row.listDetailProductionDateParity !== true || row.listDetailMileageParity !== true) return null;
    // Identity-bound electrified markers have priority over a contradictory
    // source fuel label. Example proven in Good Car: `双擎` in the exact title
    // while the same detail labels `燃料种类 汽油`. Such a row is internally
    // contradictory and must not be promoted as combustion.
    if (goodCarIdentityNamedElectrifiedKind(row.sourceTitle)) return null;
    const offer = super.normalizeOffer(row);
    if (!offer) return null;
    offer.operational = {
      ...(offer.operational || {}),
      exactScope: "ICE_passenger_only_CarsList_paginated_no_publish_v2",
      carsListPaginationVerified: true,
      carsListPageSize: GOOD_CAR_CARSLIST_PAGE_SIZE,
      semanticEvidence: {
        ...(offer.operational?.semanticEvidence as Record<string, unknown> || {}),
        priceCurrency: "CarsList visible 价格(US $) + SearchCarList row Currency=usd + exact list/detail price parity",
        identity: "SearchCarList Id/title joined to same /Home/Cars?id=<Id> detail title",
        productionDate: "exact SearchCarList ProductionDate == offer-bound detail 出厂年份",
        mileageKm: "exact SearchCarList Mileage == offer-bound detail 里程 (km)",
        powertrainIdentity: "identity-bound title electrified markers override contradictory combustion detail labels and fail closed",
        listFieldBoundary: "SearchCarList fuel/body/power fields are discovery evidence only and never replace offer-bound detail exact fields",
      },
    };
    return offer;
  }
}

export const chngoodcarChinaPaginatedExactSource = new ChnGoodCarPaginatedExactAdapter();
