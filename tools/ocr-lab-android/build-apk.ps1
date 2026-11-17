$ErrorActionPreference = 'Stop'
$labRoot = $PSScriptRoot
$labKeys = Join-Path $labRoot '.keys'
$labKey = Join-Path $labKeys 'ocr-lab-test.jks'
$labOutput = Join-Path $labRoot 'artifacts'
$labSdk = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk')) |
    Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'platforms\android-36') -PathType Container) } |
    Select-Object -First 1
if (-not $labSdk) { throw 'Android SDK Platform 36 is required. Set ANDROID_HOME to its SDK root.' }
$labKeytool = if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\keytool.exe'))) {
    Join-Path $env:JAVA_HOME 'bin\keytool.exe'
} else { (Get-Command keytool.exe -ErrorAction Stop).Source }
$labSigner = Join-Path $labSdk 'build-tools\36.0.0\apksigner.bat'
if (-not (Test-Path -LiteralPath $labSigner -PathType Leaf)) { throw 'Install Android SDK Build-Tools 36.0.0.' }

$previousAndroidHome = $env:ANDROID_HOME
try {
    $env:ANDROID_HOME = $labSdk
    New-Item -ItemType Directory -Path $labKeys,$labOutput -Force | Out-Null
    if (-not (Test-Path -LiteralPath $labKey -PathType Leaf)) {
        & $labKeytool -genkeypair -noprompt -storetype JKS -keystore $labKey -alias ocr-lab-test `
            -storepass ocr-lab-only -keypass ocr-lab-only -dname 'CN=Chipmunks OCR Lab Test' `
            -keyalg RSA -keysize 2048 -validity 3650
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the dedicated OCR lab test key.' }
    }
    Push-Location -LiteralPath $labRoot
    try {
        & .\gradlew.bat --no-daemon --max-workers=2 :app:assembleDebug
        if ($LASTEXITCODE -ne 0) { throw 'OCR lab APK build failed.' }
    } finally { Pop-Location }

    $labBuilt = Join-Path $labRoot 'app\build\outputs\apk\debug\app-debug.apk'
    & $labSigner verify --print-certs $labBuilt
    if ($LASTEXITCODE -ne 0) { throw 'OCR lab APK signature verification failed.' }
    $labDelivery = Join-Path $labOutput 'Chipmunks-OCR-Lab.apk'
    Copy-Item -LiteralPath $labBuilt -Destination $labDelivery -Force
    Get-FileHash -LiteralPath $labDelivery -Algorithm SHA256
    Write-Host "OCR lab APK: $labDelivery"
} finally {
    $env:ANDROID_HOME = $previousAndroidHome
}
