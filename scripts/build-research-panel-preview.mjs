import {build} from 'esbuild';
import fs from 'node:fs/promises';
const result=await build({entryPoints:['docs/prototypes/research-split-view.tsx'],bundle:true,minify:true,jsx:'automatic',write:false,outdir:'/tmp/avtocena-research-preview',define:{'process.env.NODE_ENV':'"production"'}});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
await fs.writeFile('docs/prototypes/research-split-view.html',`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>АвтоЦена — прототип панели ИИ</title><style>${css}</style></head><body><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`);
console.log('Built docs/prototypes/research-split-view.html');
