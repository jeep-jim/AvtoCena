import json
import os
import pathlib

report_path = pathlib.Path('owner-search-recovery-public.json')
report = json.loads(report_path.read_text()) if report_path.exists() else {'passed': False, 'checks': [], 'error': 'verification_report_missing'}
run = os.environ['GITHUB_RUN_ID']
url = 'https://github.com/jeep-jim/AvtoCena/actions/runs/' + run
report['runUrl'] = url
target = pathlib.Path('docs/operations/2026-11-11-search-recovery-public.json')
target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
passed = report['passed']
rows = ['\n\n### 11.11.2026 — внешняя проверка адресного исправления поиска, run' + run, '',
        '- [Проверка](' + url + '): ' + ('функционально PASS.' if passed else 'FAILURE; исправление не считать принятым.'),
        '- Проверяемая сборка: `' + report.get('expectedRelease', 'unknown') + '`. HTTP200 или быстрый каркас отдельно не являются подтверждением работающего каталога.']
for check in report['checks']:
    if 'cards' in check:
        rows.append('- `' + check['path'] + '`: первые карточки ' + str(check.get('firstCardsSeconds')) + 'с, полный ответ ' + str(check.get('completeSeconds')) + 'с; карточек ' + str(check['cards']) + '; functional=' + str(check['passed']) + '; превышение ориентира2с=' + str(check.get('latencyTargetMiss')) + '.')
rows.append('- Это внешние сетевые измерения получения HTML, не время отрисовки браузера и не гарантия для всех посетителей. Все ошибки и превышения сохранены в JSON; дальнейшая приёмка взаимодействий и запись окончательного итога остаются отдельным шагом.\n')
browser_path=pathlib.Path('owner-search-recovery-browser.json')
if browser_path.exists():
    browser=json.loads(browser_path.read_text());browser['runUrl']=url
    pathlib.Path('docs/operations/2026-11-11-search-recovery-browser.json').write_text(json.dumps(browser,ensure_ascii=False,indent=2)+'\n')
    rows.append('- Браузер desktop/mobile: '+('PASS' if browser.get('passed') else 'FAILURE')+'. До прокрутки проверяется отсутствие фонового запроса; после прокрутки — ровно один запрос и реальные карточки. Времена и частичная недоступность источников записаны отдельно; они не маскируются.')
else:
    rows.append('- Браузерная проверка не выполнена; приёмка взаимодействий остаётся открытой.')
entry = '\n'.join(rows)
with open('roadmap.md', 'a') as file:
    file.write(entry)
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as file:
    file.write(entry)
