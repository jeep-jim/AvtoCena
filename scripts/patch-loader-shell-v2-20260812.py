from pathlib import Path
p=Path('apps/web/components/layout/RoutePreloader.tsx')
s=p.read_text()
s=s.replace('import { Suspense, useEffect, useRef, useState } from "react";', 'import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";')
s=s.replace('const MIN_VISIBLE_MS = 80;', 'const MIN_VISIBLE_MS = 0;')
s=s.replace('  background:rgba(15,23,42,.18)!important;\n  isolation:isolate!important;', '  background:rgba(15,23,42,.10)!important;\n  isolation:isolate!important;\n  clip-path:inset(0)!important;\n  contain:paint!important;')
s=s.replace('  opacity:.72!important;', '  opacity:.58!important;')
s=s.replace('  background:rgba(12,18,30,.66)!important;', '  background:rgba(12,18,30,.56)!important;')
old=' const show=()=>{clearTimers();revealTimerRef.current=window.setTimeout(()=>{revealTimerRef.current=null;startedAtRef.current=performance.now();setVisible(true);safetyTimerRef.current=window.setTimeout(()=>setVisible(false),MAX_VISIBLE_MS)},REVEAL_DELAY_MS)};'
new=' const show=()=>{clearTimers();const startedRoute=`${window.location.pathname}${window.location.search}`;revealTimerRef.current=window.setTimeout(()=>{revealTimerRef.current=null;if(`${window.location.pathname}${window.location.search}`!==startedRoute)return;startedAtRef.current=performance.now();setVisible(true);safetyTimerRef.current=window.setTimeout(()=>setVisible(false),MAX_VISIBLE_MS)},REVEAL_DELAY_MS)};'
if old not in s: raise SystemExit('show block missing')
s=s.replace(old,new)
old=' useEffect(()=>{if(previousRouteKeyRef.current===routeKey)return;previousRouteKeyRef.current=routeKey;if(revealTimerRef.current!==null){hide();return}if(!visible)return;const delay=Math.max(0,MIN_VISIBLE_MS-(performance.now()-startedAtRef.current));hideTimerRef.current=window.setTimeout(()=>hide(),delay)},[routeKey,visible]);'
new=' useLayoutEffect(()=>{if(previousRouteKeyRef.current===routeKey)return;previousRouteKeyRef.current=routeKey;hide()},[routeKey]);'
if old not in s: raise SystemExit('hide effect missing')
s=s.replace(old,new)
p.write_text(s)
