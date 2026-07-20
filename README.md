<p align="center">
  <img src="assets/cover.png" alt="VK Ads MCP: аналитика и управление рекламой" width="100%">
</p>

<p align="center">
  <img src="assets/logo.png" alt="Логотип VK Ads MCP" width="160">
</p>

<h1 align="center">VK Ads MCP All in One</h1>

<p align="center">
  Локальный MCP-сервер для безопасной работы с VK Ads
</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 20+"></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-stdio-1f6feb" alt="MCP stdio"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0b8f60" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/version-0.1.0-6b7280" alt="Version 0.1.0">
</p>

Работает с рекламными планами, группами, объявлениями, аудиториями, статистикой, медиа и отчётами. По умолчанию ничего не меняет.

Подходит для Codex, Claude Code, Gemini CLI, Qwen Code, Kimi Code CLI и других MCP-клиентов со стандартным `stdio`.

> [!IMPORTANT]
> Сервер работает только с VK Ads. Интеграций с сообществами VK и отдельного Core VK OAuth в проекте нет.

## Содержание

- [Быстрый старт](#быстрый-старт)
- [Возможности](#возможности)
- [Безопасная запись](#безопасная-запись)
- [Безопасность](#безопасность)

## Быстрый старт

Нужен Node.js 20 или новее.

### 1. Скачать и собрать

```bash
git clone https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one.git vk-ads-mcp
cd vk-ads-mcp
npm ci
npm run build
```

### 2. Настроить доступ VK Ads

Нужен токен VK Ads или собственные `VK_ADS_CLIENT_ID` и `VK_ADS_CLIENT_SECRET`.

macOS: сохраните уже полученный токен в Keychain. Команда запросит его скрыто и не создаст файл в репозитории.

```bash
read -s "VK_ADS_TOKEN?Токен VK Ads: "
security add-generic-password -U -a default -s vk-ads-mcp -w "$VK_ADS_TOKEN"
unset VK_ADS_TOKEN
```

Windows и Linux: зашифрованное локальное хранилище поддерживается, но оно наполняется через OAuth. Если есть только готовый токен, передайте `VK_ADS_TOKEN` защищённому окружению процесса, который запускает MCP-клиент, а не в Git, `.env` или JSON-конфигурацию.

OAuth-подключение через `vk_ads_oauth_begin` доступно только для собственного заранее настроенного приложения VK Ads.

### 3. Подключить MCP-клиент

Укажите абсолютный путь к `dist/index.js`. Токен в настройки клиента не добавляйте.

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "node",
      "args": ["/полный/путь/vk-ads-mcp/dist/index.js"],
      "env": {
        "VK_ADS_PROFILE": "default"
      }
    }
  }
}
```

Готовые команды для каждого клиента: [readme/setup-clients.md](readme/setup-clients.md). Для Codex: [readme/setup-codex.md](readme/setup-codex.md).

### 4. Проверить подключение

Отправьте в клиенте:

```text
Покажи контекст подключения VK Ads и доступные рекламные планы. Ничего не меняй.
```

Если доступ работает, сервер вернёт профиль и рекламные планы.

## Возможности

| Раздел | Что можно делать |
| --- | --- |
| Аналитика | Получать статистику, сравнивать периоды и находить проблемные кампании. |
| Управление | Читать структуру рекламы и создавать только изолированные test-объекты. |
| Креативы | Проверять изображения, видео, HTML5 и параметры объявления до отправки. |
| Отчёты | Работать с аудиториями, лид-формами, сегментами, экспортом и отчётами. |

Полный список: `search_tools`.

## Безопасная запись

Запись выключена. Для тестов включите её явно:

```bash
VK_ADS_MODE=write node dist/index.js
```

Сервер проверяет данные, показывает preview, ждёт точного подтверждения и перечитывает результат. Рабочие кампании, группы, объявления, аудитории, счётчики и бюджеты не изменяются.

## Безопасность

- не публикуйте токены, `client_secret`, пароль хранилища и персональные данные;
- не добавляйте их в Git, `.env` и MCP-конфигурацию;
- храните загружаемые файлы в отдельной папке и указывайте её через `VK_ADS_UPLOAD_DIR`.

Подробности: [SECURITY.md](SECURITY.md). Лицензия: [MIT](LICENSE).
