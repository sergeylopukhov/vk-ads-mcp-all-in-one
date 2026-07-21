$ErrorActionPreference = "Stop"

$installerUrl = "https://github.com/sergeylopukhov/vk-ads-mcp-all-in-one/releases/latest/download/install.mjs"
$installerFile = Join-Path ([System.IO.Path]::GetTempPath()) ("vk-ads-mcp-" + [System.Guid]::NewGuid().ToString("N") + ".mjs")

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Установите Node.js 20 или новее: https://nodejs.org/"
}

try {
    Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $installerFile
    & node $installerFile
    if ($LASTEXITCODE -ne 0) {
        throw "Установщик завершился с кодом $LASTEXITCODE."
    }
}
finally {
    Remove-Item -LiteralPath $installerFile -Force -ErrorAction SilentlyContinue
}
