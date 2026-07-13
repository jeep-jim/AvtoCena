import { readDataJson } from "../../data";
import { BrowserRenderedAdapter, HtmlCatalogAdapter, JsonApiAdapter, ManualFileAdapter, PartnerFeedAdapter, type SourceAdapter, type SourceConfig } from "./types";

export const sourceRegistry = readDataJson<SourceConfig[]>("catalog/sources/sources.json", []);

export function createSourceAdapter(config: SourceConfig): SourceAdapter {
  if (config.mode === "official_api" || config.mode === "public_json") return new JsonApiAdapter(config);
  if (config.mode === "public_html") return new HtmlCatalogAdapter(config);
  if (config.mode === "browser_rendered") return new BrowserRenderedAdapter(config);
  if (config.mode === "partner_feed" || config.status === "requires_agreement") return new PartnerFeedAdapter(config);
  return new ManualFileAdapter(config);
}

export function getSourceAdapters(): SourceAdapter[] {
  return sourceRegistry.map(createSourceAdapter);
}
