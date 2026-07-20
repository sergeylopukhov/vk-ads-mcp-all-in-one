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

Сервер подключает AI-клиент к вашему кабинету VK Ads. Он умеет читать рекламные планы, группы и объявления, получать статистику, работать с аудиториями, медиа, отчётами и экспортом. Режим записи выключен по умолчанию.

Работает с Codex, Claude Code, Gemini CLI, Qwen Code, Kimi Code CLI и другими клиентами, которые поддерживают MCP через `stdio`.

> [!IMPORTANT]
> Проект работает только с VK Ads. Инструментов для сообществ VK здесь нет.

## Быстрый старт

Нужны Node.js 20 или новее и личный токен VK Ads для нужного рекламного кабинета.

### macOS

```bash
curl -fL https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/download/v0.1.0/vk-ads-mcp-0.1.0.zip -o vk-ads-mcp-0.1.0.zip
unzip vk-ads-mcp-0.1.0.zip
cd vk-ads-mcp-0.1.0
npm ci --omit=dev
cp .env.example .env
open -e .env
```

### Linux

Выполните те же команды, но откройте файл так:

```bash
nano .env
```

В файле `.env` укажите токен после знака `=`:

```text
VK_ADS_TOKEN=ваш_личный_токен_VK_Ads
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
npm.cmd ci --omit=dev
Copy-Item .env.example .env
notepad .env
```

В Блокноте укажите `VK_ADS_TOKEN=ваш_токен`, сохраните файл и подключите сервер:

```powershell
codex mcp remove vk-ads
codex mcp add vk-ads --env VK_ADS_PROFILE=default -- node "$($PWD.Path)\dist\index.js"
```

После подключения перезапустите клиент и отправьте ему:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

## Как хранится токен

Токен лежит только в локальном файле `.env` рядом с `package.json`. Сервер загружает его сам при запуске. Файл `.env` исключён из Git, не попадает в архив релиза и не нужен в настройках MCP-клиента.

Чтобы заменить токен, откройте `.env`, измените значение `VK_ADS_TOKEN` и перезапустите клиент.

## Что умеет сервер

| Раздел | Возможности |
| --- | --- |
| Аналитика | Статистика, сравнение периодов, ранжирование по CTR, CPC, CPA и расходу. |
| Реклама | Чтение структуры `ad_plans → ad_groups → banners`; создание и изменение только тестовых объектов с подтверждением. |
| Креативы | Проверка изображений, видео, HTML5 и параметров объявления до отправки в VK Ads. |
| Данные | Аудитории, сегменты, лид-формы, отчёты и экспорт. |

Полный список доступен через MCP-инструмент `search_tools`.

## Режим записи

Для чтения ничего настраивать не нужно. Запись включается только при явном запуске:

```bash
VK_ADS_MODE=write node dist/index.js
```

Перед записью сервер проверяет данные, создаёт предварительный просмотр и ждёт точного подтверждения. Рабочие кампании, группы, объявления, аудитории, счётчики и бюджеты не используются для тестов.

## Ошибки подключения

- «Токен VK Ads не найден»: проверьте имя файла `.env`, его расположение рядом с `package.json` и строку `VK_ADS_TOKEN=...`.
- Ошибка `403`: у токена нет доступа к выбранному рекламному кабинету. Создайте токен с нужным доступом.

Инструкции для других MCP-клиентов: [readme/setup-clients.md](readme/setup-clients.md). Короткая инструкция для Codex: [readme/setup-codex.md](readme/setup-codex.md).

Лицензия: [MIT](LICENSE). Политика безопасности: [SECURITY.md](SECURITY.md).
