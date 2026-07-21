# Подключение к MCP-клиентам

Универсальный установщик для Windows, macOS и Linux описан в [README](../README.md#быстрый-старт). Он автоматически подключает Codex, если его CLI доступен. Для остальных клиентов после установки используйте соответствующую команду ниже и путь, который напечатает установщик.

Распакуйте релиз, перейдите в папку `mcp-server` и установите зависимости:

```bash
npm ci --omit=dev
```

Скопируйте `.env.example` в `.env` и укажите `VK_ADS_CLIENT_ID` и `VK_ADS_CLIENT_SECRET` вашего приложения VK Ads. При первом запросе сервер сам получит токен и сохранит его в `.env`. Токен не нужно добавлять в настройки клиента.

Если вы запускаете сервер из исходников, выполните `npm ci`, затем `npm run build`.

Во всех примерах путь к `dist/index.js` должен быть абсолютным.

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
      "args": ["/полный/путь/vk-ads-mcp/mcp-server/dist/index.js"],
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

Если VK Ads вернёт `token_limit_exceeded`, для приложения исчерпан лимит активных токенов. Сервер не отзывает их сам: удалите ненужные токены в кабинете VK Ads и повторите запуск.
