export type ToolAccess = "read" | "write";
export type ToolVerificationStatus = "planned" | "implemented" | "docs_verified" | "live_read_verified" | "live_write_verified";

export interface CatalogTool {
  name: string;
  title: string;
  category: string;
  access: ToolAccess;
  status: ToolVerificationStatus;
}

const implemented = new Set([
  "vk_recover_token_limit",
  "vk_status", "vk_get_ad_plans", "vk_get_campaigns", "vk_get_ad_groups", "vk_get_banners",
  "vk_create_ad_plan", "vk_update_ad_plan", "vk_delete_ad_plan",
  "vk_update_banner",
  "vk_manage_banners",
  "vk_remoderate_banners",
  "vk_get_statistics", "vk_get_packages", "vk_get_currencies",
  "vk_get_ad_plan", "vk_get_campaign", "vk_get_ad_group", "vk_get_banner", "vk_get_urls", "vk_create_url", "vk_create_banner", "vk_get_banner_patterns", "vk_get_remarketing_counters",
  "analytics_compare_periods", "analytics_rank_campaigns", "analytics_find_inefficient_campaigns", "analytics_recommendations", "analytics_anomalies", "analytics_delivery_issues", "analytics_account_audit", "vk_get_offline_conversions", "vk_get_realtime_stats",
  "vk_get_throttling", "vk_get_targetings_tree", "vk_get_pads_tree", "vk_get_mobile_categories", "vk_get_mobile_os", "vk_get_mobile_operators", "vk_get_mobile_types", "vk_get_mobile_vendors", "vk_get_inapp_events", "vk_get_inapp_stats", "vk_get_segments", "vk_get_segment", "vk_get_local_geos",
  "vk_get_remarketing_lists",
  "vk_get_inapp_event_categories", "vk_update_inapp_event_category", "vk_get_lead_forms",
  "vk_get_leads",
  "vk_update_lead_form",
  "vk_export_leads", "survey_respondents_export",
  "vk_get_reach_forecast",
  "vk_get_mobile_apps",
  "vk_get_mobile_app_users",
  "vk_get_sharing_keys",
  "lead_form_details_get", "survey_form_details_get", "respondents_list",
  "lead_form_copy", "survey_form_copy", "lead_forms_archive_manage", "survey_forms_archive_manage", "lead_form_image_upload",
  "user_geo_search", "ord_user_status_get", "ord_partner_pads_list", "ord_partner_pad_get", "ord_partner_subagents_list", "ord_partner_subagent_get", "ord_partner_acts_list", "ord_partner_act_stat_get", "ord_agency_acts_list", "ord_agency_client_acts_list", "ord_agency_report_list", "ord_agency_status_get",
  "agency_client_get", "agency_manager_client_get", "inapp_event_get", "subscription_details_get",
  "offer_batch_task_get",
  "vk_resolve_url", "url_id_resolve_v1",
  "vk_get_goal_statistics", "vk_get_search_phrases",
  "vk_get_video_report",
  "vk_manage_campaigns",
  "vk_manage_ad_groups",
  "vk_get_regions", "vk_get_goals",
  "vk_get_agency_clients", "vk_get_manager_clients",
  "vk_get_user", "vk_get_banner_fields",
  "vk_export_csv",
  "vk_create_ad_group", "vk_delete_ad_group",
  "vk_update_ad_group",
  "vk_upload_image", "vk_upload_html5",
  "vk_upload_video",
  "vk_export_xlsx",
  "vk_get_package",
  "vk_get_package_fields",
  "vk_get_packages_pads",
  "vk_get_remarketing_counter", "vk_update_remarketing_counter", "vk_delete_remarketing_counter", "vk_delete_remarketing_counter_v2", "remarketing_counter_connect_existing",
  "vk_delete_banner", "subscription_delete", "subscription_create", "apple_app_metadata_refresh", "google_app_metadata_refresh", "agency_client_update", "agency_client_delete", "user_profile_update", "manager_client_update", "manager_client_delete", "ord_partner_acts_update", "ord_partner_pad_update", "ord_partner_subagent_create", "ord_partner_subagent_update", "billing_transfer_to_client",
  "vk_get_counter_goals", "vk_create_counter_goal", "vk_update_counter_goal",
  "vk_get_remarketing_list",
  "vk_create_segment", "vk_create_pricelist",
  "vk_update_segment",
  "vk_delete_segment",
  "vk_manage_segment_relations",
  "vk_select_client",
  "vk_create_remarketing_list", "vk_create_remarketing_list_v3", "vk_create_offline_goal", "offline_goal_delete", "offline_goal_update", "vk_update_remarketing_list", "vk_update_remarketing_list_v3", "vk_delete_remarketing_list", "vk_delete_remarketing_list_v3",
  "vk_connect_client",
  "vk_manage_local_geo",
  "banner_preflight",
  "ad_plan_preflight",
  "ad_group_preflight",
  "lead_form_test_lead_send", "sharing_key_create", "sharing_key_revoke", "skadnetwork_ids_share", "skadnetwork_ids_withdraw",
  "vk_discover_communities", "vk_analyze_communities", "vk_score_communities", "vk_export_community_candidates",
]);

