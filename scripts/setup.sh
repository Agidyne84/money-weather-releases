#!/bin/bash

# Budget App Setup Script
# This script sets up the development environment for the Budget App

echo "🚀 Setting up Budget App development environment..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v18 or higher."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18 or higher is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install client dependencies
echo "📦 Installing client dependencies..."
cd client
npm install
if [ $? -ne 0 ]; then
    echo "❌ Failed to install client dependencies"
    exit 1
fi
cd ..

# Install server dependencies
echo "📦 Installing server dependencies..."
cd server
npm install
if [ $? -ne 0 ]; then
    echo "❌ Failed to install server dependencies"
    exit 1
fi
cd ..

# Install Electron dependencies (optional)
echo "📦 Installing Electron dependencies..."
cd electron
npm install
if [ $? -ne 0 ]; then
    echo "❌ Failed to install Electron dependencies"
    exit 1
fi
cd ..

# Build server to initialize database
echo "🔧 Building server to initialize database..."
cd server
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Failed to build server"
    exit 1
fi
cd ..

echo "✅ Setup completed successfully!"
echo ""
echo "🎯 Next steps:"
echo "1. Start the server: cd server && npm run dev"
echo "2. Start the client: cd client && npm run dev"
echo "3. Open http://localhost:3000 in your browser"
echo ""
echo "💡 For desktop app: cd electron && npm start"
