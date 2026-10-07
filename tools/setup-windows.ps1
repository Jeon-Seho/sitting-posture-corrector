# 새 Windows PC 한 번에 준비: 필수 프로그램 → 저장소 → 의존성 → 바탕화면 바로가기.
# 사용: PowerShell에서 실행. 다른 경로·브랜치는 인자로 바꾼다.
#   powershell -ExecutionPolicy Bypass -File setup-windows.ps1 [-Repo C:\sitting-posture-corrector] [-Branch lee_app1]
param(
    [string]$Repo = "C:\sitting-posture-corrector",
    [string]$Branch = "lee_app1",
    [string]$Remote = "https://github.com/Jeon-Seho/sitting-posture-corrector.git"
)
$ErrorActionPreference = "Stop"

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

function Ensure-Tool($command, $wingetId) {
    if (Get-Command $command -ErrorAction SilentlyContinue) { Write-Host "[ok] $command"; return }
    Write-Host "[install] $wingetId"
    winget install --id $wingetId -e --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { throw "$wingetId 설치 실패" }
    Refresh-Path
}

# 1. 필수 프로그램 (Git, Node.js 24 이상 LTS, Python 3.13)
Ensure-Tool git "Git.Git"
Ensure-Tool node "OpenJS.NodeJS.LTS"
# Microsoft Store의 python 별칭은 실제 설치가 아니므로 버전 출력으로 확인한다.
$hasPython = $false
try { $hasPython = (& python --version 2>&1) -match "^Python 3\." } catch {}
if (-not $hasPython) { Ensure-Tool py "Python.Python.3.13"; Refresh-Path }

$nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 24) { throw "Node.js 24 이상이 필요합니다. 현재: $(node -v)" }

# 2. 저장소와 브랜치
if (-not (Test-Path "$Repo\.git")) { git clone $Remote $Repo }
Set-Location $Repo
git fetch origin
git switch $Branch
git pull --ff-only

# 3. 의존성: .venv + jsonschema, npm ci(Electron 포함), MediaPipe 모델 다운로드
$python = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "py" }
& $python tools/dev.py setup
if ($LASTEXITCODE -ne 0) { throw "setup 실패" }

# 4. 바탕화면 바로가기
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell

$app = $shell.CreateShortcut("$desktop\PoseGood (개발).lnk")
$app.TargetPath = (Get-Command node).Source
$app.Arguments = "electron\launch-dev.mjs"
$app.WorkingDirectory = "$Repo\frontend"
$app.WindowStyle = 7
$app.Save()

Write-Host "완료: 바탕화면의 'PoseGood (개발)'을 실행하세요."
