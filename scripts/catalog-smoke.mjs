const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v = "true"] = a.slice(2).split("="); return [k, v]; }));
const source = args.source || "encar_direct"; const limit = Number(args.limit || 20); const started = Date.now();
const headers = { "user-agent": "AvtoCenaCatalog/1.0", referer: "https://m.encar.com/" };
async function fetchText(url) { const res = await fetch(url, { headers }); const text = await res.text(); return { res, text }; }
function countBeForward(html) { return { records: (html.match(/BF\d+/gi) || []).length, normalized: (html.match(/Ref\.?\s*No|BF\d+/gi) || []).length, images: (html.match(/<img\b/gi) || []).length, priceFound: /US\$|FOB|Vehicle Price|Price/i.test(html), locationFound: /Location|Japan|Korea|UAE|Dubai|Yokohama|Busan/i.test(html) }; }
try {
  if (source === "encar_direct") {
    const variants = ["https://api.encar.com/search/car/list/mobile?count=" + limit, "https://api.encar.com/search/car/list/premium?count=" + limit];
    let best = null;
    for (const url of variants) { try { const { res, text } = await fetchText(url); const json = JSON.parse(text); const rows = json.SearchResults || json.cars || json.items || []; if (!best || rows.length > best.records) best = { url, status: res.status, contentType: res.headers.get("content-type") || "", records: rows.length, count: json.Count || json.count || null, first: rows[0] || null }; } catch (e) { if (!best) best = { url, error: e.message, records: 0 }; } }
    const first = best?.first || {}; const id = first.Id || first.CarId || first.carId; let detailStatus = null, detailOk = false, imageUrls = 0; if (id) { try { const d = await fetch("https://api.encar.com/v1/readside/vehicle/" + id, { headers }); detailStatus = d.status; const txt = await d.text(); detailOk = d.ok && /json/i.test(d.headers.get("content-type") || ""); imageUrls = (txt.match(/https?:[^"']+\.(?:jpg|jpeg|png|webp)|\/[^"']+\.(?:jpg|jpeg|png|webp)/gi) || []).length; } catch (e) { detailStatus = e.message; } }
    console.log(JSON.stringify({ source, dryRun: true, ...best, normalized: best?.first ? 1 : 0, detailStatus, detailOk, imageUrls, krwPriceRecognized: Boolean(first.Price), responseMs: Date.now() - started }, null, 2)); process.exit(best?.records > 0 ? 0 : 1);
  }
  if (source === "che168_global") {
    const brandUrl = "https://globalapi.che168.com/api/v1/brand?_appid=global.pc&deviceid=avtocena-smoke"; const brand = await fetchText(brandUrl); let brandIds = []; try { const j = JSON.parse(brand.text); const list = j.result?.brandlist || j.result || j.data || []; brandIds = (Array.isArray(list) ? list : Object.values(list).flat()).map((b) => b.id || b.brandid || b.brandId).filter(Boolean).slice(0, 3); } catch {}
    const brandid = brandIds[0] || "1"; const url = `https://globalapi.che168.com/api/v1/search?_appid=global.pc&deviceid=avtocena-smoke&language=en&pageindex=1&pagesize=${limit}&sort=0&vehicle_list=0&brandid=${brandid}`; const { res, text } = await fetchText(url); let rows = []; try { const j = JSON.parse(text); rows = j.result?.carlist || j.result?.list || j.data?.carlist || j.data?.list || []; } catch {}
    console.log(JSON.stringify({ source, dryRun: true, status: res.status, contentType: res.headers.get("content-type") || "", brands: brandIds.length, records: rows.length, normalized: rows.filter((r) => r.infoid && r.brandname).length, responseMs: Date.now() - started }, null, 2)); process.exit(rows.length > 0 ? 0 : 1);
  }
  const { res, text } = await fetchText("https://www.beforward.jp/stocklist?page=1"); const parsed = countBeForward(text);
  console.log(JSON.stringify({ source, dryRun: true, status: res.status, contentType: res.headers.get("content-type") || "", ...parsed, responseMs: Date.now() - started }, null, 2)); process.exit(res.ok && parsed.records > 0 ? 0 : 1);
} catch (error) { console.log(JSON.stringify({ source, dryRun: true, error: error?.message || String(error), responseMs: Date.now() - started }, null, 2)); process.exit(1); }
