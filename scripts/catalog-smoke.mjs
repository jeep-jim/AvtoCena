const source = (process.argv.find((a) => a.startsWith("--source=")) || "--source=encar_direct").split("=")[1];
const urls = {
  encar_direct: "https://api.encar.com/search/car/list/mobile?count=1&sr=0",
  beforward_public: "https://www.beforward.jp/stocklist?page=1",
  che168_global: "https://globalapi.che168.com/api/v1/search?_appid=global.pc&deviceid=avtocena-smoke&language=en&pageindex=1&pagesize=1&sort=0&vehicle_list=0"
};
const url = urls[source]; if (!url) { console.error(`Unknown source: ${source}`); process.exit(2); }
const started = Date.now();
const res = await fetch(url, { headers: { "user-agent": "AvtoCenaCatalog/1.0", referer: "https://m.encar.com/" } });
const contentType = res.headers.get("content-type") || ""; const text = await res.text(); let count = 0;
try { const json = JSON.parse(text); const list = json.SearchResults || json.result?.list || json.data?.list || json.list || json.items || []; count = Array.isArray(list) ? list.length : 0; } catch { count = (text.match(/Ref\.?\s*No|BF\d+/g) || []).length; }
console.log(JSON.stringify({ source, dryRun: true, status: res.status, contentType, records: count, responseMs: Date.now() - started }, null, 2));
