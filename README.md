# Budget App

A privacy-first, locally-hosted budget management application built with React, TypeScript, and Node.js.

## 🚀 Quick Start

### Prerequisites
- Node.js (v18 or higher)
- npm (comes with Node.js)

### Installation
```bash
# Install dependencies for all components
scripts\setup.bat
```

### Running the Application

#### Option 1: Web Development
```bash
# Terminal 1: Start the backend server
cd server
npm start

# Terminal 2: Start the frontend client
cd client
npm run dev
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

#### Option 2: Electron Desktop App
```bash
cd electron
npm start
```

## 📁 Project Structure

```
BudgetApp/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/         # Page components
│   │   ├── App.tsx        # Main app with routing
│   │   └── main.tsx       # Entry point
│   ├── package.json
│   └── vite.config.ts
├── server/                # Node.js backend
│   ├── src/
│   │   └── index.ts       # Express server with API
│   ├── database/
│   │   └── schema.sql     # SQLite database schema
│   └── package.json
├── electron/              # Electron desktop wrapper
│   ├── main.js           # Electron main process
│   └── package.json
├── shared/                # Shared types and utilities
├── docs/                  # Documentation
└── scripts/              # Setup and utility scripts
```

## 🎯 Features

### Phase 1 ✅ Complete
- **Frontend Structure**: React + TypeScript with routing
- **Backend API**: Express server with RESTful endpoints
- **Pages**: Dashboard, Transactions, Budget, Forecast
- **Responsive Design**: Tailwind CSS styling
- **Privacy-First**: All data stored locally

### Phase 2 🚧 In Progress
- **Database Integration**: SQLite with full schema
- **Data Persistence**: Real transaction and account management
- **Frequency Engine**: Custom transaction scheduling
- **Import/Export**: Data synchronization capabilities

### Phase 3 📋 Planned
- **Bank Integration**: CSV import from banks
- **Advanced Analytics**: Spending insights and reports
- **Mobile Support**: Responsive design optimization
- **Desktop App**: Electron packaging and distribution

## 🔧 Technology Stack

### Frontend
- **React 18**: Modern UI framework
- **TypeScript**: Type-safe development
- **Vite**: Fast build tool and dev server
- **Tailwind CSS**: Utility-first styling
- **React Router**: Client-side routing

### Backend
- **Node.js**: JavaScript runtime
- **Express**: Web framework
- **SQLite**: Local database storage
- **TypeScript**: Type-safe API development

### Desktop
- **Electron**: Cross-platform desktop app

## 📊 API Endpoints

### Accounts
- `GET /api/accounts` - List all accounts
- `POST /api/accounts` - Create new account

### Categories
- `GET /api/categories` - List hierarchical categories
- `POST /api/categories` - Create new category

### Transactions
- `GET /api/transactions` - List transactions
- `POST /api/transactions` - Create transaction

### Data Management
- `GET /api/export` - Export all data
- `POST /api/import` - Import data

### Health
- `GET /api/health` - Server health check

## 🔒 Privacy & Security

- **Local Storage**: All data stored in SQLite database on your machine
- **No External APIs**: No data transmitted to external services
- **Export Control**: You control when and how data is shared
- **Open Source**: Full transparency and auditability

## 🛠️ Development

### Running Tests
```bash
# Frontend tests
cd client && npm test

# Backend tests
cd server && npm test
```

### Building for Production
```bash
# Build frontend
cd client && npm run build

# Build backend
cd server && npm run build

# Build Electron app
cd electron && npm run build
```

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📞 Support

For questions, issues, or feature requests, please open an issue on the project repository.
