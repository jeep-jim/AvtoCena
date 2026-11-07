from pathlib import Path
import os,re
expected=os.environ['EXPECTED_RELEASE']
assert re.fullmatch('[a-f0-9]{40}',expected)
source=Path('.github/workflows/catalog-speed-visible-baseline-20261107.yml').read_text()
start=source.index("          import fs from 'node:fs';")
end=source.index('\n          JS\n',start)
script='\n'.join(line[10:] for line in source[start:end].splitlines())+'\n'
before="const expected='a5f9a645835ae636ab99dd1a7b1073ba24d851b4';"
assert script.count(before)==1
script=script.replace(before,"const expected='"+expected+"';")
before="const selector=label.startsWith('zma')?'a[href*=\"/avto/china/\"] img':'.ac-catalog-card';"
assert script.count(before)==1
script=script.replace(before,"const selector=label.startsWith('zma')?'article:has(a[href*=\"/avto/china/\"])':'.ac-catalog-card';")
before="const image=label.startsWith('zma')?page.locator(selector).first():page.locator('.ac-catalog-card').first().locator('img').first();"
assert script.count(before)==1
script=script.replace(before,"const image=page.locator(selector).first().locator('img').first();")
script=script.replace("cards:document.querySelectorAll('.ac-catalog-card').length","cards:document.querySelectorAll('.ac-catalog-card,article:has(a[href*=\"/avto/china/\"])').length")
script=script.replace('visible-speed/','speed-installed/').replace("'visible-speed'","'speed-installed'")
# The reference may be unavailable independently. Only our functional failures
# fail this readback; duration is measured and reported, never silently accepted.
script+="""
report.functionalFailures=report.cases.filter(row=>!row.label.startsWith('zma')&&(row.error||row.status!==200||!(row.state?.cards>0)||row.state?.overflow||row.state?.errors?.length));
report.functionalAccepted=report.functionalFailures.length===0;
report.completeSpeedParityAccepted=false;
save();
if(!report.functionalAccepted)process.exitCode=1;
"""
Path('speed-installed').mkdir(exist_ok=True)
Path('/tmp/catalog-visible/check.mjs').write_text(script)
Path('speed-installed/measurement-script.mjs').write_text(script)
Path('speed-installed/method-note.txt').write_text('Same first-card/cover method and routes as corrected baseline42373543089. Fresh browser context does not establish cold server cache. Different times/runners/source content prohibit attributing every timing change to the patch. A quick empty result is not accepted. Duration is reported separately from functional correctness; no claim of universal ZMA parity. No load test or VPN comparison.\n')
