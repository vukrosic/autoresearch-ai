@echo off
setlocal

set "ROOT=%~dp0"
cd /D "%ROOT%"

if defined AUTORESEARCH_PORT (
  set "PORT=%AUTORESEARCH_PORT%"
) else (
  set "PORT=8792"
)
set "HOST=127.0.0.1"
set "URL=http://%HOST%:%PORT%/"
set "LOG=%TEMP%\autoresearch-dashboard-%PORT%.log"

set "DEFAULT_PROJECT=%USERPROFILE%\Desktop\operator-benchmarks\mlx-benchmark"
if not exist "%DEFAULT_PROJECT%\" set "DEFAULT_PROJECT=%ROOT%"

echo AutoResearch-AI local dashboard
echo --------------------------------
echo Default project: %DEFAULT_PROJECT%
echo.
set /P "PROJECT_DIR=Project folder path (Enter for default): "
if not defined PROJECT_DIR set "PROJECT_DIR=%DEFAULT_PROJECT%"

if not exist "%PROJECT_DIR%\" (
  echo Project folder does not exist:
  echo %PROJECT_DIR%
  pause
  exit /b 1
)

set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do (
  if not defined NODE_EXE set "NODE_EXE=%%N"
)
if not defined NODE_EXE (
  echo Node.js was not found on PATH.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

echo.
echo Preparing dashboard for project:
echo %PROJECT_DIR%
echo URL: %URL%

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $page=(Invoke-WebRequest -UseBasicParsing '%URL%' -TimeoutSec 2).Content; if (($page -match 'denseTraceChart') -and ($page -match 'axisTicks') -and ($page -match 'indexAxisLabel') -and ($page -match 'uiBatchMaxParallel') -and ($page -match 'batchParallelHint') -and ($page -match 'uiBatchStabilityEnabled') -and ($page -match 'X：实验序号')) { exit 0 } else { exit 2 } } catch { exit 1 }" >nul 2>nul
if errorlevel 2 (
  echo Existing process on this port is not the current dashboard UI. Stopping it...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>nul
) else if errorlevel 1 (
  rem No compatible dashboard is running; start one below.
) else (
  echo Compatible dashboard is already running. Switching project...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$body=@{path='%PROJECT_DIR%'} | ConvertTo-Json; try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri '%URL%api/action/switch-project' -ContentType 'application/json' -Body $body | Out-Null } catch {}" >nul 2>nul
  goto ready
)

echo Starting AutoResearch-AI dashboard...
del "%LOG%" >nul 2>nul
start "AutoResearch-AI Dashboard" /MIN cmd /C ""%NODE_EXE%" "%ROOT%bin\researchloop.js" dashboard --dir "%PROJECT_DIR%" --host %HOST% --port %PORT% > "%LOG%" 2>&1"

for /L %%I in (1,1,40) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%URL%api/state' -TimeoutSec 3 | Out-Null; $page=(Invoke-WebRequest -UseBasicParsing '%URL%' -TimeoutSec 3).Content; if (($page -match 'denseTraceChart') -and ($page -match 'axisTicks') -and ($page -match 'indexAxisLabel') -and ($page -match 'uiBatchMaxParallel') -and ($page -match 'batchParallelHint') -and ($page -match 'uiBatchStabilityEnabled') -and ($page -match 'sweepDeleteBtn') -and ($page -match 'X：实验序号')) { exit 0 } else { exit 2 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto ready
  timeout /T 1 /NOBREAK >nul
)

echo Dashboard did not become ready, or it is still the old UI. Recent log:
type "%LOG%" 2>nul
pause
exit /b 1

:ready
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined CHROME (
  start "" "%CHROME%" "%URL%"
) else (
  start "" "%URL%"
)

echo Dashboard is ready: %URL%
echo Project: %PROJECT_DIR%
exit /b 0
