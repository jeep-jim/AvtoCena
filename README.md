# AvtoCena

АвтоЦена — авто под ваш бюджет за 30 секунд.

Проект собран как JSON-first монорепозиторий: сайт, PWA, Telegram Mini App интерфейс, CRM, партнёрка и CPA API используют одну структуру данных.

## Быстрый старт

```bash
npm install
npm run dev
```

Открыть:

```text
http://localhost:3000
```

## Что уже есть в этом этапе

- эффектная главная страница с главным полем бюджета;
- выдача `/results` с вариантами АвтоЦены;
- API расчёта `/api/avtocena`;
- внутренняя CRM `/crm`;
- кабинет партнёра `/partner`;
- лендос партнёрки `/partner/landing`;
- страница CPA API `/partner/api` и JSON `/api/cpa`;
- пример расчёта Audi A3 Sportback из Китая в `data/examples/avtocena-cases.json`;
- сквозная атрибуция `ref / click_id / sub1–sub5 / UTM`;
- создание заявки из выдачи и появление её в CRM;
- назначение менеджера, статусы и внутренние комментарии;
- обезличенное отображение заявок в кабинете партнёра;
- автоматические JSON-чанки по 500 записей.

## Живой каталог

Каталог импортирует автомобили только из открытых публичных страниц и JSON-источников, без пользовательских аккаунтов и обхода авторизации:

- Корея — Encar;
- Китай — Che168 Global;
- Япония — BE FORWARD, склад в Японии;
- ОАЭ — BE FORWARD, склад в UAE;
- Европа — BE FORWARD, склады Великобритании и Бельгии.

Импорт запускается вручную или автоматически каждые 6 часов через `.github/workflows/catalog-production-import.yml`. Данные, фотографии, индексы, состояние сканирования и отчёты сохраняются в JSON/Object Storage. Каждый источник имеет отдельный курсор, health-файл, лимиты и блокировку при ошибках.

## Основные папки

```text
apps/web      сайт + PWA + Mini App интерфейс + CRM
apps/bot      Telegram bot
packages      общие модули
data          JSON-база знаний
```

## Команды

```bash
npm run dev                    # сайт
npm run dev:bot                # бот
npm run build                  # production build
npm run catalog:smoke          # проверка Encar
npm run catalog:import:sample  # небольшой импорт всех публичных рынков
```
