@echo off
setlocal
cd /d "%~dp0"
set PORT=%~1
if "%PORT%"=="" set PORT=8082
echo Office Safety Traffic Light v0.2.5
echo Serving http://localhost:%PORT%
echo.
echo Google OAuth must include this exact Authorized JavaScript origin:
echo http://localhost:%PORT%
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server %PORT%
) else (
  python -m http.server %PORT%
)
endlocal
