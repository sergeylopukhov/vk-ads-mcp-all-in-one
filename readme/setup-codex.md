# Подключение к Codex

Нужны Node.js 22 или новее, `client_id`, `client_secret` приложения VK Ads и авторизованный GitHub CLI, пока репозиторий приватный.

## Установка

### macOS и Linux

```bash
gh auth login
gh api -H "Accept: application/vnd.github.raw+json" repos/sergeylopukhov/vk-ads-mcp-all-in-one/contents/install.sh | sh
```

### Windows

```powershell
gh auth login
gh api -H "Accept: application/vnd.github.raw+json" repos/sergeylopukhov/vk-ads-mcp-all-in-one/contents/install.ps1 | Out-String | Invoke-Expression
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

Первый безопасный инструмент — `vk_ads_connection_check`.

## Запись

Инструмент записи выполняет операцию сразу, без предварительного просмотра. Перед изменением Codex должен прочитать нужный объект, показать его пользователю и получить явный запрос на изменение. После записи Codex повторно читает результат, если VK Ads поддерживает такую проверку.
