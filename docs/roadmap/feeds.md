# Фиды и расписания

Состояние 23.11.2026, 12:06 Asia/Krasnoyarsk. [Повтор Korea 45104426224](https://github.com/jeep-jim/AvtoCena/actions/runs/45104426224) после принятого PR 1804: архив и exact serving calculator проверены, collect skipped. На 12:01 шаг 29 выполняется без failed steps; новый публичный срез пока не подтверждён.

## Правила

Рынки должны обновляться независимо. Сохраняются принятые срезы, даты, цены, ручные значения, неизвестные параметры, полнота, provenance, lease/CAS. Ошибка источника не доказывает продажу. Японию и свежий Зелёный угол повторно не собирать. Ограничения источников — [source-policy.md](source-policy.md).

В PR 1803 итоговый audit ограничен целевым рынком. Полная изоляция ещё не внедрена: [контракт перехода](../operations/market-publication-isolation.md). Поручение 23.11: убрать произвольные фиксированные потолки памяти и общего размера корректного фида; [разбор и подготовленный патч](../operations/publication-memory.md).

## Последний сбор, хранилище и публикация

| Рынок | Получено и сохранено | Публикация этого сбора |
| --- | --- | --- |
| Китай | [Загрузка 45067305608](https://github.com/jeep-jim/AvtoCena/actions/runs/45067305608): 30 690 событий. [Подготовка 45072915347](https://github.com/jeep-jim/AvtoCena/actions/runs/45072915347): 283 583 наблюдения, replica и prepared archive в REG | Нет: verifier `mode:mirror`, `publicPublished:false`; автоматическое публичное продолжение не подключено |
| Корея | [45077320093](https://github.com/jeep-jim/AvtoCena/actions/runs/45077320093): 46 649 уникальных, 2 333 страницы; подготовка и REG archive подтверждены; artifact 14779553850 | Первый publisher OOM; восстановление 45104426224 идёт. API 11:38 / браузер 11:20: старый `gen_1794878284419_a611dfcf`, 46 862; до 160 л.с. — 139; у контрольных Morning/Seltos мощность неизвестна |
| ОАЭ | [45076401719](https://github.com/jeep-jim/AvtoCena/actions/runs/45076401719): 8 207 событий → 5 206 наблюдений → 4 870 уникальных; completed intake и REG archive подтверждены | Нет: `serving_read_model_byte_bound`, прежний manifest сохранён |
| Европа | [45076867904](https://github.com/jeep-jim/AvtoCena/actions/runs/45076867904): 2 890 наблюдений AutoScout с 201 страницы; completed intake и REG archive подтверждены | Publish job failed; точная причина последнего отказа в полученных журналах не установлена |
| Грузия | [45076431110](https://github.com/jeep-jim/AvtoCena/actions/runs/45076431110): AutoPapa 13, MyAuto 0; частичный archive в REG, `completed:false` | Пропущена. У обоих источников `list_failed`; неполный сбор нельзя выдавать за обновление |
| Япония | Нового ночного сбора не обнаружено; свежий archive отдельно не проверялся | Нового ночного запуска публикации не обнаружено; текущий срез не трогать |
| Зелёный угол | [45077330661](https://github.com/jeep-jim/AvtoCena/actions/runs/45077330661): 509 исходных → 503 в проверенном срезе | Да: 23.11 05:23 UTC+7, запись и readback; внеплановый повтор не нужен |

REG подтверждён первичными журналами записи/проверки перечисленных запусков; отдельное прямое чтение всего REG не выполнялось. Не смешивать наблюдения/события и количество уникальных машин, а также сбор и публикацию.

## Расписание

Источник: `scripts/lib/catalog-refresh-schedule.mjs` и текущие `catalog-refresh-<market>.yml`. Cron проверяется ежедневно; календарный interval guard решает, наступил ли день. Переключатели владельца сохраняются.

| Рынок | Интервал | Ближайшее разрешённое окно UTC+7 |
| --- | --- | --- |
| Китай | Ежедневно | 23.11, 21:00 |
| Корея, ОАЭ, Грузия | 2 дня | 25.11, 00:00 |
| Европа, Зелёный угол | 3 дня | 26.11, 00:00 |
| Япония | В проверенных текущих workflows/queue нет автоматического cron | Не установлено |

Срабатывание расписания подтверждено ночными runs. Успешная публикация всех рынков по расписанию пока не достигнута.

## Что сделано и что дальше

Приняты [PR 1801](https://github.com/jeep-jim/AvtoCena/pull/1801), [1802](https://github.com/jeep-jim/AvtoCena/pull/1802), [1803](https://github.com/jeep-jim/AvtoCena/pull/1803), [1804](https://github.com/jeep-jim/AvtoCena/pull/1804). Их успешный CI не означает публикацию данных или установку runtime. Сайт остаётся на `22867cbcfaee27b2e8917b6bf880e44827f67b60`; main целиком не выпускать.
Приняты [1806](https://github.com/jeep-jim/AvtoCena/pull/1806) (защита UAE cursor) и [1808](https://github.com/jeep-jim/AvtoCena/pull/1808) (точный read-only saved-feed probe); сам probe ещё не запускали. Это не подтверждает восстановление UAE.
[1805](https://github.com/jeep-jim/AvtoCena/pull/1805) (`30e587e`) green, merge удержан до Korea. [1810](https://github.com/jeep-jim/AvtoCena/pull/1810) теперь `7d9ba69`; новый [CI 45114659977](https://github.com/jeep-jim/AvtoCena/actions/runs/45114659977) идёт, прежний `767c357` — 3 447 PASS. Merge запускает current-read-models writer, поэтому не пересекать с Korea. [1811](https://github.com/jeep-jim/AvtoCena/pull/1811) принят, CI 3 446 PASS; producer/public China generation ещё не обновлены.

1. Дождаться текущего восстановления Korea `45104426224`; проверить terminal job, `published`/`publicationError`, generation, `technicalFieldCoverage` и `freshOfferAudit`, затем Morning 76/998, Seltos 193/1598 и фильтр до 160 л.с. на сайте. Не складывать 46 649 новых наблюдений с прежними 46 862 публичными строками; итог берётся из принятого отчёта. Не запускать дубликат и не менять runtime 22867.
2. Повторять UAE/Europe из сохранённого завершённого intake после исправления причины, сохраняя все проверки и CAS. Общая независимость рынков остаётся открытой.
3. Китай: ветка `fix/china-publication-source-20261122`, SHA `b209f4f27ad84eae2878c4535e0daa269593a981`, 15 адресных тестов PASS. Adapter только подготавливает проверенный вход; native admission, active/retirement proof, price seal, private preview и CAS ещё нужны. Индекс — [performance.md](performance.md).
4. Грузия: bridge возвращает 502 после `fetch_failed`; это не доказательство блокировки поставщика. Уточнить безопасные `error.name`/`cause.code` worker до повторного сбора.
5. Overview последнего запуска подготовлен для старого поколения на 23/24/25 ноября. Общая подготовка цен завершилась `publication_in_progress`; ускорение всех фильтров и страниц не подтверждено.

[Prepared power census](../audits/2026-11-23-korea-prepared-power-coverage.json): 46 649 unique / 46 073 hp. Из 576 без mapped hp: 311 missing, 218 total/ICE conflict, 47 identity conflict; у 263 source total hp exact. Нельзя приписывать все пропуски поставщику. Новый B4 mapper patch готовится отдельно, frozen recovery его не получает.
