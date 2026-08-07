import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const KEY = Buffer.from('SKFJ2424DasfaJRI', 'utf8');
const IV = Buffer.from('sfq241sf3dscs321', 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const KCAR_WEB_BASE = 'https://www.kcar.com';
const KCAR_API_BASE = 'https://api.kcar.com';

function encrypt(value) {
  const cipher = crypto.createCipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('base64');
}

function stripFalsy(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => Boolean(item)));
}

function encryptedBody(value) {
  return JSON.stringify({ enc: encrypt(stripFalsy(value)) });
}

function rowsFromJson(json) {
  const candidates = [
    json?.data?.data?.rows,
    json?.data?.rows,
    json?.rows,
    json?.data?.data,
    json?.data,
    json,
  ];
  for (const candidate of candidates) if (Array.isArray(candidate)) return candidate;
  return [];
}

function rootFromJson(json) {
  return json?.data?.data ?? json?.data ?? json;
}

async function requestProbe({ name, url, params = null, headers = {}, method = params == null ? 'GET' : 'POST' }) {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
        origin: KCAR_WEB_BASE,
        referer: `${KCAR_WEB_BASE}/bc/search`,
        'user-agent': UA,
        ...(params == null ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(params == null ? {} : { body: encryptedBody(params) }),
      redirect: 'follow',
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const root = rootFromJson(json);
    const rows = rowsFromJson(json);
    const result = {
      name,
      url,
      params,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      bytes: Buffer.byteLength(text),
      json: Boolean(json),
      success: json?.success,
      message: json?.message,
      rootType: Array.isArray(root) ? 'array' : typeof root,
      dataKeys: root && typeof root === 'object' && !Array.isArray(root) ? Object.keys(root).slice(0, 120) : [],
      totalCnt: root?.totalCnt ?? json?.data?.totalCnt ?? json?.data?.data?.totalCnt,
      pageNo: root?.pageNo ?? root?.pageno ?? json?.data?.pageNo,
      rowCount: rows.length,
      firstRows: rows.slice(0, 3),
      prefix: text.slice(0, 20000),
    };
    await fs.writeFile(`kcar-api-${name}.txt`, text);
    return { result, rows };
  } catch (error) {
    return { result: { name, url, params, error: String(error?.stack || error) }, rows: [] };
  }
}

const c2cSearchCond = { wr_in_multi_columns: 'cntr_rgn_cd|cntr_cd' };
const c2cOrderBy = 'iqy_dt:desc';
const c2cCountParams = { ...c2cSearchCond, orderBy: c2cOrderBy, countFlag: true };
const c2cInitParams = (areaType) => ({
  deviceType: 'DEVICE_TYPE_200',
  pageType: 'PAGE_TYPE_100',
  areaType,
  ...c2cSearchCond,
  orderBy: c2cOrderBy,
  orderFlag: true,
});

// Exact dealer-search defaults recovered from the current K Car /bc/search bundle.
// The same bundle declares PRD_BASEURL/API_BASE_URL as https://api.kcar.com.
const dealerSearchParams = {
  wr_in_multi_columns: 'cntr_rgn_cd|cntr_cd',
  pageno: 1,
  limit: 20,
  orderFlag: true,
  orderBy: 'time_deal_yn:desc|time_deal_end_dt:asc|promo_ordr:asc|event_ordr:asc|sort_ordr:asc',
};
const dealerAcmParams = { ...dealerSearchParams, limit: 9 };

const output = {
  generatedAt: new Date().toISOString(),
  encryption: { algorithm: 'AES-128-CBC', keyBytes: KEY.length, ivBytes: IV.length, wrapper: '{enc:<base64>}' },
  bases: { web: KCAR_WEB_BASE, api: KCAR_API_BASE },
  dealerSearchParams,
  probes: [],
  detailRecon: null,
};

const c2cProbes = [
  ['market-count-exact', 'https://market-api.kcar.com/api/v1/ds/carSearchListCount', c2cCountParams],
  ['market-init-premium-exact', 'https://market-api.kcar.com/api/v1/ds/initSearchAdInfo', c2cInitParams('AREA_TYPE_100')],
  ['market-init-normal-exact', 'https://market-api.kcar.com/api/v1/ds/initSearchAdInfo', c2cInitParams('AREA_TYPE_300')],
];
for (const [name, url, params] of c2cProbes) {
  const { result } = await requestProbe({ name, url, params });
  output.probes.push(result);
}

