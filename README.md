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

- эффектная главная страница с главным полем «Ваш бюджет»;
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

## Основные папки

```text
apps/web      сайт + PWA + Mini App интерфейс + CRM
apps/bot      Telegram bot
packages      общие модули
data          JSON-база знаний
```

## Команды

```bash
npm run dev       # сайт
npm run dev:bot   # бот
npm run build     # production build
```
