@echo off
cd /d "%~dp0"
title 금집부쌤의 서울시 통합 부동산 대시보드
echo.
echo   금집부쌤의 서울시 통합 부동산 대시보드
echo   --------------------------------------------------
echo   잠시 후 브라우저에서 http://localhost:8899 가 열립니다.
echo.
echo   * 이 창을 닫으면 서버가 꺼집니다.
echo   * 서버 없이 보려면 index.html 을 더블클릭해도 됩니다.
echo.

where py >nul 2>nul
if errorlevel 1 goto NOPY

start "" /min powershell -NoProfile -Command "Start-Sleep 2; Start-Process 'http://localhost:8899'"
py -m http.server 8899 --directory docs
goto END

:NOPY
echo   [오류] Python을 찾을 수 없습니다.
echo   서버 없이 보시려면 index.html 을 더블클릭하세요.

:END
echo.
pause
