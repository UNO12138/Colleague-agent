$ErrorActionPreference = 'Stop'

$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendUrl = 'http://127.0.0.1:5173/'
$agentHealthUrl = 'http://127.0.0.1:8787/health'
$logDirectory = Join-Path $projectDirectory '.launcher-logs'
$nodeExecutable = 'C:\Program Files\nodejs\node.exe'
$npmExecutable = 'C:\Program Files\nodejs\npm.cmd'
$viteScript = Join-Path $projectDirectory 'node_modules\vite\bin\vite.js'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

if (-not (Test-Path -LiteralPath $nodeExecutable)) {
  $nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
}

if (-not (Test-Path -LiteralPath $npmExecutable)) {
  $npmExecutable = (Get-Command npm.cmd -ErrorAction Stop).Source
}

if (-not (Test-Path -LiteralPath $viteScript)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('Project dependencies are missing. Run npm install in the project folder.', 'Alex Colleague Agent') | Out-Null
  exit 1
}

function Test-LocalEndpoint {
  param([Parameter(Mandatory = $true)][string]$Url)

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-LocalEndpoint {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalEndpoint -Url $Url) { return $true }
    Start-Sleep -Milliseconds 350
  }
  return $false
}

$frontendReady = Test-LocalEndpoint -Url $frontendUrl
$agentReady = Test-LocalEndpoint -Url $agentHealthUrl

if (-not $frontendReady) {
  Start-Process -FilePath $nodeExecutable `
    -ArgumentList @($viteScript, '--host', '127.0.0.1') `
    -WorkingDirectory $projectDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDirectory 'frontend.log') `
    -RedirectStandardError (Join-Path $logDirectory 'frontend-error.log')
}

if (-not $agentReady) {
  Start-Process -FilePath $nodeExecutable `
    -ArgumentList @('--env-file-if-exists=.env.local', 'agent-server.cjs') `
    -WorkingDirectory $projectDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDirectory 'agent.log') `
    -RedirectStandardError (Join-Path $logDirectory 'agent-error.log')
}

if (-not (Wait-LocalEndpoint -Url $frontendUrl) -or -not (Wait-LocalEndpoint -Url $agentHealthUrl)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('Local services failed to start. Check Node.js and the project dependencies.', 'Alex Colleague Agent') | Out-Null
  exit 1
}

$runningWindow = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$projectDirectory*" } |
  Select-Object -First 1

if (-not $runningWindow) {
  $env:ELECTRON_RENDERER_URL = $frontendUrl.TrimEnd('/')
  Start-Process -FilePath $npmExecutable `
    -ArgumentList @('start') `
    -WorkingDirectory $projectDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDirectory 'electron.log') `
    -RedirectStandardError (Join-Path $logDirectory 'electron-error.log')
}
