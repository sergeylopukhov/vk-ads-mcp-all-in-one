# Подключение к Codex

Нужны Node.js 20 или новее, а также `client_id` и `client_secret` приложения VK Ads. Одна и та же команда работает в PowerShell на Windows и в терминале macOS или Linux:

```bash
node --input-type=module -e "const r=await fetch('https://raw.githubusercontent.com/sergeylopukhov/vk-ads-mcp-all-in-one/main/install.mjs');if(!r.ok)throw new Error('HTTP '+r.status);await import('data:text/javascript,'+encodeURIComponent(await r.text()))"
```

Установщик запросит `client_id` и скрытый `client_secret`, загрузит последнюю версию и зарегистрирует MCP-сервер под именем `vk-ads`. Токен он получит и сохранит самостоятельно.

Перезапустите Codex и отправьте запрос:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Для обновления снова выполните ту же команду. Настройки, профили и токены сохранятся.

Подробности: [README](../README.md).

Если VK Ads вернёт `token_limit_exceeded`, для приложения исчерпан лимит активных токенов. Сервер не отзывает их сам: удалите ненужные токены в кабинете VK Ads и повторите запуск.
