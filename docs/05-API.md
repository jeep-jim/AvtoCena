# API

## Public tracking

```text
POST /api/cpa
```

Публичный browser-to-server трекинг событий `visit` и `calculation_completed`. Записывает только атрибуцию и технические параметры без персональных данных.

Поддерживаются:

```text
clickId
externalClickId
partnerRef
sub1-sub5
utmSource
utmMedium
utmCampaign
utmContent
utmTerm
```

События дедуплицируются по типу события, внутреннему `clickId` и `calculationKey`.

```text
POST /api/leads
```

Создаёт клиента, заявку, событие CRM и CPA-событие. Сохраняет полную атрибуцию, параметры расчёта и источник заявки.

```text
GET /api/avtocena
GET /api/health
```

## Protected reads

```text
GET /api/leads
GET /api/cpa
GET /api/partners
```

Доступны только соответствующим внутренним ролям или по CPA-ключу. Персональные данные лидов не выдаются публично.

## CRM

```text
GET /api/crm/clients
POST /api/crm/clients
PATCH /api/crm/leads/:id
```

`PATCH /api/crm/leads/:id` позволяет назначить менеджера, изменить статус и добавить внутренний комментарий. Для статусов `rejected` и `duplicate` причина обязательна.

Изменение статуса формирует запись в `data/cpa/events*.json` со статусом доставки `pending` для трафика с внешней CPA/реферальной атрибуцией. Отправку в конкретную сеть выполняет будущий сетевой адаптер.

## CPA postback receiver

```text
GET /api/cpa/postback
```

Закрытый технический endpoint для приёма тестовых или внешних postback-событий по секрету. Исходящие S2S-postback в CPA-сети будут вынесены в отдельные адаптеры сетей.
