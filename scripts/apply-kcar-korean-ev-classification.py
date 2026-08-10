from pathlib import Path

p = Path('apps/web/lib/catalog/spec-normalization.ts')
s = p.read_text()

replacements = [
    (
        'if (/electric|battery electric|\\bbev\\b|\\bev\\b|электро|纯电|전기/.test(text)) return "electric";',
        'if (/electric|battery electric|\\bbev\\b|\\bev\\b|электро|纯电|전기|일렉트릭/.test(text)) return "electric";'
    ),
    (
        'if (/battery[ -]?electric|pure[ -]?electric|\\bbev\\b|\\bev\\b|электромоб|纯电|전기차/.test(text) && !engineCc) return "electric";',
        'if (/battery[ -]?electric|pure[ -]?electric|\\bbev\\b|\\bev\\b|электромоб|纯电|전기차|일렉트릭/.test(text) && !engineCc) return "electric";'
    ),
    (
        '|| /아이오닉\\s*[56]/i.test(normalizedModelTrim)',
        '|| /아이오닉(?:\\s*[56]|.*?일렉트릭)/i.test(normalizedModelTrim)'
    ),
    (
        '|| (/tesla|테슬라/i.test(normalizedMake) && /\\bmodel\\s*[3sxy]\\b|cybertruck/i.test(normalizedModelTrim))',
        '|| (/tesla|테슬라/i.test(normalizedMake) && /(?:\\bmodel|모델)\\s*[3sxy]\\b|cybertruck/i.test(normalizedModelTrim))'
    ),
    (
        '|| (/chevrolet|쉐보레/i.test(normalizedMake) && /\\bbolt\\s*(?:ev|euv)\\b/i.test(normalizedModelTrim))',
        '|| (/chevrolet|쉐보레/i.test(normalizedMake) && /(?:\\bbolt|볼트)\\s*(?:ev|euv)\\b/i.test(normalizedModelTrim))'
    ),
    (
        'const strongElectric = knownPureElectricModel || /electric|battery electric|\\bbev\\b|\\bev\\b|электро|纯电|전기/.test(primary);',
        'const strongElectric = knownPureElectricModel || /electric|battery electric|\\bbev\\b|\\bev\\b|электро|纯电|전기|일렉트릭/.test(primary);'
    ),
]

for old, new in replacements:
    if old not in s:
        raise SystemExit(f'anchor missing: {old}')
    s = s.replace(old, new, 1)

p.write_text(s)
