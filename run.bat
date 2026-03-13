@echo off
echo ================================================
echo  Project Tracker - Daily Installation Log
echo ================================================
echo.

:: Detect Python command (python3 preferred, fall back to python)
python3 --version >nul 2>&1
if errorlevel 1 (
    python --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Python is not installed or not in PATH.
        echo.
        echo Please install Python from: https://www.python.org/downloads/
        echo During install, CHECK the box that says "Add Python to PATH"
        echo Then close and re-open this file.
        echo.
        pause
        exit /b 1
    )
    set PYTHON=python
) else (
    set PYTHON=python3
)

echo Python found:
%PYTHON% --version
echo.

echo Installing / updating dependencies...
%PYTHON% -m pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo Running database migrations...
%PYTHON% migrate.py
echo.
echo ================================================
echo  Server starting...
echo  Open your browser to: http://localhost:5000
echo  Press Ctrl+C to stop.
echo ================================================
echo.

%PYTHON% app.py
pause
