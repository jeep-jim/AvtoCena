import { rankedCatalogImageUrls } from "./image-quality";
import { catalogOfferVisibleRub } from "./public-priority";
import type { VehicleOffer } from "./types";

export type PublicOfferDuplicate = {
  keptId: string;
  removedId: string;
  market: string;
  sourceId: string;
  coverIdentity: string;
};

export type PublicOfferDeduplicationResult<T extends VehicleOffer> = {
  rows: T[];
  removed: PublicOfferDuplicate[];
};

export type PublicOfferDeduplicationOptions = {
  protectedIds?: ReadonlySet<string>;
};

function clean(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function canonicalImageIdentity(value: unknown) {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    const url = new URL(source, "https://catalog.local");
    url.hash = "";
    url.search = "";
    return `${url.hostname.toLowerCase()}${decodeURIComponent(url.pathname).replace(/\/{2,}/g, "/")}`.toLocaleLowerCase("en-US");
  } catch {
    return source.replace(/[?#].*$/, "").replace(/\/{2,}/g, "/").toLocaleLowerCase("en-US");
  }
}

function coverIdentity(offer: VehicleOffer) {
  const ranked = rankedCatalogImageUrls(offer)[0];
  if (ranked) return canonicalImageIdentity(ranked);
  const first = offer.images?.[0];
  return canonicalImageIdentity(first?.url || first?.objectKey);
}

function duplicateKey(offer: VehicleOffer) {
  const cover = coverIdentity(offer);
  if (!cover) return "";
  return [
    clean(offer.market),
    clean(offer.sourceId),
    clean(offer.make),
    clean(offer.model),
    clean(offer.trim),
    finite(offer.year),
    finite(offer.mileageKm),
    finite(offer.engineCc),
    finite(offer.sourcePrice),
    clean(offer.sourceCurrency),
    catalogOfferVisibleRub(offer),
    cover,
  ].join("\u0000");
}

function sourcePhotoMatchesOfferId(offer: VehicleOffer) {
  const sourceOfferId = String(offer.sourceOfferId || "").trim();
  if (!/^\d{6,}$/.test(sourceOfferId)) return false;
  const evidence = [
    ...rankedCatalogImageUrls(offer).slice(0, 3),
    ...(offer.images || []).slice(0, 3).flatMap((image) => [image.url, image.objectKey]),
    JSON.stringify(offer.operational?.raw || {}).slice(0, 80_000),
  ].join(" ");
  return new RegExp(`(?:^|[^0-9])${sourceOfferId}(?:[_./-]|[^0-9]|$)`).test(evidence);
}

function preferredOffer<T extends VehicleOffer>(left: T, right: T) {
  const leftMatches = sourcePhotoMatchesOfferId(left);
  const rightMatches = sourcePhotoMatchesOfferId(right);
  if (leftMatches !== rightMatches) return rightMatches ? right : left;

  const leftVerified = Number(left.operational?.photoIdentityVerified === true || left.operational?.galleryVerified === true);
  const rightVerified = Number(right.operational?.photoIdentityVerified === true || right.operational?.galleryVerified === true);
  if (leftVerified !== rightVerified) return rightVerified > leftVerified ? right : left;

  const leftImages = rankedCatalogImageUrls(left).length;
  const rightImages = rankedCatalogImageUrls(right).length;
  if (leftImages !== rightImages) return rightImages > leftImages ? right : left;

  const leftUpdated = Date.parse(String(left.updatedAt || "")) || 0;
  const rightUpdated = Date.parse(String(right.updatedAt || "")) || 0;
  if (leftUpdated !== rightUpdated) return rightUpdated > leftUpdated ? right : left;
  return String(right.id).localeCompare(String(left.id), "en") < 0 ? right : left;
}

/**
 * Removes only exact public-card duplicates. Different source rows are kept
 * unless their cover photo and every visible commercial identity field match.
 * This catches Encar rows where a new listing id accidentally carries another
 * listing's complete gallery without collapsing legitimate similar vehicles.
 */
export function deduplicatePublicCatalogOffers<T extends VehicleOffer>(offers: T[], options: PublicOfferDeduplicationOptions = {}): PublicOfferDeduplicationResult<T> {
  const groups = new Map<string, T[]>();
  const unique: T[] = [];
  for (const offer of offers) {
    const key = duplicateKey(offer);
    if (!key) unique.push(offer);
    else groups.set(key, [...(groups.get(key) || []), offer]);
  }

  const keptIds = new Set(unique.map((offer) => offer.id));
  const removed: PublicOfferDuplicate[] = [];
  for (const rows of groups.values()) {
    let winner = rows[0];
    for (const row of rows.slice(1)) {
      const winnerProtected = options.protectedIds?.has(String(winner.id)) === true;
      const rowProtected = options.protectedIds?.has(String(row.id)) === true;
      winner = winnerProtected !== rowProtected ? (winnerProtected ? winner : row) : preferredOffer(winner, row);
    }
    keptIds.add(winner.id);
    const cover = coverIdentity(winner);
    for (const row of rows) {
      if (row.id === winner.id) continue;
      removed.push({
        keptId: winner.id,
        removedId: row.id,
        market: String(row.market || ""),
        sourceId: String(row.sourceId || ""),
        coverIdentity: cover,
      });
    }
  }

  return { rows: offers.filter((offer) => keptIds.has(offer.id)), removed };
}
