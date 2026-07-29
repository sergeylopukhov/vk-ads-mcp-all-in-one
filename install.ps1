$ErrorActionPreference = "Stop"

$repository = "sergeylopukhov/vk-ads-mcp-all-in-one"
$installerUrl = if ($env:VK_ADS_INSTALLER_URL) {
    $env:VK_ADS_INSTALLER_URL
} else {
    "https://github.com/$repository/releases/latest/download/install.mjs"
}
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("vk-ads-mcp-" + [System.Guid]::NewGuid().ToString("N"))
$installerFile = Join-Path $temporaryDirectory "install.mjs"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Установите Node.js 22 или новее: https://nodejs.org/"
}

New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

try {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $installerFile
    }
    catch {
        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
            throw "Приватный релиз требует авторизованный GitHub CLI: gh auth login"
        }
        & gh release download --repo $repository --pattern install.mjs --dir $temporaryDirectory --clobber
        if ($LASTEXITCODE -ne 0) {
            throw "Не удалось скачать install.mjs из приватного релиза."
        }
    }

    & node $installerFile @args
    if ($LASTEXITCODE -ne 0) {
        throw "Установщик завершился с кодом $LASTEXITCODE."
    }
}
finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
