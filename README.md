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
- **Pages**: Dashboard, Budget, Forecast, History, Accounts, Setup
- **Responsive Design**: Tailwind CSS styling
- **Privacy-First**: All data stored locally

### Phase 2 ✅ Complete
- **Database Integration**: SQLite with full schema
- **Data Persistence**: Real transaction and account management
- **Frequency Engine**: Custom transaction scheduling (days/weeks/months/years/custom)
- **Hierarchical Categories**: Parent/child category system with color support
- **Forecast & Overrides**: One-time amount overrides, posted transaction tracking
- **History Management**: Archived transactions with reset-to-budget functionality

### Phase 3 ✅ Complete
- **Bank CSV Import**: Drag-and-drop + file-picker with column auto-detection
- **Reconciliation UI**: Assign bank rows to budget items with date matching
- **Grouped Rows**: Related history rows grouped under assigned bank rows
- **Duplicate Detection**: Yellow highlighting, default unchecked, confirmation on re-import
- **+ New Budget Item**: Create placeholder items (0 amount, monthly) directly from reconciliation
- **Superseded Display**: Strikethrough + badge for forecast/history rows replaced by bank imports
- **Rules Engine**: LCS-based auto-assignment rules, suggest/auto mode toggle, per-row Accept/Reject, rule management on Setup page
- **Pre-commit Summary**: Review modal before finalising import
- **Transfer Preservation**: Matched transfer budget items create transfer-type history rows with correct destination account
- **Bank Description Retention**: Original CSV descriptions preserved on history rows for audit and rule creation

### Phase 4 ✅ Complete
- **Dashboard Charts**: Balance forecast, spending by category, spending trends ✅
- **Low Balance Analysis**: Configurable alerts per account ✅
- **`is_excluded` filtering**: Dashboard analyses exclude excluded rows ✅
- **Budget Analytics** (Budget page): Account-specific arc gauges (Checking/Savings/Credit), dual-zone overage visualization, month navigation, drill-down charts with History navigation ✅
- **History Enhancements**: Expandable BANK rows showing original bank descriptions, advanced filtering ✅
- **Budget Trend Comparison**: Spending Trend card (Budget Analytics) + Historical Spending Trend (Dashboard) ✅

### UI/UX Polish (Recent)
- **Scroll-to-Top**: Floating arrow button on all pages when scrolled
- **CategorySelector**: Reusable component with inline new-category creation (parent groups, colors)
- **Zero-Amount Budget Items**: Allowed with confirmation for placeholder transactions
- **History Badges**: "Bank" badge for imported rows, "Edited" for manual edits, "Superseded" for replaced rows

### Phase 5 📋 Planned — Reconciliation & Import
- **Transfer Metadata**: Show transfer destination account in History row metadata

### Phase 6 📋 Planned — Data Management & Distribution
- **Data Export/Import**: JSON/CSV backup and restore
- **Desktop App**: Electron packaging and distribution
- **Cross-Device Sync**: Research local sync options

### Phase 7 📋 Planned — Future Features
- **Pause/Resume**: Wiring for seasonal expense pausing (UI present, backend hookup needed)
- **Local Budget Suggestions**: Algorithmic trend-based budget recommendations (no AI)

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

### Bank Import
- `POST /api/import/preview` - Preview CSV rows with column detection
- `POST /api/import/commit` - Commit reconciled bank rows to history

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
