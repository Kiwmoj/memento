@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "PYTHON_COMMAND=py"
) else (
  where python >nul 2>nul
  if errorlevel 1 goto :python_missing
  set "PYTHON_COMMAND=python"
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating the Memento Python environment...
  %PYTHON_COMMAND% -m venv .venv
  if errorlevel 1 goto :startup_failed
)

set "APP_PYTHON=.venv\Scripts\python.exe"
echo Checking Memento dependencies...
"%APP_PYTHON%" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto :startup_failed

echo Starting Memento at http://127.0.0.1:8080
set "MEMENTO_OPEN_BROWSER=1"
"%APP_PYTHON%" app.py
if errorlevel 1 goto :startup_failed
exit /b 0

:python_missing
echo Python was not found. Install Python 3 and enable "Add Python to PATH", then try again.

:startup_failed
echo.
echo Memento stopped. Review the error above for the cause.
pause
exit /b 1
