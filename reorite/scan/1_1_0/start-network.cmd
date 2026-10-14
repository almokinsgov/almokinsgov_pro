@echo off
setlocal
node "%~dp0server.mjs" --root "%~dp0." --port 5534 --host 0.0.0.0 %*
exit /b %errorlevel%
