from pathlib import Path

p = Path('apps/web/lib/catalog/open-market-sources.ts')
s = p.read_text()

anchor = '''function pathPage(base: string, page: number) { return page <= 1 ? base : `${base.replace(/\\/$/, "")}/page/${page}`; }\n'''
insert = '''function pathPage(base: string, page: number) { return page <= 1 ? base : `${base.replace(/\\/$/, "")}/page/${page}`; }\n\nfunction sourceBoundEngineCc(sourceId: string, row: OpenRow) {\n  if (sourceId !== "guazi_china_open") return undefined;\n  const identity = `${row.detailUrl || ""} ${row.id || ""}`.toLowerCase();\n  const token = identity.match(/-(\\d{2})l(?:-|\\.|\\/|$)/i)?.[1];\n  if (!token) return undefined;\n  const cc = Math.round(Number(token) * 100);\n  return cc >= 500 && cc <= 10_000 ? cc : undefined;\n}\n'''
if anchor not in s:
    raise SystemExit('pathPage anchor missing')
s = s.replace(anchor, insert, 1)

old = '      engineCc: row.engineCc,\n'
new = '      engineCc: sourceBoundEngineCc(this.sourceId, row) || row.engineCc,\n'
if old not in s:
    raise SystemExit('normalize engineCc anchor missing')
s = s.replace(old, new, 1)
p.write_text(s)
