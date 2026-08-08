import crypto from 'node:crypto';

const API_BASE = 'https://api.kcar.com';
const WEB_BASE = 'https://www.kcar.com';
const KEY = Buffer.from('SKFJ2424DasfaJRI', 'utf8');
const IV = Buffer.from('sfq241sf3dscs321', 'utf8');
const headers = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
  origin: WEB_BASE,
  referer: `${WEB_BASE}/bc/search`,
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};

function encryptedBody(value) {
  const filtered = Object.fromEntries(Object.entries(value).filter(([, item]) => Boolean(item)));
  const cipher = crypto.createCipheriv('aes-128-cbc', KEY, IV);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(filtered), 'utf8'), cipher.final()]).toString('base64');
  return JSON.stringify({ enc: encrypted });
}

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) }, redirect: 'follow' });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { response, text, json };
}

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function galleryCount(data, carCd) {
  const numericId = clean(carCd).replace(/^[^0-9]+/, '');
  const matcher = new RegExp(`^https://img\\.kcar\\.com/3dcarpicture/\\d{4}/\\d{2}/\\d+/${numericId}_[0-9]+/extra/extra_[0-9]+_hq\\.jpg(?:[?#].*)?$`, 'i');
  const raw = clean(data?.vrVo?.v_src_show).split(',').map((v) => v.replace(/^['\"]+|['\"]+$/g, '').trim()).filter(Boolean);
  return { raw: raw.length, exact: raw.filter((url) => matcher.test(url)).length, sample: raw.slice(0, 2) };
}

const listing = await jsonRequest(`${API_BASE}/bc/search/list/drct`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: encryptedBody({
    wr_in_multi_columns: 'cntr_rgn_cd|cntr_cd',
    pageno: 1,
    limit: 20,
    orderFlag: true,
    orderBy: 'time_deal_yn:desc|time_deal_end_dt:asc|promo_ordr:asc|event_ordr:asc|sort_ordr:asc',
  }),
});
const root = listing.json?.data?.data ?? listing.json?.data ?? {};
const rows = Array.isArray(root?.rows) ? root.rows : [];
console.log(JSON.stringify({
  stage: 'list',
  status: listing.response.status,
  contentType: listing.response.headers.get('content-type'),
  success: listing.json?.success ?? null,
  result: listing.json?.result ?? null,
  message: listing.json?.message ?? null,
  totalCnt: root?.totalCnt ?? null,
  rows: rows.length,
  sampleIds: rows.slice(0, 5).map((row) => row?.carCd),
}, null, 2));

for (const meta of rows.slice(0, 5)) {
  const carCd = clean(meta?.carCd);
  const url = new URL(`${API_BASE}/bc/car-info-detail-of-ng`);
  url.searchParams.set('i_sCarCd', carCd);
  url.searchParams.set('i_sPassYn', 'N');
  const detail = await jsonRequest(url.toString(), { headers: { referer: `${WEB_BASE}/bc/detail/carInfoDtl?i_sCarCd=${encodeURIComponent(carCd)}` } });
  const data = detail.json?.data?.data ?? detail.json?.data ?? null;
  const rvo = data?.rvo || {};
  console.log(JSON.stringify({
    stage: 'detail',
    carCd,
    status: detail.response.status,
    success: detail.json?.success ?? null,
    result: detail.json?.result ?? null,
    message: detail.json?.message ?? null,
    dataKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 20) : [],
    rvo: {
      carCd: rvo.carCd ?? null,
      statCd: rvo.statCd ?? null,
      mnuftrNm: rvo.mnuftrNm ?? null,
      modelNm: rvo.modelNm ?? null,
      grdFullNm: rvo.grdFullNm ?? null,
      regModelyr: rvo.regModelyr ?? null,
      salprc: rvo.salprc ?? null,
      milg: rvo.milg ?? null,
      hrspow: rvo.hrspow ?? null,
      fuelTypecdNm: rvo.fuelTypecdNm ?? null,
      trnsmsncdNm: rvo.trnsmsncdNm ?? null,
      drvgYnNm: rvo.drvgYnNm ?? null,
      carctgr: rvo.carctgr ?? null,
    },
    gallery: galleryCount(data, carCd),
  }, null, 2));
}
