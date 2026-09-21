@echo off
setlocal
node "%~dp0..\scripts\webctl-rpc.mjs" %*
if "%ERRORLEVEL%"=="42" (
  node "%~dp0..\scripts\launcher.mjs" webctl %*
  exit /b %ERRORLEVEL%
)
exit /b %ERRORLEVEL%
