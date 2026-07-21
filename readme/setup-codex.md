# Подключение к Codex

Нужны Node.js 20 или новее, а также `client_id` и `client_secret` приложения VK Ads.

## macOS и Linux

```bash
curl -fsSL https://raw.githubusercontent.com/sergeylopukhov/vk-ads-mcp-all-in-one/main/install.sh | sh
```

## Windows

Откройте PowerShell и выполните:

```powershell
irm https://raw.githubusercontent.com/sergeylopukhov/vk-ads-mcp-all-in-one/main/install.ps1 | iex
```

Установщик запросит только `client_id`, скрытый `client_secret` и режим `readonly/write`. Расширенные разрешения записи доступны отдельным необязательным шагом и по умолчанию выключены. После настройки установщик зарегистрирует MCP-сервер под именем `vk-ads`. При первом запросе сервер сам получит и сохранит токен.

Перезапустите Codex и отправьте запрос:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Для обновления снова выполните команду для своей системы. Установщик предложит сохранить текущие настройки или изменить их; профили и токены не удаляются.

Подробности: [README](../README.md).

Если VK Ads вернёт `token_limit_exceeded`, не удаляйте `.env`. При старте сервер сначала пытается безопасно обновить сохранённый `refresh_token`. Если лимит уже исчерпан, в write-режиме используйте `vk_recover_token_limit`: он подготовит preview, а после выполнения сервер отзовёт токены только текущей пары `client_id—user`, выпустит один новый токен и сохранит `refresh_token`. Кампании, бюджеты и аудитории не изменяются.
