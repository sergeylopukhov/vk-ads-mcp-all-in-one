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

Установщик запросит `client_id` и скрытый `client_secret`, загрузит последнюю версию и зарегистрирует MCP-сервер под именем `vk-ads`. Токен он получит и сохранит самостоятельно.

Перезапустите Codex и отправьте запрос:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Для обновления снова выполните команду для своей системы. Настройки, профили и токены сохранятся.

Подробности: [README](../README.md).

Если VK Ads вернёт `token_limit_exceeded`, для приложения исчерпан лимит активных токенов. Сервер не отзывает их сам: удалите ненужные токены в кабинете VK Ads и повторите запуск.
