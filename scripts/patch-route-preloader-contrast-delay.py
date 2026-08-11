from pathlib import Path

p = Path('apps/web/components/layout/RoutePreloader.tsx')
s = p.read_text()
s = s.replace('const REVEAL_DELAY_MS = 180;\nconst MIN_VISIBLE_MS = 180;\nconst MAX_VISIBLE_MS = 4500;', 'const REVEAL_DELAY_MS = 320;\nconst MIN_VISIBLE_MS = 120;\nconst MAX_VISIBLE_MS = 3000;')
s = s.replace('className="mx-auto mt-2 flex w-fit max-w-[calc(100vw-24px)] items-center gap-2 rounded-full border border-[var(--ac-border)] bg-[var(--ac-surface)]/95 px-3 py-2 text-[var(--ac-text)] shadow-lg backdrop-blur-md"', 'className="ac-route-loader__pill mx-auto mt-2 flex w-fit max-w-[calc(100vw-24px)] items-center gap-2 rounded-full border border-[var(--ac-border)] bg-[var(--ac-surface)]/95 px-3 py-2 text-[var(--ac-text)] shadow-lg backdrop-blur-md"')
marker = '@media(min-width:768px){\n  html body main.ac-home-page #form .ac-budget-help{display:none!important}\n}\n'
addition = '''html[data-theme="light"] .ac-route-loader__pill{\n  background:#fff!important;\n  background-color:#fff!important;\n  border-color:rgba(30,36,48,.14)!important;\n  color:#171b24!important;\n  -webkit-text-fill-color:#171b24!important;\n  box-shadow:0 8px 24px rgba(30,36,48,.14)!important;\n}\n'''
if addition not in s:
    if marker not in s:
        raise SystemExit('route loader css marker missing')
    s = s.replace(marker, marker + addition, 1)
if 'REVEAL_DELAY_MS = 320' not in s or 'ac-route-loader__pill' not in s or 'background:#fff!important' not in s:
    raise SystemExit('route preloader patch did not apply')
p.write_text(s)
print('route_preloader_contrast_delay_patch_ok')
