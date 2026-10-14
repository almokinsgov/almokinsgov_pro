@echo off
setlocal
node "%~dp0server.mjs" --root "%~dp0." --port 5534 %*
exit /b %errorlevel%
