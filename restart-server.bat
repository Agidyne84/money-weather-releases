@echo off
REM Kill any process on port 3001
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do taskkill /PID %%a /F 2>nul

REM Run database migration
node server\database\migrate-check.js

REM Start the API server
cd server
npm run dev
