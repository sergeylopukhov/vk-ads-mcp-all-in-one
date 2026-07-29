# Подключение к MCP-клиентам

> [!TIP]
> Рекомендуемый способ — запустить единый установщик. Он найдёт поддерживаемые MCP-клиенты, подключит сервер `vk-ads`, проверит регистрацию и установит навык `vk-ads-mcp` для каждого выбранного клиента.

## Автоматическая настройка

### 1. Запустите установщик

Установите сервер по [основной инструкции](../README.md#быстрый-старт) или сразу выполните:

```bash
npx --yes github:sergeylopukhov/vk-ads-mcp-all-in-one
```

### 2. Выберите клиенты

В интерактивном режиме установщик покажет найденные клиенты с галочками. Перемещайтесь стрелками `↑/↓`, снимайте и ставьте галочки пробелом, подтверждайте выбор клавишей Enter. По умолчанию отмечены все найденные клиенты. Для продолжения нужен хотя бы один.

Если не нужно подключать сервер ни к одному клиенту, запустите установщик с параметром `--no-register`.

<table width="100%">
  <thead>
    <tr>
      <th width="30%">Параметр</th>
      <th width="70%">Результат</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>--clients opencode,codex,claude</code></td>
      <td>Подключает только перечисленные клиенты</td>
    </tr>
    <tr>
      <td><code>--all-detected</code></td>
      <td>Подключает все найденные клиенты без вопроса</td>
    </tr>
    <tr>
      <td><code>--no-register</code></td>
      <td>Устанавливает сервер, но не меняет настройки MCP-клиентов и не устанавливает навык</td>
    </tr>
  </tbody>
</table>

Пример настройки всех поддерживаемых клиентов:

```bash
npx --yes github:sergeylopukhov/vk-ads-mcp-all-in-one --clients opencode,codex,claude,gemini,qwen,kimi,cursor
```

> [!NOTE]
> Параметр `--no-register` нельзя использовать вместе с `--clients` или `--all-detected`.

<details>
<summary><strong>Что настраивается для каждого клиента</strong></summary>

<table width="100%">
  <thead>
    <tr>
      <th width="22%">Клиент</th>
      <th width="48%">Подключение MCP</th>
      <th width="30%">Каталог навыка</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Codex CLI</td>
      <td>Пользовательское подключение <code>vk-ads</code> через Codex CLI</td>
      <td><code>~/.agents/skills/vk-ads-mcp/</code></td>
    </tr>
    <tr>
      <td>Claude Code</td>
      <td>Пользовательское подключение <code>vk-ads</code> через Claude Code CLI</td>
      <td><code>~/.claude/skills/vk-ads-mcp/</code></td>
    </tr>
    <tr>
      <td>Gemini CLI</td>
      <td>Пользовательское подключение <code>vk-ads</code> через Gemini CLI</td>
      <td><code>~/.gemini/skills/vk-ads-mcp/</code></td>
    </tr>
    <tr>
      <td>Qwen Code</td>
      <td>Пользовательское подключение <code>vk-ads</code> через Qwen Code CLI</td>
      <td><code>~/.qwen/skills/vk-ads-mcp/</code></td>
    </tr>
    <tr>
      <td>Kimi Code CLI</td>
      <td><code>$KIMI_CODE_HOME/mcp.json</code> или <code>~/.kimi-code/mcp.json</code></td>
      <td><code>$KIMI_CODE_HOME/skills/vk-ads-mcp/</code> или <code>~/.kimi-code/skills/vk-ads-mcp/</code></td>
    </tr>
    <tr>
      <td>OpenCode</td>
      <td><code>~/.config/opencode/opencode.json</code></td>
      <td><code>~/.config/opencode/skills/vk-ads-mcp/</code></td>
    </tr>
    <tr>
      <td>Cursor</td>
      <td><code>~/.cursor/mcp.json</code></td>
      <td><code>~/.cursor/skills/vk-ads-mcp/</code></td>
    </tr>
  </tbody>
</table>

При обновлении заменяется только каталог `vk-ads-mcp`; остальные навыки не изменяются. Старую копию Codex из `~/.codex/skills/vk-ads-mcp/` установщик переносит в `~/.codex/skill-backups/`. Перед изменением существующей конфигурации Kimi, OpenCode или Cursor установщик создаёт резервную копию с датой и временем в имени. Если задан `XDG_CONFIG_HOME`, OpenCode использует каталог `opencode` внутри него.

</details>

<details>
<summary><strong>Интерактивный опросник для поиска сообществ</strong></summary>

Если для поиска сообществ не хватает пяти и более параметров, навык предлагает ответить в чате или установить [интерактивный опросник](https://github.com/sergeylopukhov/interactive-project-questionnaire). При меньшем числе уточнений вопросы задаются в чате.

Опросник устанавливается только после согласия пользователя. Агент клонирует его репозиторий во временную папку и запускает универсальный установщик:

```bash
python3 scripts/install_skill.py --agent auto
```

Если клиент не определился автоматически, используется его профиль, например `--agent claude`. Для нескольких клиентов можно повторить `--agent` или указать `--agent all`. Существующая копия не перезаписывается без отдельного запроса на обновление.

</details>

### 3. Перезапустите клиент

После установки полностью перезапустите выбранные клиенты и отправьте:

```text
Проверь подключение к VK Рекламе и покажи доступные кампании. Ничего не меняй.
```

Установщик проверяет регистрацию сразу после подключения. При необходимости её можно проверить вручную:

<table width="100%">
  <thead>
    <tr>
      <th width="30%">Клиент</th>
      <th width="70%">Проверка</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Codex CLI</td>
      <td><code>codex mcp get vk-ads</code></td>
    </tr>
    <tr>
      <td>Claude Code</td>
      <td><code>claude mcp get vk-ads</code></td>
    </tr>
    <tr>
      <td>Gemini CLI</td>
      <td><code>gemini mcp list</code></td>
    </tr>
    <tr>
      <td>Qwen Code</td>
      <td><code>qwen mcp list</code></td>
    </tr>
    <tr>
      <td>Kimi Code CLI</td>
      <td>Команда <code>/mcp</code> в Kimi Code CLI</td>
    </tr>
    <tr>
      <td>OpenCode</td>
      <td><code>opencode mcp list</code></td>
    </tr>
    <tr>
      <td>Cursor</td>
      <td>Раздел MCP в настройках Cursor</td>
    </tr>
  </tbody>
</table>

## Ручная настройка

> [!NOTE]
> Используйте ручную настройку, только если автоматическое подключение не подходит. Команды должны содержать абсолютные пути к Node.js и `dist/index.js`: это позволяет клиенту запускать сервер независимо от переменной `PATH`.

Узнайте абсолютный путь к Node.js:

```bash
node -p "process.execPath"
```

Полный каталог VK Ads MCP выводится в конце установки. В примерах ниже замените `/полный/путь/к/node` и `/полный/путь/к/VK Ads MCP` своими значениями.

Чтобы добавить навык вручную, скопируйте весь каталог `codex-skill` из каталога установки сервера в каталог нужного клиента из таблицы выше и переименуйте его в `vk-ads-mcp`.

<details>
<summary><strong>Codex CLI</strong></summary>

```bash
codex mcp remove vk-ads
codex mcp add vk-ads -- "/полный/путь/к/node" "/полный/путь/к/VK Ads MCP/dist/index.js"
codex mcp get vk-ads
```

Подробности: [настройка Codex](setup-codex.md) и [официальная документация Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

</details>

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp remove --scope user vk-ads
claude mcp add --scope user vk-ads -- "/полный/путь/к/node" "/полный/путь/к/VK Ads MCP/dist/index.js"
claude mcp get vk-ads
```

[Официальная документация Claude Code MCP](https://code.claude.com/docs/en/mcp)

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

```bash
gemini mcp remove --scope user vk-ads
gemini mcp add --scope user vk-ads "/полный/путь/к/node" "/полный/путь/к/VK Ads MCP/dist/index.js"
gemini mcp list
```

[Официальная документация Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md#manage-mcp-servers)

</details>

<details>
<summary><strong>Qwen Code</strong></summary>

```bash
qwen mcp remove --scope user vk-ads
qwen mcp add --scope user vk-ads "/полный/путь/к/node" "/полный/путь/к/VK Ads MCP/dist/index.js"
qwen mcp list
```

[Официальная документация Qwen Code MCP](https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/)

</details>

<details>
<summary><strong>Kimi Code CLI</strong></summary>

Добавьте сервер в `$KIMI_CODE_HOME/mcp.json` или `~/.kimi-code/mcp.json`, сохранив другие записи в `mcpServers`:

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "/полный/путь/к/node",
      "args": ["/полный/путь/к/VK Ads MCP/dist/index.js"],
      "enabled": true
    }
  }
}
```

После перезапуска проверьте подключение командой `/mcp`.

[Официальная документация Kimi Code MCP](https://moonshotai.github.io/kimi-code/en/customization/mcp.html)

</details>

<details>
<summary><strong>OpenCode</strong></summary>

Добавьте сервер в `~/.config/opencode/opencode.json`, сохранив другие параметры и записи в `mcp`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "vk-ads": {
      "type": "local",
      "command": [
        "/полный/путь/к/node",
        "/полный/путь/к/VK Ads MCP/dist/index.js"
      ],
      "enabled": true
    }
  }
}
```

Скопируйте каталог навыка в `~/.config/opencode/skills/vk-ads-mcp/`, перезапустите OpenCode и проверьте подключение:

```bash
opencode mcp list
```

[Официальная документация OpenCode MCP](https://opencode.ai/docs/mcp-servers/) · [Официальная документация OpenCode Agent Skills](https://opencode.ai/docs/skills)

</details>

<details>
<summary><strong>Cursor</strong></summary>

Добавьте сервер в `~/.cursor/mcp.json`, сохранив другие записи в `mcpServers`:

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "/полный/путь/к/node",
      "args": ["/полный/путь/к/VK Ads MCP/dist/index.js"]
    }
  }
}
```

После перезапуска откройте раздел MCP в настройках Cursor.

[Официальная документация Cursor MCP](https://docs.cursor.com/context/model-context-protocol)

</details>

<details>
<summary><strong>Другой MCP-клиент</strong></summary>

Клиент должен запускать один локальный процесс по протоколу `stdio`:

```json
{
  "command": "/полный/путь/к/node",
  "args": ["/полный/путь/к/VK Ads MCP/dist/index.js"]
}
```

Переменные окружения в конфигурации MCP не нужны. Сервер читает локальный `auth.env` из каталога установки.

</details>
