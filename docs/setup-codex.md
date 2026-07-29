# Подключение к Codex

Нужны Node.js 22 или новее, `client_id` и `client_secret` приложения VK Ads.

## Установка

### macOS и Linux

```bash
curl -fsSL https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/latest/download/install.sh | sh
```

### Windows

```powershell
irm https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/latest/download/install.ps1 | iex
```

Установщик запросит `client_id`, скроет ввод `client_secret`, соберёт сервер и зарегистрирует MCP-подключение `vk-ads`. Одновременно он установит навык Codex в `~/.codex/skills/vk-ads-mcp/`.

Перезапустите Codex и отправьте:

```text
Проверь подключение к VK Рекламе и покажи доступные кампании. Ничего не меняй.
```

## Обновление

Повторите команду установки:

- обновление сохраняет `auth.env`, токены и локальный аудит;
- переустановка запрашивает учётные данные заново.

## Проверка подключения

Установщик выполняет:

```bash
codex mcp remove vk-ads
codex mcp add vk-ads -- node "/полный/путь/к/VK Ads MCP/dist/index.js"
```

Проверить регистрацию можно командой:

```bash
codex mcp get vk-ads
```

Первый безопасный tool — `vk_ads_connection_check`.

## Запись

Вызов write tool выполняет операцию. Отдельного preview-слоя нет. Перед изменением Codex должен прочитать точный объект, показать цель и получить явный запрос пользователя на изменение. После записи он повторно читает результат, когда VK Ads поддерживает такой контракт.
