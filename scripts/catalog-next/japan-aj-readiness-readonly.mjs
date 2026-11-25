import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {validateCollectionControls} from '../../apps/web/lib/catalog/collection-controls.ts';
import {defaultCollectionControls} from '../../apps/web/lib/catalog/collection-controls-schema.ts';

const fail = code => {throw Error('japan_readiness_'+code)};
const expected = {
  YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',
  YC_OBJECT_STORAGE_REGION:'us-east-1',
  YC_OBJECT_STORAGE_BUCKET:'avtocena-staging-8120751',
  YC_OBJECT_STORAGE_PREFIX:'migration-staging/full-20261011/'
};
for (const [key,value] of Object.entries(expected)) if(process.env[key]!==value) fail('storage_profile');
if(process.env.JSON_STORAGE_DRIVER!=='object') fail('storage_driver');
const store = getJsonStorage();
const [settings,credential]=await Promise.all([
  store.readJsonWithMeta('catalog/operations/collection-controls-v1.json',null),
  store.readJsonWithMeta('integrations/ajes/config.json',null)
]);
const values=settings.found?validateCollectionControls(settings.value):defaultCollectionControls();
const active=values.sources.ajes_japan_feed?.enabled===true;
const japan=values.markets.japan?.enabled===true;
const china=values.sources.che168_feed?.enabled===true;
const config=credential.value;
const encryptedConfigured=credential.found &&
  typeof config?.encryptedPassword==='string' &&
  /^([A-Za-z0-9+/]+={0,2}\.){2}[A-Za-z0-9+/]+={0,2}$/.test(config.encryptedPassword);
const output={
  kind:'japan-aj-source-readonly-v1',
  storageDriver:'object',controlsPresent:settings.found,
  controlsRevision:values.revision,
  japanMarketEnabled:japan, ajJapanSourceEnabled:active,
  chinaSourceStillEnabled:china,
  encryptedAJCredentialPresent:encryptedConfigured,
  japaneseSourceRequiresOwnerEnable:!active,
  settingFoundWithoutETag:settings.found&&!settings.etag
};
process.stdout.write(JSON.stringify(output)+'\n');
