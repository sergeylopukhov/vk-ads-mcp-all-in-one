<p align="center">
  <img src="assets/cover.png" alt="VK Ads MCP: аналитика и управление рекламой" width="100%">
</p>

<p align="center">
  <img src="assets/logo.png" alt="Логотип VK Ads MCP" width="160">
</p>

<h1 align="center">VK Ads MCP All in One</h1>

<p align="center">Локальный MCP-сервер для анализа и безопасной работы с VK Ads.</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 20+"></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-stdio-1f6feb" alt="MCP stdio"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0b8f60" alt="Лицензия MIT"></a>
  <img src="https://img.shields.io/badge/version-0.1.0-6b7280" alt="Версия 0.1.0">
</p>

Сервер подключает AI-клиент к кабинету VK Ads: читает рекламные планы, группы и объявления, получает статистику, работает с аудиториями, медиафайлами, отчётами и экспортом. По умолчанию запись выключена.

Для Codex, Claude Code, Gemini CLI, Qwen Code и Kimi Code CLI есть примеры подключения по `stdio`. Для других MCP-клиентов может потребоваться отдельная настройка.

> [!IMPORTANT]
> Проект работает только с VK Ads. Инструментов для сообществ VK здесь нет.

## Быстрый старт ✨

Нужны Node.js 20 или новее, а также `client_id` и `client_secret` приложения VK Ads.

### macOS и Linux

```bash
curl -fsSL https://raw.githubusercontent.com/sergeylopukhov/vk-ads-mcp-all-in-one/main/install.sh | sh
```

### Windows

Откройте PowerShell и выполните:

```powershell
irm https://raw.githubusercontent.com/sergeylopukhov/vk-ads-mcp-all-in-one/main/install.ps1 | iex
```

Установщик запросит только `client_id`, скрытый `client_secret` и режим работы: только чтение или чтение и запись. При выборе записи расширенные возможности можно настроить отдельно; по умолчанию они выключены. Затем установщик загрузит сервер и подключит его к Codex. Токен получать и вставлять вручную не нужно.

✅ После установки перезапустите Codex и отправьте запрос:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Чтобы обновить сервер, снова выполните команду для своей системы. Установщик предложит сохранить текущие настройки или пройти настройку заново; профили, токены и локальный аудит не удаляются.

Каталог установки по умолчанию:

- macOS: `~/Library/Application Support/VK Ads MCP`;
- Linux: `~/.local/share/vk-ads-mcp`;
- Windows: `%LOCALAPPDATA%\VK Ads MCP`.

Для Claude Code, Gemini CLI, Qwen Code и Kimi Code CLI используйте [короткие команды подключения](readme/setup-clients.md). Разработчики могут запустить `node install.mjs --help`, чтобы выбрать ветку или другой каталог установки.

## Как создаётся и хранится токен

При первом запросе сервер получает токен VK Ads по `client_id` и `client_secret`, после чего записывает его в локальный профиль. Для профиля `default` это `.env` в каталоге установки; `refresh_token` также сохраняется локально и используется для продления access token без создания нового экземпляра.

`client_secret`, токен и refresh-токен остаются только в `.env`. Файл исключён из Git, не попадает в релиз и не нужен в настройках MCP-клиента. Не передавайте его другим людям.

## Разные роли VK Ads: advertiser, agency, manager, ОРД

Сервер универсален: права определяет token пользователя VK Ads, а не сборка MCP. Не используйте один token на всех. Для каждого кабинета или роли создайте отдельный локальный профиль:

```bash
cd mcp-server
mkdir -p profiles
cp .env.example profiles/agency.env
open -e profiles/agency.env
```

В файле укажите только credential этого пользователя. Затем подключите отдельный MCP-процесс:

```bash
codex mcp add vk-ads-agency --env VK_ADS_PROFILE=agency -- node "$(pwd)/dist/index.js"
```

Профиль `agency` хранит token и write-audit в `mcp-server/profiles/agency.env` и `mcp-server/profiles/agency.vk-ads-audit.json`. Они игнорируются Git. Аналогично работают `manager`, `ord_partner` и любые другие имена профилей. Один запущенный MCP-процесс всегда использует ровно один профиль; переключить credential через MCP-вызов нельзя.

## Что умеет сервер

| Раздел | Возможности |
| --- | --- |
| Аналитика | Статистика, сравнение периодов, ранжирование по CTR, CPC, CPA и расходу. |
| Реклама | Чтение структуры `ad_plans → ad_groups → banners`; большинство операций записи — только для тестовых объектов и с подтверждением. |
| Креативы | Проверка изображений, видео, HTML5 и параметров объявления до отправки в VK Ads. |
| Данные | Аудитории, сегменты, лид-формы, отчёты и экспорт. |

Полный список с описаниями и разделением по категориям опубликован в [TOOLS.md](TOOLS.md). Актуальный набор для запущенного профиля также доступен через MCP-инструмент `search_tools`.

## Режим записи

Для чтения ничего настраивать не нужно. Из папки `mcp-server` запись включается только при явном запуске:

```bash
VK_ADS_MODE=write node dist/index.js
```

Перед записью сервер проверяет данные и создаёт preview. По умолчанию `write_execute` ждёт точного подтверждения; владелец локального профиля может явно отключить это требование через `VK_ADS_REQUIRE_WRITE_CONFIRMATION=0`. Тестовые сценарии используют только новые объекты с префиксом `__MCP_TEST__`; production-операции доступны лишь через отдельные фиксированные схемы, preflight и reread. Изменение дневного лимита может затронуть выбранную кампанию: перед выполнением проверьте preview и ID.

## Ошибки подключения

- «VK Ads не выдал токен»: проверьте `VK_ADS_CLIENT_ID` и `VK_ADS_CLIENT_SECRET` в `.env`.
- `token_limit_exceeded`: не удаляйте локальный `.env`. В write-режиме используйте `vk_recover_token_limit`: он подготовит preview, а после выполнения удалит токены текущей связки `client_id—user`, выпустит один новый токен и сохранит `refresh_token`. Кампании и бюджеты операция не изменяет.
- Ошибка `403`: VK Ads отклонил запрос. Проверьте права приложения и доступ к рекламному кабинету.

Инструкции для других MCP-клиентов: [readme/setup-clients.md](readme/setup-clients.md). Короткая инструкция для Codex: [readme/setup-codex.md](readme/setup-codex.md).

Лицензия: [MIT](LICENSE). Политика безопасности: [SECURITY.md](SECURITY.md).

## Структура репозитория

Весь код и конфигурация сервера находятся в [mcp-server](mcp-server): исходники, зависимости, `.env.example` и `AGENTS.md`. В корне остаются только описание, лицензия, безопасность и изображения для страницы репозитория.
