#!/bin/sh

set -eu

REPOSITORY="sergeylopukhov/vk-ads-mcp-all-in-one"
INSTALLER_URL=${VK_ADS_INSTALLER_URL:-"https://github.com/$REPOSITORY/releases/latest/download/install.mjs"}

if ! command -v node >/dev/null 2>&1; then
  echo "Ошибка: установите Node.js 22 или новее: https://nodejs.org/" >&2
  exit 1
fi

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/vk-ads-mcp.XXXXXX")
installer_file="$temporary_directory/install.mjs"
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM

if ! curl -fsSL "$INSTALLER_URL" -o "$installer_file"; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "Ошибка: приватный релиз требует авторизованный GitHub CLI: gh auth login" >&2
    exit 1
  fi
  gh release download --repo "$REPOSITORY" --pattern install.mjs --dir "$temporary_directory" --clobber
fi

# При запуске через pipe возвращаем интерактивный ввод терминалу.
if [ -c /dev/tty ] && (: </dev/tty) 2>/dev/null; then
  node "$installer_file" "$@" </dev/tty
else
  node "$installer_file" "$@"
fi
