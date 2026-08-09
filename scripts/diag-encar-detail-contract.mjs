const id = process.env.ENCAR_DIAG_ID || "42508437";
const urls = [
  `https://car.encar.com/cars/detail/${encodeURIComponent(id)}`,
  `https://fem.encar.com/cars/detail/${encodeURIComponent(id)}`,
  `https://www.encar.com/dc/dc_cardetailview.do?method=ajaxInspectView&carid=${encodeURIComponent(id)}`,
];
const headers = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};
function uniq(values) { return [...new Set(values.filter(Boolean))]; }
for (const url of urls) {
  const started = Date.now();
  try {
    const response = await fetch(url, { headers, redirect: "follow" });
    const body = await response.text();
    const scripts = uniq([...body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1])).slice(0, 30);
    const apiStrings = uniq([...body.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+|\/(?:v\d+\/)?(?:readside|cars?|vehicles?|search)[^"'<>\\\s]{0,160}/gi)].map((m) => m[0].replace(/\\\//g, "/"))).slice(0, 100);
    console.log(JSON.stringify({event:"page_probe", url, status:response.status, ok:response.ok, finalUrl:response.url, contentType:response.headers.get("content-type"), bytes:body.length, elapsedMs:Date.now()-started, scripts, apiStrings, head:body.slice(0,800).replace(/\s+/g," ")}));
    for (const src of scripts.slice(0, 12)) {
      let jsUrl = src;
      try { jsUrl = new URL(src, response.url).toString(); } catch {}
      try {
        const jsResponse = await fetch(jsUrl, {headers:{...headers, accept:"*/*"}, redirect:"follow"});
        const js = await jsResponse.text();
        const hits = uniq([
          ...[...js.matchAll(/https?:\\?\/\\?\/api\.encar\.com[^"'`\\\s]+/gi)].map((m)=>m[0].replace(/\\\//g,"/")),
          ...[...js.matchAll(/\/(?:v\d+\/)?(?:readside|vehicle|vehicles|cars|car)[A-Za-z0-9_?=&{}.$/:-]{1,180}/g)].map((m)=>m[0]),
        ]).filter((value)=>/vehicle|car|readside|api\.encar/i.test(value)).slice(0,100);
        if (hits.length) console.log(JSON.stringify({event:"script_hits", jsUrl, status:jsResponse.status, bytes:js.length, hits}));
      } catch (error) {
        console.log(JSON.stringify({event:"script_error", jsUrl, message:String(error?.message || error)}));
      }
    }
  } catch (error) {
    console.log(JSON.stringify({event:"page_error", url, elapsedMs:Date.now()-started, name:error?.name||null, message:String(error?.message||error), cause:String(error?.cause?.message||error?.cause||"")}));
  }
}
