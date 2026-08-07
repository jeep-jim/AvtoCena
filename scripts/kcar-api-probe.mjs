import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const KEY = Buffer.from('SKFJ2424DasfaJRI', 'utf8');
const IV = Buffer.from('sfq241sf3dscs321', 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

function encrypt(value) {
  const cipher = crypto.createCipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('base64');
}

const params = {
  pageno: 1,
  limit: 26,
  orderFlag: true,
  orderBy: 'time_deal_yn:desc|time_deal_end_dt:asc|promo_ordr:asc|event_ordr:asc|sort_ordr:asc',
};
const countParams = { ...params, countFlag: true };
const jsonBody = (value) => JSON.stringify({ enc: encrypt(value) });

const probes = [
  ['www-drct-json', 'https://www.kcar.com/bc/search/list/drct', { 'content-type': 'application/json' }, jsonBody(params)],
  ['api-drct-json', 'https://api.kcar.com/bc/search/list/drct', { 'content-type': 'application/json' }, jsonBody(params)],
  ['api-list-json', 'https://api.kcar.com/bc/search/list', { 'content-type': 'application/json' }, jsonBody(params)],
  ['market-count-json', 'https://market-api.kcar.com/api/v1/ds/carSearchListCount', { 'content-type': 'application/json' }, jsonBody(countParams)],
  ['market-init-json', 'https://market-api.kcar.com/api/v1/ds/initSearchAdInfo', { 'content-type': 'application/json' }, jsonBody({ ...params, areaType: 'AREA_TYPE_300' })],
];

const output = { generatedAt: new Date().toISOString(), params, probes: [] };
for (const [name, url, extraHeaders, body] of probes) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
        origin: 'https://www.kcar.com',
        referer: 'https://www.kcar.com/bc/search',
        'user-agent': UA,
        ...extraHeaders,
      },
      body,
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
      prefix: text.slice(0, 6000),
    });
    await fs.writeFile(`kcar-api-${name}.txt`, text);
  } catch (error) {
    output.probes.push({ name, url, error: String(error?.stack || error) });
  }
}
await fs.writeFile('kcar-api-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
