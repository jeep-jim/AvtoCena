const id = process.env.ENCAR_DIAG_ID || "42508437";
const base = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://fem.encar.com",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};
const cases = [
  ["root", "https://fem.encar.com/"],
  ["detail", `https://fem.encar.com/cars/detail/${id}`],
  ["no-referer", ""],
];
for (const [label, referer] of cases) {
  const headers = {...base};
  if (referer) headers.referer = referer;
  const started = Date.now();
  try {
    const response = await fetch(`https://api.encar.com/v1/readside/vehicle/${id}`, {headers});
    const body = await response.text();
    console.log(JSON.stringify({label, referer:referer||null, status:response.status, ok:response.ok, bytes:body.length, elapsedMs:Date.now()-started, head:body.slice(0,220).replace(/\s+/g," ")}));
  } catch (error) {
    console.log(JSON.stringify({label, referer:referer||null, error:String(error?.message||error), cause:String(error?.cause?.message||error?.cause||"")}));
  }
}
