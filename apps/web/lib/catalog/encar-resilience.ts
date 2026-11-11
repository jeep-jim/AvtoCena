import { catalogSources, extractEncarImageUrls } from "./adapters";
import { cacheImageFromUrl } from "./storage";
import type { CatalogImage, VehicleOffer } from "./types";

const ENCAR_IMAGE_HEADERS = {
  accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  referer: "https://m.encar.com/",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

const encar = catalogSources.find((source) => source.sourceId === "encar_direct") as any;

if (encar && !encar.__avtocenaResilienceInstalled) {
  const originalFetchImages = encar.fetchImages.bind(encar);
  encar.fetchImages = async (offer: VehicleOffer): Promise<CatalogImage[]> => {
    try {
      return await originalFetchImages(offer);
    } catch (error: any) {
      const message = String(error?.message || error || "");
      const missingDetail = /(?:non_json_response|http_)\s*status=404|non_json_response status=404|http_404/i.test(message);
      if (!missingDetail) throw error;

      const limit = Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 3));
      const saved: CatalogImage[] = [];
      for (const url of extractEncarImageUrls(offer).slice(0, limit)) {
        const image = await cacheImageFromUrl(url, "korea", { headers: ENCAR_IMAGE_HEADERS }).catch(() => null);
        if (image) saved.push(image);
      }
      return saved;
    }
  };
  encar.__avtocenaResilienceInstalled = true;
}
