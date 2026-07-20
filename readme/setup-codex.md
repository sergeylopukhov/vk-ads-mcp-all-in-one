# Подключение к Codex

Нужны Node.js 20 или новее и личный токен VK Ads.

## macOS

```bash
curl -fL https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/download/v0.1.0/vk-ads-mcp-0.1.0.zip -o vk-ads-mcp-0.1.0.zip
unzip vk-ads-mcp-0.1.0.zip
cd vk-ads-mcp-0.1.0
npm ci --omit=dev
cp .env.example .env
open -e .env
```

В Linux вместо `open -e .env` используйте `nano .env`.

В файле `.env` укажите:

```text
VK_ADS_TOKEN=ваш_токен
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
npm.cmd ci --omit=dev
Copy-Item .env.example .env
notepad .env
codex mcp remove vk-ads
codex mcp add vk-ads --env VK_ADS_PROFILE=default -- node "$($PWD.Path)\dist\index.js"
```

Сохраните токен в `.env`, перезапустите Codex и отправьте запрос:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Полная инструкция: [README](../README.md).
