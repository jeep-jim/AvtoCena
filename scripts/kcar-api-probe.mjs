import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const KEY = Buffer.from('SKFJ2424DasfaJRI', 'utf8');
const IV = Buffer.from('sfq241sf3dscs321', 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

function encrypt(value) {
  const cipher = crypto.createCipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('base64');
}

const searchCond = { wr_in_multi_columns: 'cntr_rgn_cd|cntr_cd' };
const orderBy = 'iqy_dt:desc';
const countParams = { ...searchCond, orderBy, countFlag: true };
const initParams = (areaType) => ({
  deviceType: 'DEVICE_TYPE_200',
  pageType: 'PAGE_TYPE_100',
  areaType,
  ...searchCond,
  orderBy,
  orderFlag: true,
});
const jsonBody = (value) => JSON.stringify({ enc: encrypt(value) });

const probes = [
  ['market-count-exact', 'https://market-api.kcar.com/api/v1/ds/carSearchListCount', countParams],
  ['market-init-premium-exact', 'https://market-api.kcar.com/api/v1/ds/initSearchAdInfo', initParams('AREA_TYPE_100')],
  ['market-init-normal-exact', 'https://market-api.kcar.com/api/v1/ds/initSearchAdInfo', initParams('AREA_TYPE_300')],
  ['market-filter-list', 'https://market-api.kcar.com/api/v1/ds/searchFilterList', null],
  ['market-recommend', 'https://market-api.kcar.com/api/v1/ds/recommendAds', null],
];

const commonHeaders = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
  origin: 'https://www.kcar.com',
  referer: 'https://www.kcar.com/bc/search?tab=c2c',
  'user-agent': UA,
};

const output = { generatedAt: new Date().toISOString(), searchCond, orderBy, probes: [] };
for (const [name, url, params] of probes) {
  try {
    const isGet = params === null;
    const response = await fetch(url, {
      method: isGet ? 'GET' : 'POST',
      headers: {
        ...commonHeaders,
        ...(isGet ? {} : { 'content-type': 'application/json' }),
      },
      ...(isGet ? {} : { body: jsonBody(params) }),
      redirect: 'follow',
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const root = json?.data ?? json;
    const rows = Array.isArray(root?.rows)
      ? root.rows
      : Array.isArray(root?.data?.rows)
        ? root.data.rows
        : Array.isArray(root)
          ? root
          : [];
    output.probes.push({
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
      dataKeys: root && typeof root === 'object' && !Array.isArray(root) ? Object.keys(root).slice(0, 100) : [],
      totalCnt: root?.totalCnt ?? root?.data?.totalCnt,
      pageNo: root?.pageNo ?? root?.data?.pageNo,
      rowCount: rows.length,
      firstRows: rows.slice(0, 3),
      rootPreview: Array.isArray(root) ? root.slice(0, 8) : root,
      prefix: text.slice(0, 16000),
    });
    await fs.writeFile(`kcar-api-${name}.txt`, text);
  } catch (error) {
    output.probes.push({ name, url, params, error: String(error?.stack || error) });
  }
}

const scriptRecon = { pageStatus: 0, scripts: [], contexts: [] };
try {
  const pageResponse = await fetch('https://www.kcar.com/bc/search?tab=c2c', {
    headers: { 'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7', 'user-agent': UA },
    redirect: 'follow',
  });
  const pageText = await pageResponse.text();
  scriptRecon.pageStatus = pageResponse.status;
  const scriptUrls = [...new Set([...pageText.matchAll(/<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi)]
    .map((match) => new URL(match[1], 'https://www.kcar.com').toString()))].slice(0, 40);
  scriptRecon.scripts = scriptUrls;
  const needles = ['pagingCarSearchList', 'carSearchListCount', 'CarInfoDtl', 'carInfoDtl', 'ccCarId', 'startIndex', 'lastIndex', 'pageNo', 'pageSize'];
  for (const scriptUrl of scriptUrls) {
    try {
      const response = await fetch(scriptUrl, { headers: { referer: 'https://www.kcar.com/bc/search?tab=c2c', 'user-agent': UA }, redirect: 'follow' });
      if (!response.ok) continue;
      const source = await response.text();
      for (const needle of needles) {
        let from = 0;
        let found = 0;
        while (found < 6) {
          const index = source.indexOf(needle, from);
          if (index < 0) break;
          scriptRecon.contexts.push({ scriptUrl, needle, context: source.slice(Math.max(0, index - 1800), index + 3000) });
          from = index + needle.length;
          found += 1;
        }
      }
    } catch {}
  }
} catch (error) {
  scriptRecon.error = String(error?.stack || error);
}

output.scriptRecon = {
  pageStatus: scriptRecon.pageStatus,
  scriptCount: scriptRecon.scripts.length,
  contextCount: scriptRecon.contexts.length,
  contexts: scriptRecon.contexts.slice(0, 100),
};
await fs.writeFile('kcar-script-contexts.json', JSON.stringify(scriptRecon, null, 2));
await fs.writeFile('kcar-api-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));