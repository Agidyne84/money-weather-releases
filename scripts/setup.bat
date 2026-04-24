@echo off
echo Setting up Budget App...

echo Installing server dependencies...
cd server
npm install

echo Building server to initialize database...
npm run build

echo Installing client dependencies...
cd ../client
npm install

echo Installing Electron dependencies...
cd ../electron
npm install

echo.
echo Setup complete!
echo.
echo To run the application:
echo 1. Start the server: cd server && npm run dev
echo 2. Start the client: cd client && npm run dev
echo 3. Or run Electron: cd electron && npm start
echo.
pause
