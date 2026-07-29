# VK Ads MCP

MCP-сервер для работы с официальным VK Ads API.

## Текущий статус

Сервер проходит MCP-инициализацию через локальный транспорт `stdio`. Реализованы OAuth2-менеджер токенов, клиент VK Ads API v1/v2/v3 и семьдесят семь публичных tool:

- `vk_ads_connection_check` проверяет подключение через `GET /api/v3/user.json`;
- `vk_ads_ad_plans_list` возвращает страницу рекламных кампаний и поддерживает `limit`, `offset` и фильтр по статусу;
- `vk_ads_ad_plan_get` возвращает одну рекламную кампанию по ID;
- `vk_ads_ad_groups_list` возвращает страницу групп объявлений с фильтрами и сортировкой;
- `vk_ads_ad_group_get` возвращает одну группу объявлений по ID;
- `vk_ads_banners_list` возвращает страницу объявлений с пагинацией и официальными фильтрами;
- `vk_ads_banner_get` возвращает безопасную сводку одного объявления по ID;
- `vk_ads_banner_create` создаёт объявление в существующей группе, перечитывает и проверяет его поля;
- `vk_ads_banner_update` обновляет объявление, перечитывает и проверяет изменённые поля;
- `vk_ads_banner_delete` удаляет объявление и подтверждает статус `deleted`;
- `vk_ads_banners_mass_action` транзакционно изменяет статусы до 200 объявлений и проверяет каждое;
- `vk_ads_banners_remoderate` отправляет объявления на перемодерацию, сохраняет индивидуальные результаты VK и перечитывает все цели;
- `vk_ads_content_html5_upload` загружает HTML5 ZIP-креатив и проверяет безопасные метаданные ответа;
- `vk_ads_content_static_upload` загружает JPG/PNG с исходными размерами и проверяет ответ VK;
- `vk_ads_content_video_upload` загружает MP4/MOV с исходными размерами и проверяет ответ VK;
- `vk_ads_remarketing_counters_list` возвращает доступные счётчики Top.Mail.Ru с фильтрами по ID и домену;
- `vk_ads_remarketing_counter_create` создаёт новый или подключает существующий счётчик Top.Mail.Ru и проверяет его повторным чтением;
- `vk_ads_remarketing_counter_get` возвращает один счётчик Top.Mail.Ru по его `counter_id`;
- `vk_ads_goals_list` возвращает сгруппированные цели для таргетинга и статистики;
- `vk_ads_remarketing_in_app_events_list` возвращает страницу мобильных приложений, трекеров и событий;
- `vk_ads_remarketing_offline_goals_list` возвращает списки офлайн-конверсий и статусы обработки;
- `vk_ads_remarketing_offline_goal_create` создаёт список офлайн-конверсий из CSV и проверяет его повторным чтением;
- `vk_ads_remarketing_offline_goal_update` переименовывает список и/или дозагружает CSV, затем проверяет результат;
- `vk_ads_remarketing_offline_goal_delete` удаляет список офлайн-конверсий и подтверждает отсутствие;
- `vk_ads_lead_form_logo_upload` загружает обязательный логотип лид-формы;
- `vk_ads_lead_forms_list` и `vk_ads_lead_form_get` читают лид-формы;
- `vk_ads_lead_form_create`, `vk_ads_lead_form_update` и `vk_ads_lead_form_copy` создают, изменяют и копируют лид-формы с контрольным чтением;
- `vk_ads_lead_forms_archive` и `vk_ads_lead_forms_unarchive` управляют архивным статусом лид-форм и проверяют каждую форму;
- `vk_ads_leads_list` возвращает метаданные лидов без контактных данных и ответов;
- `vk_ads_lead_form_leads_export` сохраняет персональные данные лидов непосредственно в новый локальный CSV/XLSX;
- `vk_ads_lead_form_test_lead_send` отправляет тестовый лид и требует подтверждения VK;
- `vk_ads_remarketing_users_lists_list` возвращает пользовательские списки ремаркетинга через v3;
- `vk_ads_remarketing_users_list_get` возвращает один пользовательский список по ID;
- `vk_ads_remarketing_users_list_create` загружает список из файла минимум с 2000 идентификаторами и проверяет его;
- `vk_ads_remarketing_users_list_update` переименовывает пользовательский список и проверяет результат;
- `vk_ads_remarketing_users_list_delete` удаляет пользовательский список через v3 и подтверждает отсутствие;
- `vk_ads_segments_list` и `vk_ads_segment_get` читают составные сегменты ремаркетинга;
- `vk_ads_segment_create`, `vk_ads_segment_update` и `vk_ads_segment_delete` выполняют полный жизненный цикл сегмента с контрольными чтениями;
- `vk_ads_segment_relations_list`, `vk_ads_segment_relations_create`, `vk_ads_segment_relation_update` и `vk_ads_segment_relation_delete` управляют источниками данных сегмента с проверкой результата;
- `vk_ads_sharing_keys_list`, `vk_ads_sharing_key_create` и `vk_ads_sharing_key_delete` читают, создают и удаляют ключи совместного доступа;
- `vk_ads_sharing_key_activate` активирует чужой ключ полностью или для выбранных источников;
- `vk_ads_local_geos_list` возвращает списки локальной географии и вложенные регионы;
- `vk_ads_local_geo_create` создаёт список локальной географии и проверяет его повторным чтением;
- `vk_ads_local_geo_update` полностью заменяет название и регионы списка локальной географии и проверяет результат;
- `vk_ads_local_geo_delete` удаляет список локальной географии и подтверждает отсутствие;
- `vk_ads_pricelists_list` возвращает страницу прайс-листов без URL источников и учётных данных;
- `vk_ads_pricelist_create` создаёт прайс-лист из API, URL, Ozon или Wildberries и проверяет его повторным чтением;
- `vk_ads_pricelist_batch_create` пакетно создаёт, полностью обновляет или удаляет товары API-прайс-листа и перечитывает созданные задачи;
- `vk_ads_pricelist_batch_get` возвращает статус пакетной задачи и безопасные агрегированные счётчики ошибок;
- `vk_ads_ad_group_create` создаёт группу объявлений, поддерживает package-зависимые поля и перечитывает результат;
- `vk_ads_ad_group_update` частично обновляет группу объявлений и перечитывает результат;
- `vk_ads_ad_group_delete` удаляет группу объявлений и подтверждает статус `deleted` повторным чтением;
- `vk_ads_ad_groups_mass_action` транзакционно обновляет до 200 групп и проверяет каждое значение;
- `vk_ads_ad_plan_create` создаёт обычную кампанию с вложенными группами, перечитывает результат и записывает обезличенный audit.
- `vk_ads_ad_plan_update` частично обновляет обычную кампанию по ID, выполняет preflight, перечитывает результат и записывает обезличенный audit.
- `vk_ads_ad_plans_mass_action` массово обновляет до 200 кампаний, выполняет preflight и контрольное чтение каждой цели.

