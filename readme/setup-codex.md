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

Не передавайте токен, `client_secret` и пароль хранилища в `codex mcp add`.

## 3. Проверьте доступ

Откройте Codex и отправьте:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Как безопасно сохранить токен или настроить OAuth: [README](../README.md#быстрый-старт).
