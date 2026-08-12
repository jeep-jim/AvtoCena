from pathlib import Path
p=Path('scripts/catalog-live-recovery-market.mjs')
s=p.read_text()
# Remove the old AUTO.GE-only detail enrichment implementation entirely.
start=s.find('const AUTO_GEORGIA_DETAIL_HEADERS = {')
end=s.find('function thirtyMinutePower(offer)', start)
if start < 0 or end < 0: raise SystemExit('AUTO.GE detail block not found')
s=s[:start]+s[end:]
# Remove the old special end-of-source exception.
s=s.replace('''      if (source.sourceId === "auto_georgia_open" && pages > 0 && /auto_georgia_strict_parsed_zero_200_\\d+/i.test(pageError)) {\n        finished = true;\n        stopReason = "source_exhausted";\n        break;\n      }\n''','')
# Replace AUTO.GE listing shortcut with the normal exact source fetch flow.
old='''      const trustedListingImages = source.sourceId === "auto_georgia_open" && process.env.CATALOG_IMAGE_STORAGE_MODE === "source_urls_only"\n        ? listingBoundSourceImages(offer)\n        : [];\n      if (trustedListingImages.length) {\n        offer.images = credibleCatalogImages(trustedListingImages).slice(0, 30);\n        offer.operational = {\n          ...(offer.operational || {}),\n          galleryVerified: offer.images.length > 0,\n          galleryImageCount: offer.images.length,\n          gallerySafetyMode: "auto_georgia_listing_bound_source_urls",\n          galleryStoredAs: "json_urls",\n        };\n      } else {\n        try {\n          const fetched = typeof source.fetchImages === "function" ? await retry(`${source.sourceId}_images`, () => source.fetchImages(offer)) : [];\n          const combined = credibleCatalogImages([...(offer.images || []), ...(Array.isArray(fetched) ? fetched : [])]);\n          offer.images = combined.slice(0, 30);\n        } catch (error) {\n          errors.push({ stage: "images", sourceOfferId: offer.sourceOfferId, error: errorText(error).slice(0, 500) });\n          offer.images = credibleCatalogImages(offer.images || []).slice(0, 30);\n        }\n      }\n'''
new='''      try {\n        const fetched = typeof source.fetchImages === "function" ? await retry(`${source.sourceId}_images`, () => source.fetchImages(offer)) : [];\n        const combined = credibleCatalogImages([...(offer.images || []), ...(Array.isArray(fetched) ? fetched : [])]);\n        offer.images = combined.slice(0, 30);\n      } catch (error) {\n        errors.push({ stage: "images", sourceOfferId: offer.sourceOfferId, error: errorText(error).slice(0, 500) });\n        offer.images = credibleCatalogImages(offer.images || []).slice(0, 30);\n      }\n'''
if old not in s: raise SystemExit('AUTO.GE image shortcut block not found')
s=s.replace(old,new,1)
old2='''      if (source.sourceId === "auto_georgia_open" && (!(Number(offer.engineCc || 0) > 0) || !(Number(offer.powerHp || 0) > 0))) {\n        try { offer = normalizeVehicleOfferSpecs(await retry(`${source.sourceId}_detail_specs`, () => enrichAutoGeorgiaExactSpecs(offer))); }\n        catch (error) { errors.push({ stage: "detail_specs", sourceOfferId: offer.sourceOfferId, error: errorText(error).slice(0, 500) }); }\n      }\n'''
if old2 not in s: raise SystemExit('AUTO.GE detail specs caller not found')
s=s.replace(old2,'',1)
p.write_text(s)
