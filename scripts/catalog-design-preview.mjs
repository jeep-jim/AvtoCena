// Standalone visual fixture built from the real components. No API/lead writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';

const output = process.argv[2];
if (!output) throw new Error('Supply an output HTML path');
const root = process.cwd();
const cssPaths = ['globals.css', 'catalog-ui.css', 'public-polish.css', 'flat-ui.css', 'public-regression-fixes.css', 'public-price-sheet-fix.css', 'catalog-filter-compact.css'];
let css = (await Promise.all(cssPaths.map(file => fs.readFile(path.join(root, 'apps/web/app', file), 'utf8')))).join('\n');
for (const [file, variable] of [['apps/web/app/layout.tsx', 'publicUiCorrections'], ['apps/web/app/(public)/layout.tsx', 'publicPageFixes']]) {
  const source = await fs.readFile(file, 'utf8');
  const match = source.match(new RegExp('const ' + variable + ' = `([\\s\\S]*?)`;'));
  if (match) css += '\n' + match[1];
}
const processed = await postcss([tailwind({ content: ['apps/web/components/**/*.tsx'], theme: { extend: {} }, plugins: [] })]).process(css, { from: undefined });
const bundled = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CatalogDesignPreview} from './apps/web/components/catalog/CatalogDesignPreview';
    window.fetch=async()=>({ok:true,json:async()=>({rates:[],offers:[],makes:[],models:[],counts:{}})});
    createRoot(document.getElementById('root')).render(<CatalogDesignPreview/>);`, loader: 'tsx', resolveDir: root },
  bundle: true, write: false, minify: true, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': path.join(root, 'apps/web') },
  plugins: [{ name: 'preview-navigation', setup(builder) {
    builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'preview' }));
    builder.onLoad({ filter: /.*/, namespace: 'preview' }, args => ({ loader: 'jsx', resolveDir: root,
      contents: args.path === 'next/navigation'
        ? `export const useRouter=()=>({replace(){},push(){},refresh(){}}); export const usePathname=()=>'/cars'; export const useSearchParams=()=>new URLSearchParams();`
        : `import React from 'react'; export default function Link({children,href,prefetch,...props}){return <a {...props} href="#" onClick={e=>e.preventDefault()}>{children}</a>}`
    }));
  } }]
});
const html = `<!doctype html><html lang="ru" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>АвтоЦена — макет каталога</title><style>${processed.css}</style></head><body><div id="root"></div><script>${bundled.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
const preview = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>АвтоЦена — desktop и mobile</title><style>body{margin:0;background:#dfe4eb;font:14px Arial;color:#20252f}header{position:sticky;top:0;background:#fff;padding:14px 20px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;z-index:1}button{font:inherit;border:1px solid #ddd;border-radius:8px;padding:9px 14px;background:#fff;cursor:pointer}button[aria-pressed=true]{background:#e32c39;color:#fff;border-color:#e32c39}iframe{display:block;border:0;margin:24px auto;width:1366px;height:1050px;max-width:100%;background:white}small{color:#626b7a}</style><header><strong>АвтоЦена · макет</strong><button id="desktop" aria-pressed="true">Компьютер</button><button id="mobile" aria-pressed="false">Телефон</button><small>Расчёт и заявка — демонстрация интерфейса</small></header><iframe title="Макет АвтоЦены"></iframe><script>const frame=document.querySelector('iframe');frame.srcdoc=${JSON.stringify(html).replaceAll('</script', '<\\/script')};for(const id of ['desktop','mobile'])document.getElementById(id).onclick=()=>{frame.style.width=id==='mobile'?'390px':'1366px';frame.style.height=id==='mobile'?'844px':'1050px';for(const key of ['desktop','mobile'])document.getElementById(key).setAttribute('aria-pressed',String(key===id));};</script></html>`;
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, preview);
console.log(output);
