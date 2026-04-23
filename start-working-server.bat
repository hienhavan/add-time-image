@echo off
echo Starting minimal server...
echo.
echo Server will start at: http://localhost:3002
echo Test ZIP: http://localhost:3002/export
echo.
node minimal-server.js --port 3002
pause
