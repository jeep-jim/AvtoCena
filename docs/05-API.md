# API

## Public

```text
POST /api/cpa
```

Записывает события `visit` и `calculation_completed` без персональных данных.

```text
POST /api/leads
```

Создаёт клиента, заявку, событие CRM и CPA-событие. Сохраняет `ref`, `click_id`, `sub1–sub5`, UTM-метки и параметры расчёта.

```text
GET /api/avtocena
GET /api/health
```

## CRM

```text
GET /api/crm/clients
POST /api/crm/clients
PATCH /api/crm/leads/:id
```

`PATCH /api/crm/leads/:id` позволяет назначить менеджера, изменить статус и добавить внутренний комментарий.

## CPA

```text
GET /api/cpa
GET /api/cpa/postback
```

GET-документация закрыта авторизацией или CPA-ключом. Публичным остаётся только POST для трекинга переходов и расчётов.
