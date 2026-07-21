# Подключение к MCP-клиентам

Сначала установите или обновите сервер.

### macOS и Linux

```bash
curl -fsSL https://raw.githubusercontent.com/sergeylopukhov/vk-ads-mcp-all-in-one/main/install.sh | sh
```

### Windows

```powershell
irm https://raw.githubusercontent.com/sergeylopukhov/vk-ads-mcp-all-in-one/main/install.ps1 | iex
```

Установщик запросит данные приложения и режим `readonly/write`, затем напечатает каталог установки. Расширенные разрешения записи можно открыть отдельным необязательным шагом. Codex подключится автоматически. Для остальных клиентов добавьте к каталогу `/dist/index.js` и подставьте полный путь в команду ниже.

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

Если VK Ads вернёт `token_limit_exceeded`, выпуск нового токена отклонён. Сервер не умеет просматривать и отзывать токены приложения. Не удаляйте локальный `.env`, чтобы не выпускать токен повторно. Если лимит уже исчерпан, обратитесь в поддержку VK Ads, указав ошибку и `client_id` приложения.
