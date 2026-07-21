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

## Быстрый старт

Нужны Node.js 20 или новее, `client_id` и `client_secret` вашего приложения VK Ads. Токен получать и вставлять вручную не нужно.

### macOS

```bash
curl -fL https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/download/v0.1.0/vk-ads-mcp-0.1.0.zip -o vk-ads-mcp-0.1.0.zip
unzip vk-ads-mcp-0.1.0.zip
cd vk-ads-mcp-0.1.0/mcp-server
npm ci --omit=dev
cp .env.example .env
open -e .env
```

В открытом файле заполните только `VK_ADS_CLIENT_ID` и `VK_ADS_CLIENT_SECRET`, затем сохраните его.

### Linux

Выполните те же команды, но откройте файл так:

```bash
nano .env
```

В файле `.env` укажите данные приложения после знака `=`:

```text
VK_ADS_CLIENT_ID=ваш_client_id
VK_ADS_CLIENT_SECRET=ваш_client_secret
```

Сохраните файл и подключите сервер к Codex:

```bash
codex mcp remove vk-ads
codex mcp add vk-ads --env VK_ADS_PROFILE=default -- node "$(pwd)/dist/index.js"
```

### Windows

Откройте PowerShell и выполните:

```powershell
Invoke-WebRequest https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/download/v0.1.0/vk-ads-mcp-0.1.0.zip -OutFile vk-ads-mcp-0.1.0.zip
Expand-Archive vk-ads-mcp-0.1.0.zip -DestinationPath .
Set-Location .\vk-ads-mcp-0.1.0
Set-Location .\mcp-server
npm.cmd ci --omit=dev
Copy-Item .env.example .env
notepad .env
```

В Блокноте укажите `VK_ADS_CLIENT_ID=...` и `VK_ADS_CLIENT_SECRET=...`, сохраните файл и подключите сервер:

```powershell
codex mcp remove vk-ads
codex mcp add vk-ads --env VK_ADS_PROFILE=default -- node "$($PWD.Path)\dist\index.js"
```

После подключения перезапустите клиент и отправьте ему:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

## Как создаётся и хранится токен

При первом запросе сервер получает токен VK Ads по `client_id` и `client_secret`, после чего сам записывает его в локальный `mcp-server/.env` рядом с `package.json`. Если VK Ads вернёт `refresh_token`, сервер также сохранит его локально.

`client_secret`, токен и refresh-токен остаются только в `.env`. Файл исключён из Git, не попадает в релиз и не нужен в настройках MCP-клиента. Не передавайте его другим людям.

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

Перед записью сервер проверяет данные, создаёт preview и ждёт точного подтверждения. Большинство операций доступно только для объектов с префиксом `__MCP_TEST__`. Изменение дневного лимита может затронуть выбранную кампанию: перед подтверждением проверьте preview и ID.

## Ошибки подключения

- «VK Ads не выдал токен»: проверьте `VK_ADS_CLIENT_ID` и `VK_ADS_CLIENT_SECRET` в `.env`.
- `token_limit_exceeded`: VK Ads отклонил выпуск нового токена. Сервер не умеет просматривать и отзывать токены приложения. Не удаляйте локальный `.env`, чтобы не выпускать токен повторно. Если лимит уже исчерпан, обратитесь в поддержку VK Ads, указав ошибку и `client_id` приложения.
- Ошибка `403`: VK Ads отклонил запрос. Проверьте права приложения и доступ к рекламному кабинету.

Инструкции для других MCP-клиентов: [readme/setup-clients.md](readme/setup-clients.md). Короткая инструкция для Codex: [readme/setup-codex.md](readme/setup-codex.md).

Лицензия: [MIT](LICENSE). Политика безопасности: [SECURITY.md](SECURITY.md).

## Структура репозитория

Весь код и конфигурация сервера находятся в [mcp-server](mcp-server): исходники, зависимости, `.env.example` и `AGENTS.md`. В корне остаются только описание, лицензия, безопасность и изображения для страницы репозитория.
