from pathlib import Path

# 1) Route loader: never bleed outside the 64px public header, soften it, and hide
# immediately when the route key commits. Also prevent a delayed reveal timer from
# firing after a very fast navigation has already completed.
p = Path('apps/web/components/layout/RoutePreloader.tsx')
s = p.read_text()
s = s.replace(
    'import { Suspense, useEffect, useRef, useState } from "react";',
    'import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";',
)
s = s.replace('const MIN_VISIBLE_MS = 80;', 'const MIN_VISIBLE_MS = 0;')
s = s.replace(
    '  background:rgba(15,23,42,.18)!important;\n  isolation:isolate!important;',
    '  background:rgba(15,23,42,.10)!important;\n  isolation:isolate!important;\n  clip-path:inset(0)!important;\n  contain:paint!important;',
)
s = s.replace('  opacity:.72!important;', '  opacity:.58!important;')
s = s.replace('  background:rgba(12,18,30,.66)!important;', '  background:rgba(12,18,30,.56)!important;')
old_show = ' const show=()=>{clearTimers();revealTimerRef.current=window.setTimeout(()=>{revealTimerRef.current=null;startedAtRef.current=performance.now();setVisible(true);safetyTimerRef.current=window.setTimeout(()=>setVisible(false),MAX_VISIBLE_MS)},REVEAL_DELAY_MS)};'
new_show = ' const show=()=>{clearTimers();const startedRoute=`${window.location.pathname}${window.location.search}`;revealTimerRef.current=window.setTimeout(()=>{revealTimerRef.current=null;if(`${window.location.pathname}${window.location.search}`!==startedRoute)return;startedAtRef.current=performance.now();setVisible(true);safetyTimerRef.current=window.setTimeout(()=>setVisible(false),MAX_VISIBLE_MS)},REVEAL_DELAY_MS)};'
if old_show not in s:
    raise SystemExit('route loader show block not found')
s = s.replace(old_show, new_show)
old_hide = ' useEffect(()=>{if(previousRouteKeyRef.current===routeKey)return;previousRouteKeyRef.current=routeKey;if(revealTimerRef.current!==null){hide();return}if(!visible)return;const delay=Math.max(0,MIN_VISIBLE_MS-(performance.now()-startedAtRef.current));hideTimerRef.current=window.setTimeout(()=>hide(),delay)},[routeKey,visible]);'
new_hide = ' useLayoutEffect(()=>{if(previousRouteKeyRef.current===routeKey)return;previousRouteKeyRef.current=routeKey;hide()},[routeKey]);'
if old_hide not in s:
    raise SystemExit('route loader hide effect not found')
s = s.replace(old_hide, new_hide)
p.write_text(s)

# 2) Runtime: the raw {signal:killed} page is emitted by the serverless runtime,
# before Next can render error.tsx. Raise memory headroom and reduce simultaneous
# SSR requests per instance so a page burst is less likely to kill the process.
p = Path('.github/workflows/deploy-yandex.yml')
s = p.read_text()
if 'revision-memory: 1Gb' not in s:
    raise SystemExit('expected 1Gb runtime setting not found')
if 'revision-concurrency: 8' not in s:
    raise SystemExit('expected concurrency 8 not found')
s = s.replace('revision-memory: 1Gb', 'revision-memory: 2Gb')
s = s.replace('revision-concurrency: 8', 'revision-concurrency: 4')
p.write_text(s)

# 3) Direct UAE+Georgia recovery: its atomic write succeeded, but the final check
# compared against a stale pre-write snapshot. Compare the post-write catalog with
# the exact manifest counts returned by the batch publisher instead.
p = Path('.github/workflows/catalog-live-recovery-uae-georgia-direct.yml')
s = p.read_text()
old = '''          const before = JSON.parse(fs.readFileSync('catalog-direct-before-all7.json', 'utf8'));
          const after = JSON.parse(fs.readFileSync('catalog-direct-after-all7.json', 'utf8'));
          const preserved = ['korea','china','japan','europe','kyrgyzstan'];
          for (const market of preserved) {
            const beforeCount = Number(before.markets?.[market]?.count || 0);
            const oldRows = Number(before.markets?.[market]?.belowMarketMinYearCount || 0);
            const expectedAfter = beforeCount - oldRows;
            const actualAfter = Number(after.markets?.[market]?.count || 0);
            if (actualAfter !== expectedAfter) {
              throw new Error(`unexpected_cross_market_change:${market}:${beforeCount}-${oldRows}=${expectedAfter},actual=${actualAfter}`);
            }
          }
'''
new = '''          const before = JSON.parse(fs.readFileSync('catalog-direct-before-all7.json', 'utf8'));
          const after = JSON.parse(fs.readFileSync('catalog-direct-after-all7.json', 'utf8'));
          const publish = JSON.parse(fs.readFileSync('catalog-direct-recovery-batch-publish-report.json', 'utf8'));
          const preserved = ['korea','china','japan','europe','kyrgyzstan'];
          for (const market of preserved) {
            const expectedAfter = Number(publish.preservedByMarket?.[market] ?? publish.manifestCounts?.[market] ?? 0);
            const actualAfter = Number(after.markets?.[market]?.count || 0);
            if (actualAfter !== expectedAfter) {
              throw new Error(`preserved_manifest_mismatch:${market}:expected=${expectedAfter},actual=${actualAfter}`);
            }
          }
          for (const market of ['uae','georgia']) {
            const expectedAfter = Number(publish.manifestCounts?.[market] || 0);
            const actualAfter = Number(after.markets?.[market]?.count || 0);
            if (actualAfter !== expectedAfter) throw new Error(`published_manifest_mismatch:${market}:expected=${expectedAfter},actual=${actualAfter}`);
          }
          console.log({preSnapshot:Object.fromEntries(preserved.map(m=>[m,before.markets?.[m]?.count||0])), atomicPreserved:publish.preservedByMarket});
'''
if old not in s:
    raise SystemExit('old UAE/Georgia final assertion block not found')
s = s.replace(old, new)
p.write_text(s)
