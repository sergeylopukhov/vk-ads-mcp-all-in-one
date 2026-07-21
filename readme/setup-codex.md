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

Установщик запросит `client_id`, скрытый `client_secret`, режим `readonly/write` и остальные поддерживаемые настройки. Опасные разрешения записи по умолчанию выключены. После настройки установщик зарегистрирует MCP-сервер под именем `vk-ads`. Токен он получит и сохранит самостоятельно.

Перезапустите Codex и отправьте запрос:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Для обновления снова выполните команду для своей системы. Установщик предложит сохранить текущие настройки или изменить их; профили и токены не удаляются.

Подробности: [README](../README.md).

Если VK Ads вернёт `token_limit_exceeded`, для приложения исчерпан лимит активных токенов. Сервер не отзывает их сам: удалите ненужные токены в кабинете VK Ads и повторите запуск.
