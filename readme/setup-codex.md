# Подключение к Codex

Нужны Node.js 20 или новее и личный токен VK Ads.

## 1. Установите сервер

```bash
curl -fL https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/download/v0.1.0/vk-ads-mcp-0.1.0.zip -o vk-ads-mcp-0.1.0.zip
unzip vk-ads-mcp-0.1.0.zip
cd vk-ads-mcp-0.1.0
npm ci --omit=dev
```

## 2. Добавьте токен в `.env`

Создайте личный токен в настройках API VK Ads для нужного кабинета. Затем выполните:

```bash
cp .env.example .env
open -e .env
```

В открывшемся файле вставьте токен после `VK_ADS_TOKEN=` и сохраните его. Файл `.env` не попадает в Git.

## 3. Добавьте сервер в Codex

```bash
codex mcp remove vk-ads
codex mcp add vk-ads --env VK_ADS_PROFILE=default -- node "$(pwd)/dist/index.js"
```

## 4. Проверьте доступ

Перезапустите Codex и отправьте:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Полная инструкция и решение частых ошибок: [README](../README.md#установка-в-codex-на-macos).
