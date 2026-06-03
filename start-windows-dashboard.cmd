@echo off
setlocal

set "ROOT=%~dp0"
cd /D "%ROOT%"

set "PORT=8787"
set "HOST=127.0.0.1"
set "URL=http://%HOST%:%PORT%/"
set "LOG=%TEMP%\autoresearch-dashboard-%PORT%.log"

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

echo Starting AutoResearch-AI dashboard...
echo Project: %ROOT%
echo URL: %URL%

start "AutoResearch-AI Dashboard" /MIN cmd /C ""%NODE_EXE%" "%ROOT%bin\researchloop.js" dashboard --dir "%ROOT%" --host %HOST% --port %PORT% > "%LOG%" 2>&1"

for /L %%I in (1,1,40) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%URL%api/state' | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto ready
  timeout /T 1 /NOBREAK >nul
)

echo Dashboard did not become ready. Recent log:
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
exit /b 0
