# Подключение к MCP-клиентам

## Перед началом

```bash
npm ci
npm run build
```

Нужен Node.js 20 или новее. Во всех командах сервер запускается локально, а путь к `dist/index.js` должен быть абсолютным.

Не добавляйте токен и пароль хранилища в конфигурацию клиента. Создайте личный токен в настройках API VK Ads и передайте `VK_ADS_TOKEN` только защищённому окружению процесса MCP.

## Codex

```bash
codex mcp add vk-ads --env VK_ADS_PROFILE=default -- node "$(pwd)/dist/index.js"
```

## Claude Code

```bash
claude mcp add --env VK_ADS_PROFILE=default --transport stdio --scope user vk-ads -- node "$(pwd)/dist/index.js"
```

## Gemini CLI

```bash
gemini mcp add vk-ads node "$(pwd)/dist/index.js" --env VK_ADS_PROFILE=default --scope user
```

## Qwen Code

```bash
qwen mcp add vk-ads -e VK_ADS_PROFILE=default node "$(pwd)/dist/index.js"
```

## Kimi Code CLI

Добавьте в `~/.kimi-code/mcp.json`:

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "node",
      "args": ["/полный/путь/vk-ads-mcp/dist/index.js"],
      "env": { "VK_ADS_PROFILE": "default" },
      "enabled": true
    }
  }
}
```

## Проверка

После сохранения токена отправьте:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Режим записи выключен по умолчанию.
