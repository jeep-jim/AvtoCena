# Автоблог, 8 ноября 2026

Подготовлены десять самостоятельных материалов: семь свежих новостей и технических разборов официальных публикаций от 29 октября — 6 ноября 2026 года и три явно помеченных архивных разбора. Темы не повторяют 72 прежние статьи.

1. **Уникальный Mercedes-AMG SL для чемпионки WTA: чем он отличается от серийного** — https://media.mercedes-benz.com/article/7b6a5489-30aa-4af9-ba84-f00d22bab0b7
2. **Новый KD-центр Mazda: как детали отправляют на зарубежные заводы** — https://newsroom.mazda.com/en/publicity/release/2026/202611/261106a.html
3. **Honda SENSING RIDE: десять помощников для мотоцикла и границы их возможностей** — https://global.honda/en/newsroom/news/2026/2261103beng.html
4. **Forefront от Renault и John Cockerill: что умеет концепт беспилотной платформы** — https://media.renaultgroup.com/renault-group-and-john-cockerill-unveil-forefront-concept-an-innovative-approach-in-the-field-of-unmanned-ground-vehicles-for-the-most-demanding-missions/?lang=eng&page=1&type=image
5. **Opel STX Concept в Цюрихе: зачем универсалу подвижная аэродинамика** — https://www.media.stellantis.com/em-en/opel/press/opel-at-auto-zuerich-2026-opel-stx-concept-gse-27fe-and-corsa-gse-celebrate-swiss-debuts
6. **Kia Seltos Hybrid и e-AWD: какие функции нельзя подтверждать одним названием** — https://worldwide.kia.com/en/newsroom/view?id=161954
7. **Volkswagen ID. Cross с батареей 37 кВт·ч: как оценивать 324 км запаса хода** — https://www.volkswagen-newsroom.com/en/press-releases/affordable-and-versatile-id-cross-can-now-be-ordered-with-a-37-kwh-battery-20754
8. **Пятый BMW X5 и пять типов привода: какие версии выходят не одновременно** — https://www.press.bmwgroup.com/global/article/detail/T0458636EN/the-new-bmw-x5?language=en
9. **Почему гладкий кузов Nissan Kicks потребовал точности до долей миллиметра** — https://www.nissan-global.com/EN/STORIES/RELEASES/new-kicks-design/
10. **Volvo Digital Key Plus: почему совместимость телефона и региона важнее названия опции** — https://www.volvocars.com/uk/news/how-to-use-and-set-up-a-digital-key/

## Каталог и иллюстрации

Живой API каталога подтвердил по одному автомобилю семейств Mercedes-Benz SL и BMW X5. В статьях прямо указано, что это другие версии и поколения; точное наличие описываемых новинок не заявляется. Последующие запросы к кандидатам завершились тайм-аутом без тела ответа, поэтому ссылки и утверждения о наличии для них не добавлены.

Девять обложек получены с официальных медиаресурсов производителей. Для Volvo использована фотография Vauxford с Wikimedia Commons по лицензии CC BY-SA 4.0; она явно обозначена как иллюстрация модели, а не подтверждение опции. Все десять JPEG декодированы, проверены визуально и зафиксированы по SHA-256.

## Публикационный статус

В пакет добавлены только десять новых slug; прежние 72 записи не изменены. Подготовлены 10 адаптаций для Дзена и 10 для VK. Подтверждённых подключённых каналов в текущем доступе нет, поэтому внешняя публикация не выполнялась.

Локально пройдены `blog.test.ts` 2/2, полный TypeScript typecheck, production build Next.js, проверка JSON/уникальности/HTTPS-источников/десяти обложек и `git diff --check`. Фактический server render `BlogBody` проверен для всех десяти статей: 30/30 заголовков `h2` отделены от абзацев.

## Установка и публичная проверка

PR [#1722](https://github.com/jeep-jim/AvtoCena/pull/1722) прошёл три обязательные проверки и вошёл в `main` с merge SHA `463fd22559a2f9c5acd60f8f5e4b269689215c84`. Единственный production-deploy [42435996958/128594981415](https://github.com/jeep-jim/AvtoCena/actions/runs/42435996958) завершился `SUCCESS`; второй app-deploy не запускался.

`/api/health` вернул HTTP 200 и точный `releaseSha` `463fd22559a2f9c5acd60f8f5e4b269689215c84`. На установленном релизе проверены 10/10 страниц: заголовки, описания, canonical, JSON-LD, 30 редакционных `h2`, последние абзацы и ссылки на источники. Десять обложек вернули HTTP 200 и побайтно совпали с локальными файлами по SHA-256. Семь страниц индекса содержат 82 уникальных slug; все десять новых публикаций присутствуют в индексе и sitemap.

Индекс блога фактически осмотрен в облачном браузере в светлой и тёмной темах. Статья Volvo проверена после полной отрисовки: обложка, атрибуция, три раздела, ограничение UWB для России и оба источника присутствуют. Машиночитаемые результаты находятся в `deployment-2026-11-08.json` и `live-check-2026-11-08.json`.

Внешних публикаций 0: подтверждённых подключённых каналов Дзена или VK нет. Подготовленные 20 адаптаций сохранены, отправка от имени АвтоЦены во внешние сервисы не выполнялась.