const definitions: Array<[string, string, string, ToolAccess]> = [
  ["vk_recover_token_limit", "Восстановить лимит токенов", "Статус", "write"],
  ["vk_status", "Статус подключения", "Статус", "read"],
  ["vk_get_user", "Профиль кабинета", "Статус", "read"], ["vk_get_throttling", "Лимиты API", "Статус", "read"],
  ["vk_get_ad_plans", "Список рекламных планов", "Кампании", "read"], ["vk_get_ad_plan", "Рекламный план по ID", "Кампании", "read"], ["vk_create_ad_plan", "Создать рекламный план", "Кампании", "write"], ["vk_update_ad_plan", "Изменить рекламный план", "Кампании", "write"], ["vk_delete_ad_plan", "Удалить рекламный план", "Кампании", "write"],
  ["vk_get_campaigns", "Список кампаний API", "Кампании", "read"], ["vk_get_campaign", "Кампания по ID", "Кампании", "read"], ["vk_create_campaign", "Создать кампанию", "Кампании", "write"], ["vk_update_campaign", "Изменить кампанию", "Кампании", "write"], ["vk_manage_campaigns", "Массовое управление кампаниями", "Кампании", "write"],
  ["vk_get_ad_groups", "Список групп", "Группы", "read"], ["vk_get_ad_group", "Группа по ID", "Группы", "read"], ["vk_create_ad_group", "Создать production-группу", "Группы", "write"], ["vk_update_ad_group", "Изменить production-группу", "Группы", "write"], ["vk_delete_ad_group", "Удалить production-группу", "Группы", "write"], ["vk_manage_ad_groups", "Массовое управление production-группами", "Группы", "write"],
  ["vk_get_banners", "Список объявлений", "Объявления", "read"], ["vk_get_banner", "Объявление по ID", "Объявления", "read"], ["vk_get_urls", "Ссылки по ID", "Объявления", "read"], ["vk_resolve_url", "Разобрать URL", "Объявления", "read"], ["url_id_resolve_v1", "Получить технический ID ссылки", "Объявления", "read"], ["vk_create_url", "Зарегистрировать URL", "Объявления", "write"], ["vk_update_banner", "Изменить объявление", "Объявления", "write"], ["vk_delete_banner", "Удалить объявление", "Объявления", "write"], ["vk_manage_banners", "Массовое управление объявлениями", "Объявления", "write"], ["vk_get_banner_patterns", "Шаблоны баннеров", "Объявления", "read"], ["vk_get_banner_fields", "Поля баннеров", "Объявления", "read"], ["vk_remoderate_banners", "Повторная модерация", "Объявления", "write"],
  ["vk_create_banner", "Создать объявление", "Объявления", "write"],
  ["vk_upload_image", "Загрузить изображение", "Контент", "write"], ["vk_upload_html5", "Загрузить HTML5-креатив", "Контент", "write"], ["vk_upload_video", "Загрузить видео", "Контент", "write"], ["vk_delete_async_report", "Удалить async-отчёт", "Отчёты", "write"],
  ["vk_get_statistics", "Статистика", "Статистика", "read"], ["vk_get_goal_statistics", "Статистика целей", "Статистика", "read"], ["vk_get_search_phrases", "Поисковые фразы", "Статистика", "read"], ["vk_get_video_report", "Видеоотчёт", "Статистика", "read"], ["vk_get_inapp_stats", "In-app статистика", "Статистика", "read"], ["vk_get_offline_conversions", "Офлайн-конверсии", "Статистика", "read"], ["vk_get_realtime_stats", "Realtime статистика", "Статистика", "read"],
  ["vk_get_mobile_apps", "Мобильные приложения", "Mini Apps", "read"], ["vk_get_mobile_app_users", "Связанные мобильные приложения", "Mini Apps", "read"], ["vk_get_inapp_events", "In-app события", "Mini Apps", "read"], ["vk_get_inapp_event_categories", "Категории in-app", "Mini Apps", "read"], ["vk_update_inapp_event_category", "Изменить категорию in-app", "Mini Apps", "write"],
  ["vk_get_regions", "Регионы", "Справочники", "read"], ["vk_get_mobile_categories", "Категории приложений", "Справочники", "read"], ["vk_get_mobile_os", "ОС устройств", "Справочники", "read"], ["vk_get_mobile_operators", "Операторы", "Справочники", "read"], ["vk_get_mobile_types", "Типы устройств", "Справочники", "read"], ["vk_get_mobile_vendors", "Производители", "Справочники", "read"], ["vk_get_targetings_tree", "Дерево таргетингов", "Справочники", "read"],
  ["vk_get_remarketing_counters", "Счётчики ремаркетинга", "Аудитории", "read"], ["vk_get_remarketing_counter", "Счётчик по ID", "Аудитории", "read"], ["vk_create_remarketing_counter", "Создать счётчик", "Аудитории", "write"], ["remarketing_counter_connect_existing", "Подключить существующий счётчик", "Аудитории", "write"], ["vk_update_remarketing_counter", "Изменить счётчик", "Аудитории", "write"], ["vk_delete_remarketing_counter", "Удалить счётчик v1", "Аудитории", "write"], ["vk_delete_remarketing_counter_v2", "Удалить счётчик v2", "Аудитории", "write"], ["vk_get_counter_goals", "Цели счётчика", "Аудитории", "read"], ["vk_create_counter_goal", "Создать цель", "Аудитории", "write"], ["vk_update_counter_goal", "Изменить цель", "Аудитории", "write"], ["vk_get_goals", "Все цели", "Аудитории", "read"], ["vk_get_remarketing_lists", "Списки ремаркетинга", "Аудитории", "read"], ["vk_get_remarketing_list", "Список по ID", "Аудитории", "read"], ["vk_create_remarketing_list", "Создать список", "Аудитории", "write"], ["vk_create_remarketing_list_v3", "Создать список v3", "Аудитории", "write"], ["vk_create_offline_goal", "Создать список офлайн-конверсий", "Аудитории", "write"], ["offline_goal_delete", "Удалить test-список офлайн-конверсий", "Аудитории", "write"], ["offline_goal_update", "Обновить test-список офлайн-конверсий", "Аудитории", "write"], ["vk_update_remarketing_list", "Изменить список", "Аудитории", "write"], ["vk_update_remarketing_list_v3", "Изменить список v3", "Аудитории", "write"], ["vk_delete_remarketing_list", "Удалить список v1", "Аудитории", "write"], ["vk_delete_remarketing_list_v3", "Удалить список v3", "Аудитории", "write"], ["vk_get_segments", "Сегменты", "Аудитории", "read"], ["vk_get_segment", "Сегмент по ID", "Аудитории", "read"], ["vk_create_segment", "Создать сегмент", "Аудитории", "write"], ["vk_create_pricelist", "Создать test-прайслист", "Аудитории", "write"], ["vk_update_segment", "Изменить сегмент", "Аудитории", "write"], ["vk_delete_segment", "Удалить сегмент", "Аудитории", "write"], ["vk_manage_segment_relations", "Связи сегмента", "Аудитории", "write"], ["vk_get_local_geos", "Локальные гео", "Аудитории", "read"], ["vk_manage_local_geo", "Управление локальным гео", "Аудитории", "write"],
  ["vk_discover_communities", "Найти публичные сообщества", "Сообщества VK", "read"], ["vk_analyze_communities", "Анализ публичных сообществ", "Сообщества VK", "read"], ["vk_score_communities", "Скоринг сообществ", "Сообщества VK", "read"], ["vk_export_community_candidates", "Экспорт кандидатов сообществ", "Сообщества VK", "read"],
  ["vk_get_packages", "Пакеты размещения", "Пакеты", "read"], ["vk_get_package", "Пакет по ID", "Пакеты", "read"], ["vk_get_package_fields", "Поля пакета", "Пакеты", "read"], ["vk_get_packages_pads", "Площадки пакетов", "Пакеты", "read"], ["vk_get_reach_forecast", "Прогноз охвата", "Пакеты", "read"], ["vk_get_currencies", "Валюты кабинета", "Пакеты", "read"],
  ["vk_get_agency_clients", "Клиенты агентства", "Кабинеты", "read"], ["vk_get_manager_clients", "Клиенты менеджера", "Кабинеты", "read"], ["vk_connect_client", "Подключить кабинет", "Кабинеты", "write"], ["vk_select_client", "Выбрать кабинет", "Кабинеты", "read"],
  ["vk_get_sharing_keys", "Аудит ключей шаринга", "Кабинеты", "read"],
  ["sharing_key_create", "Создать ключ шаринга", "Кабинеты", "write"], ["sharing_key_revoke", "Отозвать ключ шаринга", "Кабинеты", "write"],
  ["vk_get_lead_forms", "Лид-формы", "Лиды", "read"], ["vk_get_leads", "Лиды", "Лиды", "read"], ["vk_update_lead_form", "Переименовать test-лид-форму", "Лиды", "write"], ["vk_export_leads", "Экспорт лидов", "Лиды", "write"], ["survey_respondents_export", "Экспорт ответов опроса", "Лиды", "write"], ["lead_form_test_lead_send", "Отправить test-лид", "Лиды", "write"], ["vk_get_async_report", "Асинхронный отчёт", "Отчёты", "read"], ["vk_create_async_report", "Создать отчёт", "Отчёты", "write"], ["vk_export_csv", "Экспорт CSV", "Отчёты", "read"], ["vk_export_xlsx", "Экспорт XLSX", "Отчёты", "read"], ["banner_preflight", "Проверить объявление до создания", "Объявления", "read"], ["ad_plan_preflight", "Проверить кампанию до создания", "Кампании", "read"], ["ad_group_preflight", "Проверить группу до создания", "Группы", "read"],
  ["lead_form_details_get", "Конфигурация лид-формы", "Лиды", "read"], ["survey_form_details_get", "Конфигурация опросной формы", "Лиды", "read"], ["respondents_list", "Респонденты опросов", "Лиды", "read"], ["lead_form_copy", "Копировать test-лид-форму", "Лиды", "write"], ["survey_form_copy", "Копировать test-опрос", "Лиды", "write"], ["lead_forms_archive_manage", "Архивировать test-лид-формы", "Лиды", "write"], ["survey_forms_archive_manage", "Архивировать test-опросы", "Лиды", "write"], ["lead_form_image_upload", "Загрузить logo лид-формы", "Лиды", "write"], ["offer_batch_task_create", "Создать test-batch оффера", "Контент", "write"],
  ["user_geo_search", "Пользовательские гео", "Аудитории", "read"],
  ["ord_user_status_get", "Статус ОРД пользователя", "ОРД", "read"], ["ord_partner_pads_list", "Площадки ОРД партнёра", "ОРД", "read"], ["ord_partner_pad_get", "Площадка ОРД партнёра", "ОРД", "read"], ["ord_partner_subagents_list", "Субагенты ОРД партнёра", "ОРД", "read"], ["ord_partner_subagent_get", "Субагент ОРД партнёра", "ОРД", "read"], ["ord_partner_acts_list", "Акты ОРД партнёра", "ОРД", "read"], ["ord_partner_act_stat_get", "Статистика акта ОРД по площадке", "ОРД", "read"], ["ord_agency_acts_list", "Акты ОРД агентства", "ОРД", "read"], ["ord_agency_client_acts_list", "Акты клиента ОРД агентства", "ОРД", "read"], ["ord_agency_report_list", "Отчёты ОРД агентства", "ОРД", "read"], ["ord_agency_status_get", "Статус ОРД агентства", "ОРД", "read"],
  ["agency_client_get", "Клиент агентства", "Кабинеты", "read"], ["agency_manager_client_get", "Клиент менеджера", "Кабинеты", "read"], ["subscription_create", "Создать подписку", "Кабинеты", "write"], ["agency_client_update", "Изменить связь agency-client", "Кабинеты", "write"], ["agency_client_delete", "Удалить связь agency-client", "Кабинеты", "write"], ["user_profile_update", "Изменить профиль VK Ads", "Кабинеты", "write"], ["manager_client_update", "Изменить связь manager-client", "Кабинеты", "write"], ["manager_client_delete", "Удалить связь manager-client", "Кабинеты", "write"], ["apple_app_metadata_refresh", "Обновить metadata iOS-приложения", "Mini Apps", "write"], ["google_app_metadata_refresh", "Обновить metadata Android-приложения", "Mini Apps", "write"], ["inapp_event_get", "In-app событие", "Mini Apps", "read"], ["subscription_details_get", "Подписка", "Кабинеты", "read"],
  ["ord_partner_acts_update", "Изменить акты ОРД", "ОРД", "write"], ["ord_partner_pad_update", "Изменить площадку ОРД", "ОРД", "write"], ["ord_partner_subagent_create", "Создать контрагента ОРД", "ОРД", "write"], ["ord_partner_subagent_update", "Изменить контрагента ОРД", "ОРД", "write"], ["billing_transfer_to_client", "Перевести средства клиенту", "Финансы", "write"],
  ["offer_batch_task_get", "Batch-задачи офферов", "Контент", "read"],
  ["skadnetwork_ids_share", "Передать SKAdNetwork IDs", "Mini Apps", "write"], ["skadnetwork_ids_withdraw", "Вернуть SKAdNetwork IDs", "Mini Apps", "write"],
  ["analytics_compare_periods", "Сравнение периодов", "Аналитика", "read"], ["analytics_rank_campaigns", "Рейтинг кампаний", "Аналитика", "read"], ["analytics_find_inefficient_campaigns", "Поиск неэффективных кампаний", "Аналитика", "read"], ["analytics_recommendations", "Рекомендации по оптимизации", "Аналитика", "read"], ["analytics_anomalies", "Поиск аномалий", "Аналитика", "read"], ["analytics_delivery_issues", "Диагностика delivery", "Аналитика", "read"], ["analytics_account_audit", "Аудит кабинета за период", "Аналитика", "read"], ["vk_get_pads_tree", "Дерево рекламных площадок", "Пакеты", "read"],
];

export const toolCatalog: CatalogTool[] = definitions.map(([name, title, category, access]) => ({
  name,
  title,
  category,
  access,
  status: implemented.has(name) ? "implemented" : "planned",
}));

if (new Set(toolCatalog.map((tool) => tool.name)).size !== toolCatalog.length) throw new Error("Каталог MCP содержит повторяющиеся имена инструментов.");

export function searchCatalog(query: string, category?: string): CatalogTool[] {
  const normalized = query.trim().toLocaleLowerCase("ru");
  return toolCatalog.filter((tool) => (!category || tool.category === category) && (!normalized || `${tool.name} ${tool.title} ${tool.category}`.toLocaleLowerCase("ru").includes(normalized)));
}

export function isExecutableTool(tool: CatalogTool): boolean {
  return tool.status !== "planned";
}
