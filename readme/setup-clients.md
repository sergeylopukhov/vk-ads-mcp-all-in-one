# Подключение к MCP-клиентам

Сначала установите сервер по [основной инструкции](../README.md#быстрый-старт). Установщик напечатает полный каталог установки.

## Codex

Подключается автоматически. После установки перезапустите Codex.

## Claude Code

```bash
claude mcp add --transport stdio --scope user vk-ads -- node "/полный/путь/к/VK Ads MCP/dist/index.js"
```

## Gemini CLI

```bash
gemini mcp add vk-ads node "/полный/путь/к/VK Ads MCP/dist/index.js" --scope user
```

## Qwen Code

```bash
qwen mcp add vk-ads node "/полный/путь/к/VK Ads MCP/dist/index.js"
```

## Kimi Code CLI

Добавьте в `~/.kimi-code/mcp.json`:

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "node",
      "args": ["/полный/путь/к/VK Ads MCP/dist/index.js"],
      "enabled": true
    }
  }
}
```

## Универсальная конфигурация

Клиент должен запускать один локальный процесс:

```json
{
  "command": "node",
  "args": ["/полный/путь/к/VK Ads MCP/dist/index.js"]
}
```

Переменные окружения в конфигурации MCP не нужны: сервер читает локальный `auth.env` рядом с установкой.

После подключения перезапустите клиент и вызовите `vk_ads_connection_check`.