let firstDealerRow = null;
for (const [name, path, params] of [
  ['dealer-direct-api-exact', '/bc/search/list/drct', dealerSearchParams],
  ['dealer-acm-api-exact', '/bc/search/list/acm', dealerAcmParams],
]) {
  const { result, rows } = await requestProbe({ name, url: `${KCAR_API_BASE}${path}`, params });
  output.probes.push(result);
  if (!firstDealerRow && rows.length) firstDealerRow = rows[0];
}

const firstCarCd = String(firstDealerRow?.carCd || firstDealerRow?.cdCarSeq || firstDealerRow?.carSeq || '').trim();
if (firstCarCd) {
  const detailUrl = `${KCAR_WEB_BASE}/bc/detail/carInfoDtl?i_sCarCd=${encodeURIComponent(firstCarCd)}`;
  const detailRecon = { carCd: firstCarCd, detailUrl, pageStatus: 0, pageBytes: 0, pageKeys: [], scripts: [], contexts: [], imageCandidates: [] };
  try {
    const pageResponse = await fetch(detailUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
        referer: `${KCAR_WEB_BASE}/bc/search`,
        'user-agent': UA,
      },
      redirect: 'follow',
    });
    const pageText = await pageResponse.text();
    detailRecon.pageStatus = pageResponse.status;
    detailRecon.pageBytes = Buffer.byteLength(pageText);
    detailRecon.pageKeys = [...new Set([...pageText.matchAll(/\b(?:carCd|carSeq|cdCarSeq|mnuftrNm|modelNm|grdNm|salprc|milg|fuel|trnsmsn|elanPath|msizeImgPath|ssizeImgPath)\b/g)].map((m) => m[0]))];
    detailRecon.imageCandidates = [...new Set([...pageText.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+?\.(?:jpe?g|png|webp)(?:\?[^"'<>\\\s]*)?/gi)].map((m) => m[0].replace(/\\\//g, '/'))) ].slice(0, 80);
    await fs.writeFile('kcar-api-dealer-detail.html.txt', pageText);

    const scriptUrls = [...new Set([...pageText.matchAll(/<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi)]
      .map((match) => new URL(match[1], KCAR_WEB_BASE).toString()))].slice(0, 60);
    detailRecon.scripts = scriptUrls;
    const needles = [
      '/api/car-search/vehicle-detail',
      'vehicle-detail',
      'getCarInfo',
      'carSeq',
      'carCd',
      'elanPath',
      'msizeImgPath',
      'ssizeImgPath',
      'photo',
      'imageList',
      'CarInfoDtl',
      'carInfoDtl',
    ];
    for (const scriptUrl of scriptUrls) {
      try {
        const response = await fetch(scriptUrl, { headers: { referer: detailUrl, 'user-agent': UA }, redirect: 'follow' });
        if (!response.ok) continue;
        const source = await response.text();
        for (const needle of needles) {
          let from = 0;
          let found = 0;
          while (found < 8 && detailRecon.contexts.length < 240) {
            const index = source.indexOf(needle, from);
            if (index < 0) break;
            detailRecon.contexts.push({ scriptUrl, needle, context: source.slice(Math.max(0, index - 2200), index + 4200) });
            from = index + needle.length;
            found += 1;
          }
        }
      } catch {}
    }
  } catch (error) {
    detailRecon.error = String(error?.stack || error);
  }
  output.detailRecon = detailRecon;
}

await fs.writeFile('kcar-api-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({
  generatedAt: output.generatedAt,
  probes: output.probes.map(({ name, status, success, totalCnt, rowCount, error }) => ({ name, status, success, totalCnt, rowCount, error })),
  detail: output.detailRecon ? {
    carCd: output.detailRecon.carCd,
    pageStatus: output.detailRecon.pageStatus,
    pageBytes: output.detailRecon.pageBytes,
    scriptCount: output.detailRecon.scripts.length,
    contextCount: output.detailRecon.contexts.length,
    imageCandidateCount: output.detailRecon.imageCandidates.length,
    error: output.detailRecon.error,
  } : null,
}, null, 2));
