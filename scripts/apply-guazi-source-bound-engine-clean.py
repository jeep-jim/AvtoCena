from pathlib import Path

p = Path('apps/web/lib/catalog/open-market-sources.ts')
s = p.read_text()
old = '      engineCc: row.engineCc,\n'
new = '      engineCc: sourceBoundEngineCc(this.sourceId, row) || row.engineCc,\n'
assert old in s, 'normalize engineCc anchor changed'
s = s.replace(old, new, 1)
anchor = 'function pathPage(base: string, page: number) { return page <= 1 ? base : `${base.replace(/\\/$/, "")}/page/${page}`; }\n\n'
insert = '''function pathPage(base: string, page: number) { return page <= 1 ? base : `${base.replace(/\\/$/, "")}/page/${page}`; }\n\nfunction sourceBoundEngineCc(sourceId: string, row: OpenRow) {\n  if (sourceId !== "guazi_china_open") return undefined;\n  const identity = `${row.detailUrl || ""} ${row.id || ""}`.toLowerCase();\n  const token = identity.match(/-(\\d{2})l(?:-|\\.|\\/|$)/i)?.[1];\n  if (!token) return undefined;\n  const cc = Math.round(Number(token) * 100);\n  return cc >= 500 && cc <= 10_000 ? cc : undefined;\n}\n\n'''
assert anchor in s, 'pathPage anchor changed'
s = s.replace(anchor, insert, 1)
p.write_text(s)
