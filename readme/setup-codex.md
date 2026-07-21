# Подключение к Codex

Нужны Node.js 20 или новее, `client_id` и `client_secret` вашего приложения VK Ads. Токен получать вручную не нужно.

## Установка и обновление одной командой

Одна и та же команда работает в PowerShell, macOS и Linux:

```bash
node --input-type=module -e "const r=await fetch('https://raw.githubusercontent.com/sergeylopukhov/vk-ads-mcp-all-in-one/main/install.mjs');if(!r.ok)throw new Error('HTTP '+r.status);await import('data:text/javascript,'+encodeURIComponent(await r.text()))"
```

При первом запуске установщик запросит данные приложения и подключит `vk-ads` к Codex. Повторный запуск обновит сервер, не меняя локальные профили и токены.

## Ручная установка

## macOS

```bash
curl -fL https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/download/v0.1.0/vk-ads-mcp-0.1.0.zip -o vk-ads-mcp-0.1.0.zip
unzip vk-ads-mcp-0.1.0.zip
cd vk-ads-mcp-0.1.0/mcp-server
npm ci --omit=dev
cp .env.example .env
open -e .env
```

В Linux вместо `open -e .env` используйте `nano .env`.

В файле `.env` укажите:

```text
VK_ADS_CLIENT_ID=ваш_client_id
VK_ADS_CLIENT_SECRET=ваш_client_secret
```

Затем выполните:

```bash
codex mcp remove vk-ads
codex mcp add vk-ads --env VK_ADS_PROFILE=default -- node "$(pwd)/dist/index.js"
```

## Windows

В PowerShell:

```powershell
Invoke-WebRequest https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/download/v0.1.0/vk-ads-mcp-0.1.0.zip -OutFile vk-ads-mcp-0.1.0.zip
Expand-Archive vk-ads-mcp-0.1.0.zip -DestinationPath .
Set-Location .\vk-ads-mcp-0.1.0
Set-Location .\mcp-server
npm.cmd ci --omit=dev
Copy-Item .env.example .env
notepad .env
codex mcp remove vk-ads
codex mcp add vk-ads --env VK_ADS_PROFILE=default -- node "$($PWD.Path)\dist\index.js"
```

Сохраните `.env`, перезапустите Codex и отправьте запрос. Сервер сам получит токен и сохранит его в этом файле:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Полная инструкция: [README](../README.md).

Если VK Ads вернёт `token_limit_exceeded`, для приложения исчерпан лимит активных токенов. Сервер не отзывает их сам: удалите ненужные токены в кабинете VK Ads и повторите запуск.
