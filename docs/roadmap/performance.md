# Скорость фильтров и страниц

Обновлено: 22.11.2026, Asia/Krasnoyarsk. Подготовленные ускорения не установлены; скорость всех страниц на production не подтверждена.

## Точная база и измерения

Live: `22867cbcfaee27b2e8917b6bf880e44827f67b60`. Исходный main: `702c7c85efb2a8d953f7e1c72f6f4713070d61d5`. Они различаются; весь main выпускать нельзя. Runtime изменения подготовлены от точного live.

| Путь | Проверенный факт | Подготовленное изменение |
| --- | --- | --- |
| Главная и `/api/catalog/home` | 50 карточек, 699 555 bytes; вложенные служебные provenance | Payload 425 026 bytes: минус 274 529, или 39,2%; значения и статусы evidence сохранены |
| Китай, `powerTo=160` | Последовательное чтение всех projection parts; запрос из рабочей среды не ответил за 45 секунд | Компактный индекс, связанный с generation и marketDigest |
| Корея, широкий фильтр | Selector без specificationFilterVersion=1 читает все budget-card blocks | Проверить законченный writer и подготовленные selectors; ошибка не должна становиться пустой выдачей |

В одном home-ответе Server-Timing: read 1055,5 ms, pricing 310,8 ms; полное время из рабочей среды 9,318 s. Сетевые времена среды не являются серверными измерениями. Сокращение payload ещё не доказывает ускорение всех страниц.

## Отдельный выпуск главной

Ветка `fix/home-ui-only-20261122`, [SHA c1622514c73e78ee798ae321c242174aef71706c](https://github.com/jeep-jim/AvtoCena/commit/c1622514c73e78ee798ae321c242174aef71706c). Source closure: 6 359 записей, совпадает с live 22867. Девять адресных тестов и TypeScript web/engine PASS.

Расчётный идентификатор исходников начинается с `672958`, установленного serving — с `465438`; они не взаимозаменяемы. Проверка должна различать source calculationVersion и serving calculationVersion.

Отключённый draft controller: ветка `work/home-ui-controller-20261122`, [SHA a0dfe407b18b9921e47e9350415424e50ac0bb58](https://github.com/jeep-jim/AvtoCena/commit/a0dfe407b18b9921e47e9350415424e50ac0bb58), с source proof. Запуска ещё нет.

## Индекс Китая

Runtime: `fix/runtime-speed-20261122`, [HEAD 7d43879159d4e68e3c741aeaee14027595052370](https://github.com/jeep-jim/AvtoCena/commit/7d43879159d4e68e3c741aeaee14027595052370); 16 адресных тестов и TypeScript PASS. Producer: `fix/china-filter-producer-20261122`, [HEAD fdb1bc1b98c97256e7b94988aeeeab996f2f9e4b](https://github.com/jeep-jim/AvtoCena/commit/fdb1bc1b98c97256e7b94988aeeeab996f2f9e4b); четыре integration tests PASS.

`prepared-china-filter-index.ts` хранит нормализованные параметры и позиции без фотографий/полных записей. Ref входит в проверенную Directory. Повреждённый заявленный индекс отвергается; старые срезы без ref и неподдержанные запросы сохраняют прежний корректный путь.

Локальная проверка: 17 000 записей, ready и три компактных объекта для выбора страницы; совпадение карточек, порядка и total по 13 сочетаниям фильтров и четырём страницам. Новый публичный snapshot с индексом ещё не подготовлен. Для публикации нужны этапы из [документа фидов](feeds.md).

## Следующий шаг и приёмка

1. Завершить review отдельного home controller и source proof; выполнить предусмотренные проверки точного release, serving calculationVersion и отката перед единственным выпуском главной.
2. Подготовить независимый China snapshot с индексом; проверить native admission, полный active/retirement proof, frozen rates, price seal, readback карточек и всех заявленных фильтров, затем CAS одного China control.
3. После установки измерить полный полезный ответ и взаимодействия до/после: главная, рынок, марка/модель/год, мощность, пагинация, карточка. Сохранить город, counts, Back/scroll, неизвестные параметры и текущие карточки при ожидании.

Соблюдать `docs/operations/performance-contract.md`. Не считать unit-тесты, HTTP 200, ранний HTML или один тёплый ответ доказательством скорости всех страниц.

23.11, 14:18 UTC+7. [Подсчёт по действующему срезу Китая в REG](https://github.com/jeep-jim/AvtoCena/actions/runs/45129166147) дал 64 605 до 160 л.с. из 168 662. [Исправление выдачи](https://github.com/jeep-jim/AvtoCena/pull/1819) охватывает ссылки дилера с source=existing, ограниченный предпросмотр в общем каталоге и постраничный вывод. Приёмка на публичном сайте остаётся открытой.
