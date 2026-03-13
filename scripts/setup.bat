@echo off
REM Budget App Setup Script for Windows
REM This script sets up the development environment for the Budget App

echo 🚀 Setting up Budget App development environment...

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js v18 or higher.
    pause
    exit /b 1
)

echo ✅ Node.js version: 
node --version

REM Install client dependencies
echo 📦 Installing client dependencies...
cd client
call npm install
if %errorlevel% neq 0 (
    echo ❌ Failed to install client dependencies
    pause
    exit /b 1
)
cd ..

REM Install server dependencies
echo 📦 Installing server dependencies...
cd server
call npm install
if %errorlevel% neq 0 (
    echo ❌ Failed to install server dependencies
    pause
    exit /b 1
)
cd ..

REM Install Electron dependencies
echo 📦 Installing Electron dependencies...
cd electron
call npm install
if %errorlevel% neq 0 (
    echo ❌ Failed to install Electron dependencies
    pause
    exit /b 1
)
cd ..

REM Build server to initialize database
echo 🔧 Building server to initialize database...
cd server
call npm run build
if %errorlevel% neq 0 (
    echo ❌ Failed to build server
    pause
    exit /b 1
)
cd ..

echo ✅ Setup completed successfully!
echo.
echo 🎯 Next steps:
echo 1. Start the server: cd server ^&^& npm run dev
echo 2. Start the client: cd client ^&^& npm run dev
echo 3. Open http://localhost:3000 in your browser
echo.
echo 💡 For desktop app: cd electron ^&^& npm start
pause
