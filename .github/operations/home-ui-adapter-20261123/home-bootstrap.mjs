// Mounted outside the exact application image. Docker starts this small parent
// without NODE_OPTIONS; the accepted launcher then strips only memory flags
// before starting the application, preserving its other inherited Node flags.
const inheritedKey = 'AVTOCENA_HOME_INHERITED_NODE_OPTIONS';
if (process.env.NODE_OPTIONS !== undefined) throw Error('home_bootstrap_node_options_not_detached');
const inherited = process.env[inheritedKey];
delete process.env[inheritedKey];
if (inherited !== undefined) process.env.NODE_OPTIONS = inherited;

const imageProbe = `
const fs=require('node:fs'),crypto=require('node:crypto');
const need=(value,code)=>{if(!value)throw Error('home_image_probe_'+code)};
need(process.version==='v24.22.1','node_version');
need(fs.existsSync('/etc/alpine-release'),'platform');
need(fs.existsSync('/app/apps/web/server.js'),'standalone_server');
need(!fs.existsSync('/app/apps/web/data')&&fs.existsSync('/app/data'),'data_root');
need(!fs.existsSync('/app/data/knowledge/encyclopedia/calculation-v1.json'),'private_index_in_image');
const raw=fs.readFileSync('/app/apps/web/public/model-directory.ee5c872e91274308.json');
need(raw.length===889114&&crypto.createHash('sha256').update(raw).digest('hex')==='ee5c872e9127430890f58abf239cddfa48553f86c3032799c9c29953b6109662','model_asset');
const model=JSON.parse(raw);need(model.version===1&&model.models.length===18389&&model.brands.length===727,'model_counts');
const references=new Set();for(const name of fs.readdirSync('/app/apps/web/.next/static/chunks'))if(name.endsWith('.js')){
 for(const reference of fs.readFileSync('/app/apps/web/.next/static/chunks/'+name,'utf8').match(/model-directory\\.[a-f0-9]{16}\\.json/g)||[])references.add(reference);
}
need(references.size===1&&references.has('model-directory.ee5c872e91274308.json'),'client_asset_reference');
console.log(JSON.stringify({stage:'home_image_probe',passed:true,nodeVersion:process.version,modelAssetSha256:'ee5c872e9127430890f58abf239cddfa48553f86c3032799c9c29953b6109662',privateIndexInImage:false}));
`;
const privateProbe = `
const fs=require('node:fs'),crypto=require('node:crypto');
const need=(value,code)=>{if(!value)throw Error('home_private_probe_'+code)};
need(process.version==='v24.22.1','node_version');
need(!fs.existsSync('/app/apps/web/data')&&fs.existsSync('/app/data'),'data_root');
const file='/app/data/knowledge/encyclopedia/calculation-v1.json',raw=fs.readFileSync(file),index=JSON.parse(raw);
const digest='bf2c72cb7a260ef093c0a43c2b0dad9c4c9094a4d6dc3811dd0d7f7626b0d72b';
need(index.version===1&&index.digest===digest&&index.models&&crypto.createHash('sha256').update(JSON.stringify(index.models)).digest('hex')===digest,'index');
need((fs.statSync(file).mode&0o777)===0o400,'file_mode');
console.log(JSON.stringify({stage:'home_private_probe',passed:true,nodeVersion:process.version,indexDigest:digest,fileSha256:crypto.createHash('sha256').update(raw).digest('hex')}));
`;
const mode = process.argv[2];
if (process.argv.length !== 3 || !['serve','image-probe','private-probe'].includes(mode)) throw Error('home_bootstrap_mode');
const launcher = new URL('./run-node-with-resources.mjs', import.meta.url);
process.argv = [process.execPath, launcher.pathname,
  ...(mode === 'serve' ? ['/app/apps/web/server.js'] : ['-e', mode === 'image-probe' ? imageProbe : privateProbe])];
await import(launcher.href);
