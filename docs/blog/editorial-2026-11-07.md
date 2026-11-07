# Автоблог, 7 ноября 2026

Подготовлены десять самостоятельных материалов: пять свежих разборов официальных публикаций от 21 октября — 4 ноября 2026 года и пять явно помеченных архивных технических разборов. Темы не повторяют 62 прежние статьи. Все факты и даты сверены по первоисточникам производителей.

1. **Стекло вместо экрана и преобразователь на 800 В: что исследует Mercedes-Benz** — https://media.mercedes-benz.com/en/article/013b1ae2-a880-41b0-9919-1908356d5741
2. **22 кВт переменного тока в Opel Grandland Electric: когда это действительно ускоряет зарядку** — https://www.media.stellantis.com/em-en/opel/press/opel-grandland-electric-first-opel-passenger-car-with-a-22-kw-on-board-charger
3. **Nissan Elgrand получил японскую награду: что она говорит о машине, а что нет** — https://global.nissannews.com/en/releases/261104-01-e?origin=channel-NNG243 ; https://global.nissannews.com/en/releases/all-new-elgrand-launched-in-japan
4. **Google Gemini в новой Mazda CX-5: что придёт по воздуху и что потребуется владельцу** — https://newsroom.mazda.com/en/publicity/release/2026/202610/261027a.html
5. **Renault Trafic обновили тормоза и мультимедиа: какие цифры стоит проверить** — https://nl.media.renaultgroup.com/renault-trafic-vernieuwd-met-meer-comfort-veiligheid-en-technologie/
6. **Nissan Rogue e-POWER: почему бензиновый двигатель не приводит колёса** — https://global.nissannews.com/en/releases/all-new-2027-nissan-rogue-hybrid-debuts-in-the-us
7. **Ford Ranger PHEV как источник энергии: что означают 2,3 и 6,9 кВт** — https://www.fromtheroad.ford.com/eur/en/articles/2024/ranger-phev ; https://media.ford.com/content/dam/fordmedia/Europe/en/2025/07/ProPowerOnboard/Ranger_PHEV_Pro_Power_Onboard_graphic_blue.pdf
8. **MB.DRIVE ASSIST PRO в городе: почему Level 2 не делает Mercedes беспилотным** — https://media.mercedes-benz.com/en/article/a05b5ec5-ce60-48cc-95ba-8fab86012b48
9. **Миллион BMW без водителя — внутри заводов: где заканчивается автоматизация** — https://www.press.bmwgroup.com/global/article/detail/T0462233EN/one-million-vehicles-moved-without-drivers%3A-bmw-group-successfully-scales-automated-driving-in-production ; https://www.press.bmwgroup.com/global/article/detail/T0446493EN/high-tech-in-production%3A-bmw-group-enables-automated-driving-for-new-vehicles?language=en
10. **Тепловой насос Toyota C-HR+: как обогрев салона связан с запасом хода** — https://media.toyota.co.uk/the-all-new-battery-electric-toyota-c-hr/

## Каталог и иллюстрации

Каталог проверен через рабочий API. Точные ссылки добавлены для Opel Grandland Electric (4), Mazda CX-5 (25, с предупреждением о поколении), Renault Trafic (13) и Ford Ranger PHEV (1). Для Elgrand, Rogue Hybrid и C-HR+ наличие не подтверждено; похожие модели не подставлялись.

Все десять обложек — локальные JPEG с официальных медиапорталов производителей. Файлы декодированы, проверены контактным листом и имеют SHA-256 в media-check. Атрибуция находится в каждой статье.

## Публикационный статус

В пакет добавлены только новые slug; прежние 62 записи сохранены побайтно до добавления. Подготовлены 10 адаптаций для Дзена и 10 для VK. Подтверждённых подключённых каналов в текущем доступе нет, поэтому внешняя публикация не выполнялась.

Локально пройдены `blog.test.ts` 2/2, полный TypeScript typecheck и `git diff --check`. Фактический server render `BlogBody` проверен для всех десяти статей: 30/30 заголовков `h2` отделены от абзацев. Статус CI, PR, установки и публичной проверки дополняется после каждого фактического этапа; сам файл не является доказательством публикации.
