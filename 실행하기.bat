@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo.
echo   금집부쌤의 서울시 통합 부동산 대시보드
echo   ------------------------------------------------
echo   브라우저에서 http://localhost:8899 를 여세요.
echo   (창을 닫으면 서버가 종료됩니다)
echo.
start "" http://localhost:8899
py -m http.server 8899 --directory docs
pause
