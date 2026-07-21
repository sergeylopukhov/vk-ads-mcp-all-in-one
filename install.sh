#!/bin/sh

set -eu

INSTALLER_URL=${VK_ADS_INSTALLER_URL:-"https://raw.githubusercontent.com/sergeylopukhov/vk-ads-mcp-all-in-one/main/install.mjs"}

if ! command -v node >/dev/null 2>&1; then
  echo "Ошибка: установите Node.js 20 или новее: https://nodejs.org/" >&2
  exit 1
fi

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/vk-ads-mcp.XXXXXX")
installer_file="$temporary_directory/install.mjs"
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM

curl -fsSL "$INSTALLER_URL" -o "$installer_file"

# При запуске через curl | sh возвращаем интерактивный ввод терминалу.
if [ -c /dev/tty ] && (: </dev/tty) 2>/dev/null; then
  node "$installer_file" "$@" </dev/tty
else
  node "$installer_file" "$@"
fi
