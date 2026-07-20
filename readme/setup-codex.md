# Подключение к Codex

Нужны Node.js 20 или новее и личный токен VK Ads.

## 1. Установите сервер

```bash
curl -fL https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/download/v0.1.0/vk-ads-mcp-0.1.0.zip -o vk-ads-mcp-0.1.0.zip
unzip vk-ads-mcp-0.1.0.zip
cd vk-ads-mcp-0.1.0
npm ci --omit=dev
```

## 2. Сохраните токен

Создайте личный токен в настройках API VK Ads для нужного кабинета. Затем выполните:

```bash
read -s "VK_ADS_TOKEN?Вставьте токен VK Ads и нажмите Enter: "
security add-generic-password -U -a default -s vk-ads-mcp -w "$VK_ADS_TOKEN"
unset VK_ADS_TOKEN
```

Токен сохранится в Keychain и не попадёт в Git или настройки Codex.

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