Семьдесят четыре tools прошли отдельную успешную live-проверку через MCP. `vk_ads_banners_remoderate`, `vk_ads_remarketing_counter_create` и `vk_ads_remarketing_counter_get` остаются без успешного live-сценария. Полный цикл лид-форм, безопасный список лидов, CSV/XLSX-экспорт и отправка тестового лида прошли live; временные формы оставлены в архиве, поскольку API не предоставляет DELETE. VK подтвердил отправку тестового лида, но не включил его в обычный список лидов. Дневная и итоговая статистика офлайн-конверсий прошли live для аккаунтов, групп и кампаний. Итоговый tool сначала проверяет документированный `summary.json`, а при текущем `404 WRONG_RESOURCE` использует итоговый блок `total` из `day.json`; после исправления VK нативный ответ автоматически получит приоритет.

Используются:

- `@modelcontextprotocol/sdk` 1.30.0;
- Zod 4.4.3;
- Vitest 4.1.10.

## Требования

- Node.js 22 или новее;
- npm 10.9.8.

## Разработка

```bash
npm ci
npm run dev
```

Проверка типов, тесты и сборка:

```bash
npm run typecheck
npm test
npm run build
npm start
```

`stdout` зарезервирован только для MCP-протокола. Диагностические сообщения направляются в `stderr`.

## Токены VK Ads

Локальные данные авторизации хранятся в `auth.env`:

- `VK_ADS_CLIENT_ID`;
- `VK_ADS_CLIENT_SECRET`;
- `VK_ADS_TOKEN`;
- `VK_ADS_REFRESH_TOKEN`;
- `VK_ADS_TOKEN_EXPIRES_AT`.

Менеджер повторно использует действующий access-токен и обновляет его за 30 минут до истечения. Refresh выполняется строго по одному процессу за раз, а новая пара токенов записывается атомарно. Новый токен через `client_credentials` запрашивается только при полном отсутствии сохранённых токенов.

VK Ads разрешает не более пяти токенов на пару `clientId — user`. При `token_limit_exceeded` сервер не повторяет запрос и не удаляет токены автоматически.

`auth.env` содержит локальные секреты и не должен попадать в Git, npm-пакеты или логи.
