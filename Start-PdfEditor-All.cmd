@echo off
setlocal

title Start PdfEditor
set "REPO_ROOT=%~dp0"
pushd "%REPO_ROOT%" >nul || exit /b 1

set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL_EXE%" set "POWERSHELL_EXE=powershell.exe"

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%scripts\run-all.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo Failed to start PdfEditor applications.
    echo Review the message above, then press any key to close this window.
    pause >nul
)

popd >nul
endlocal & exit /b %EXIT_CODE%
