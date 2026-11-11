import datetime
import json
import os
import pathlib

root = pathlib.Path.cwd()
run = os.environ['GITHUB_RUN_ID']
url = 'https://github.com/jeep-jim/AvtoCena/actions/runs/' + run
date = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).strftime('%d.%m.%Y, %H:%M')
receipt = None
log = root / 'owner-bot-block-run.log'
for line in log.read_text().splitlines() if log.exists() else []:
    if line.startswith('OWNER_BOT_BLOCK_ACTIVE '):
        receipt = json.loads(line.split(' ', 1)[1])
public_file = root / 'owner-bot-block-public.json'
public = json.loads(public_file.read_text()) if public_file.exists() else None
passed = bool(receipt and public and public.get('publicVerified'))
if passed:
    summary = '''- Завершённый откат подтверждён: production `463fd22559a2f9c5acd60f8f5e4b269689215c84`, исходная сборка 08.11.2026, 12:00–16:00 по Новокузнецку. Первоначальное закрепление — run42855543854, SUCCESS 10.11 в23:33 местного времени. Повторного развёртывания не потребовалось.
- По новому прямому поручению владельца в Nginx заблокированы Amazonbot и Reflectionbot: case-insensitive User-Agent и официальные адреса (Amazonbot1292 адреса, Reflectionbot2 сети /23). Для этих ботов /robots.txt возвращает Disallow:/, остальные пути HTTP403 до приложения. Произвольные AWS/OVH/пользовательские сети со скриншота не блокировались без подтверждения принадлежности ботам.
- Проверки: изолированный Nginx — имена/адреса/robots/обычные посетители/Google/Yandex/поддельный X-Forwarded-For; nginx -t; origin и внешние запросы — обе блокировки403, robots200 с запретом, обычный посетитель/Google/Yandex health200/exact463. Контейнер, image, StartedAt и upstream не изменились, приложение не перезапускалось.
- Официальные списки и их контрольные суммы сохранены в .github/owner-bot-block; резервная конфигурация и receipt на сервере /opt/avtocena/owner-bot-blocks/''' + run + '''/. Никакой автоматической задачи обновления блокировок не добавлялось.
- Все19 существующих расписаний сохранены побайтно. Код приложения, каталог, фильтры, цены, данные CRM/фидов и штатные deployment gates не менялись. Заморозка доработок и пауза автоблога остаются действующими.
- Это подтверждение отката и блокировки, не заявление об исправлении прежнего отказа каталога Европы или доказанное измерение ускорения сайта.
'''
else:
    summary = ('- Выполнено новое поручение по подготовке блокировки Amazonbot/Reflectionbot. '
               'Полная внешняя проверка не подтверждена; не объявлять блокировку завершённой.\n'
               '- Успешный server receipt: ' + str(bool(receipt)) + '; public verification: ' + str(bool(public)) + '.\n'
               '- До этой операции живой /api/health подтвердил historical463; повторный app deploy не выполнялся. '
               'Обычные фиды и заморозка приложения сохранены. Изучить точный результат запуска, не повторять вслепую.\n')
entry = '\n\n### ' + date + ' Новокузнецк — откат 8 ноября и блокировка ботов\n\n' + summary + '- [Проверка и применение](' + url + ').\n'
with (root / 'roadmap.md').open('a') as stream:
    stream.write(entry)
incident = root / 'docs/operations/current-incident.md'
incident.write_text('# Текущий результат — ' + date + ' Новокузнецк\n\n' + summary + '\n[Запуск](' + url + ')\n\n## Предыдущие записи — история\n\n' + incident.read_text())
if receipt:
    evidence = root / 'docs/operations/2026-11-11-owner-bot-block.json'
    evidence.write_text(json.dumps({'runUrl': url, 'server': receipt, 'public': public}, indent=2) + '\n')
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
    stream.write(entry)
