# Подключение к MCP-клиентам

Сначала установите или обновите сервер.

### macOS и Linux

```bash
curl -fsSL https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/latest/download/install.sh | sh
```

### Windows

```powershell
irm https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/latest/download/install.ps1 | iex
```

Установщик запросит данные приложения и режим `readonly/write`, затем напечатает каталог установки. Расширенные разрешения записи можно открыть отдельным необязательным шагом. Codex подключится автоматически. Для остальных клиентов укажите полный путь к `/dist/index.js` в нужной команде.

## Codex

Дополнительные команды не нужны. Перезапустите Codex после установки.

## Claude Code

```bash
claude mcp add --env VK_ADS_PROFILE=default --transport stdio --scope user vk-ads -- node "/полный/путь/к/каталогу/установки/dist/index.js"
```

## Gemini CLI

```bash
gemini mcp add vk-ads node "/полный/путь/к/каталогу/установки/dist/index.js" --env VK_ADS_PROFILE=default --scope user
```

## Qwen Code

```bash
qwen mcp add vk-ads -e VK_ADS_PROFILE=default node "/полный/путь/к/каталогу/установки/dist/index.js"
```

## Kimi Code CLI

Добавьте в `~/.kimi-code/mcp.json`:

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "node",
      "args": ["/полный/путь/к/каталогу/установки/dist/index.js"],
      "env": { "VK_ADS_PROFILE": "default" },
      "enabled": true
    }
  }
}
```

После подключения перезапустите клиент и отправьте запрос:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Если VK Ads вернёт `token_limit_exceeded`, не удаляйте локальный `.env`. При запуске сервер сначала пытается продлить сохранённый `refresh_token`. Если лимит уже исчерпан, в write-режиме используйте `vk_recover_token_limit`: он подготовит preview, а после выполнения отзовёт токены только текущей пары `client_id—user`, выпустит один новый токен и сохранит `refresh_token`. Кампании, бюджеты и аудитории не изменяются.
