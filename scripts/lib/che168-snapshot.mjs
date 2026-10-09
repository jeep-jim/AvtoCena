import {createHash} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';

const sha = data => createHash('sha256').update(data).digest('hex');
const CHUNK = 16 * 1024 * 1024;
export function snapshotBinding(config) {
  if (config?.version !== 1 || config.host !== 'https://autobase-barrett.auto-api.com'
    || !/^\d{4}-\d{2}-\d{2}$/.test(config.date) || config.filename !== 'active_offer.csv'
    || config.delimiter !== '|' || !Number.isSafeInteger(config.initialCursor) || config.initialCursor < 0
    || !Number.isSafeInteger(config.bytes) || config.bytes <= 0 || config.bytes > 20 * 1024**3
    || !/^"[^"\r\n]+"$/.test(config.etag) || !Number.isFinite(Date.parse(config.modifiedAt))) {
    throw Error('auto_api_invalid_snapshot_config');
  }
  return sha(JSON.stringify(config));
}
function verifyPart(descriptor, raw, index, config) {
  if (descriptor?.index !== index || descriptor.bytes !== Math.min(CHUNK, config.bytes - index * CHUNK)
    || raw.length !== descriptor.bytes || sha(raw) !== descriptor.sha256) throw Error('auto_api_snapshot_part_corrupt');
}
/** Immutable, compressed private parts. A restart resumes verified parts; the
 * complete manifest is written only after every byte has been received. */
export async function archiveChe168Snapshot({config, storage, password, fetchImpl=fetch, onProgress=()=>{}}) {
  const binding = snapshotBinding(config), prefix = `catalog/provider-snapshots/che168/${binding}`;
  if (!storage.putBinary || !storage.getBinary) throw Error('auto_api_snapshot_binary_storage_required');
  const count = Math.ceil(config.bytes / CHUNK), parts = new Array(count);
  const archived=await storage.readJson(`${prefix}/manifest.json`,null);
  if(archived){
    if(archived.complete!==true||archived.binding!==binding||snapshotBinding(archived.config)!==binding
      ||!Array.isArray(archived.parts)||archived.parts.length!==count
      ||archived.parts.some((p,i)=>p.index!==i||p.bytes!==Math.min(CHUNK,config.bytes-i*CHUNK)||!/^[a-f0-9]{64}$/.test(p.sha256)))throw Error('auto_api_snapshot_incomplete');
    await onProgress({snapshotAlreadyArchived:true,totalParts:count});return archived;
  }
  let next = 0, done = 0;
  async function worker() {
    while (next < count) {
      const index = next++, key = `${prefix}/${String(index).padStart(5,'0')}`;
      let descriptor = await storage.readJson(`${key}.json`, null);
      if (descriptor) {
        const raw = gunzipSync((await storage.getBinary(`${key}.csv.gz`)).data, {maxOutputLength:CHUNK});
        verifyPart(descriptor, raw, index, config);
      } else {
        if (typeof password !== 'string' || !password.trim() || /\s/.test(password)) throw Error('auto_api_snapshot_password_missing');
        const start = index * CHUNK, end = Math.min(config.bytes - 1, start + CHUNK - 1);
        let raw;
        for (let attempt=0; attempt<4; attempt++) {
          try {
            const response = await fetchImpl(`${config.host}/che168/${config.date}/${config.filename}`, {
              redirect:'error', signal:AbortSignal.timeout(120000), headers:{
                authorization:`Basic ${Buffer.from(`admin:${password}`).toString('base64')}`,
                range:`bytes=${start}-${end}`, 'if-match':config.etag, 'accept-encoding':'identity',
              },
            });
            if ([401,403,404,412].includes(response.status)) { await response.body?.cancel(); throw Error(`auto_api_snapshot_http_${response.status}`); }
            if(response.status>=500){await response.body?.cancel();throw Error('auto_api_snapshot_retryable');}
            if(response.status===429){
              const hint=response.headers.get('retry-after');await response.body?.cancel();
              const ms=/^\d+$/.test(hint||'')?Number(hint)*1000:Date.parse(hint||'')-Date.now();
              await new Promise(resolve=>setTimeout(resolve,Math.max(30000,Number.isFinite(ms)?ms:0)));
              throw Error('auto_api_snapshot_retryable');
            }
            if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${config.bytes}`
              || response.headers.get('etag') !== config.etag) { await response.body?.cancel(); throw Error('auto_api_snapshot_range_mismatch'); }
            const chunks=[]; let bytes=0;
            for await (const chunk of response.body) {
              bytes+=chunk.length; if (bytes>end-start+1) throw Error('auto_api_snapshot_range_mismatch');
              chunks.push(chunk);
            }
            if (bytes !== end-start+1) throw Error('auto_api_snapshot_truncated');
            raw=Buffer.concat(chunks); break;
          } catch(error) {
            if (/^auto_api_snapshot_(?:http_|range_mismatch)/.test(error?.message)) throw error;
            if (attempt===3) throw Error('auto_api_snapshot_transport_failed');
            await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
          }
        }
        descriptor={index,bytes:raw.length,sha256:sha(raw)};
        await storage.putBinary(`${key}.csv.gz`, gzipSync(raw,{level:1}), 'application/gzip');
        await storage.writeJson(`${key}.json`,descriptor);
      }
      parts[index]=descriptor; done++;
      await onProgress({archivedParts:done,totalParts:count});
    }
  }
  // Three bounded streams; no multi-gigabyte Buffer or per-listing download.
  const results=await Promise.allSettled(Array.from({length:3},worker));
  const failed=results.find(r=>r.status==='rejected'); if(failed)throw failed.reason;
  const manifest={version:1,binding,config,parts,complete:true};
  await storage.writeJson(`${prefix}/manifest.json`,manifest);
  return manifest;
}

export async function* readChe168Snapshot({config,storage}) {
  const binding=snapshotBinding(config),prefix=`catalog/provider-snapshots/che168/${binding}`;
  const manifest=await storage.readJson(`${prefix}/manifest.json`,null);
  if (!manifest?.complete || manifest.binding!==binding || snapshotBinding(manifest.config)!==binding
    || !Array.isArray(manifest.parts) || manifest.parts.length!==Math.ceil(config.bytes/CHUNK)) throw Error('auto_api_snapshot_incomplete');
  for(let index=0;index<manifest.parts.length;index++) {
    const raw=gunzipSync((await storage.getBinary(`${prefix}/${String(index).padStart(5,'0')}.csv.gz`)).data,{maxOutputLength:CHUNK});
    verifyPart(manifest.parts[index],raw,index,config); yield raw;
  }
}
