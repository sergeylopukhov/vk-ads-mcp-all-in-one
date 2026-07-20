# Подключение к MCP-клиентам

Сервер использует стандартный транспорт MCP `stdio`. Он работает с любым клиентом, который умеет запускать локальную команду и поддерживает MCP tools: Codex, Claude Code, Gemini CLI, Qwen Code, Kimi Code CLI и другими.

Перед подключением один раз установите зависимости и соберите проект:

```bash
npm ci
npm run build
```

Во всех примерах путь к `dist/index.js` должен быть абсолютным. Сервер не предоставляет публичный HTTP endpoint: для удалённого клиента его нужно установить и запускать на той машине, где доступно локальное хранилище учётных данных VK Ads.

## Общая конфигурация

Большинство клиентов принимают следующую запись в своём MCP JSON-конфиге. Замените путь в `args` на путь к своей копии репозитория.

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "node",
      "args": ["/абсолютный/путь/vk-ads-mcp/dist/index.js"],
      "env": {
        "VK_ADS_PROFILE": "default"
      }
    }
  }
}
```

Не добавляйте в этот JSON токен, `client_secret` или пароль от encrypted store. Настройте их вне конфигурации клиента по [правилам хранения секретов](../README.md#секреты-и-токены).

## Codex

```bash
codex mcp add vk-ads --env VK_ADS_PROFILE=default -- node "$(pwd)/dist/index.js"
codex mcp list
```

## Claude Code

```bash
claude mcp add --env VK_ADS_PROFILE=default --transport stdio --scope user vk-ads -- node "$(pwd)/dist/index.js"
claude mcp list
```

По умолчанию сохраняется пользовательская конфигурация. Не добавляйте сервер как общий project MCP с учётными данными: чужой клон репозитория не должен получать доступ к вашему кабинету.

## Gemini CLI

```bash
gemini mcp add vk-ads node "$(pwd)/dist/index.js" --env VK_ADS_PROFILE=default --scope user
gemini mcp list
```

## Qwen Code

```bash
qwen mcp add vk-ads -e VK_ADS_PROFILE=default node "$(pwd)/dist/index.js"
qwen mcp list
```

Альтернатива — добавить общую JSON-конфигурацию в `~/.qwen/settings.json` или `.qwen/settings.json`. Не включайте `trust: true`: подтверждения инструментов клиента должны оставаться включёнными.

## Kimi Code CLI

Добавьте общую JSON-конфигурацию в `~/.kimi-code/mcp.json` либо через команду `/mcp-config` в интерфейсе. Статус подключения показывает команда `/mcp`.

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "node",
      "args": ["/абсолютный/путь/vk-ads-mcp/dist/index.js"],
      "env": {
        "VK_ADS_PROFILE": "default"
      },
      "enabled": true
    }
  }
}
```

## Первая проверка

После подключения начните с запроса:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

В любом клиенте сохраняйте его собственные подтверждения вызовов. Режим записи сервера выключен по умолчанию и дополнительно защищён preflight, preview и одноразовым подтверждением.
