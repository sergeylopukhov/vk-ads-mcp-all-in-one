# Подключение к Codex

## 1. Соберите сервер

```bash
git clone https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one.git vk-ads-mcp
cd vk-ads-mcp
npm ci
npm run build
```

Нужен Node.js 20 или новее.

## 2. Добавьте сервер

Выполните из папки проекта:

```bash
codex mcp add vk-ads --env VK_ADS_PROFILE=default -- node "$(pwd)/dist/index.js"
codex mcp list
```

Не передавайте токен и пароль хранилища в `codex mcp add`.

## 3. Сохраните личный токен VK Ads

В VK Ads откройте настройки API и создайте личный токен для нужного кабинета. На macOS сохраните его в Keychain:

```bash
read -s "VK_ADS_TOKEN?Токен VK Ads: "
security add-generic-password -U -a default -s vk-ads-mcp -w "$VK_ADS_TOKEN"
unset VK_ADS_TOKEN
```

Токен не добавляйте в Git, `.env` и настройки Codex.

## 4. Проверьте доступ

Откройте Codex и отправьте:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Подробнее: [README](../README.md#быстрый-старт).
