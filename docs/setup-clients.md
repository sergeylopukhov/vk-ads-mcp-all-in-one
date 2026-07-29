# Подключение к MCP-клиентам

Сначала установите сервер по [основной инструкции](../README.md#быстрый-старт). Установщик найдёт поддерживаемые клиенты и предложит выбрать, куда подключить сервер.

Поддерживаются:

- Codex CLI;
- Claude Code;
- Gemini CLI;
- Qwen Code;
- Kimi Code CLI;
- Cursor.

Для выбора без интерактивного вопроса передайте идентификаторы через запятую:

```bash
npx --yes github:sergeylopukhov/vk-ads-mcp-all-in-one --clients codex,claude,gemini,qwen,kimi,cursor
```

`--all-detected` подключает все найденные клиенты. `--no-register` устанавливает только сервер. Если автоматическая настройка не подходит, используйте команды ниже. Полный каталог установки напечатает установщик.

## Codex

Выберите Codex во время установки. После завершения перезапустите Codex.

## Claude Code

```bash
claude mcp add --transport stdio --scope user vk-ads -- node "/полный/путь/к/VK Ads MCP/dist/index.js"
```

## Gemini CLI

```bash
gemini mcp add --scope user vk-ads node "/полный/путь/к/VK Ads MCP/dist/index.js"
```

## Qwen Code

```bash
qwen mcp add --scope user vk-ads node "/полный/путь/к/VK Ads MCP/dist/index.js"
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

## Cursor

Добавьте в `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "node",
      "args": ["/полный/путь/к/VK Ads MCP/dist/index.js"]
    }
  }
}
```

Если конфигурация Kimi или Cursor уже существует, установщик создаёт резервную копию с датой и временем в имени.

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
