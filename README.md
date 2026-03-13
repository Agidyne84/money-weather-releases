# Budget App

A privacy-first, local-first personal budgeting application with forecasting capabilities and chokepoint identification.

## Features

- **Privacy-First**: All data stored locally on your device. No cloud storage, no data collection.
- **Cross-Device**: Works on desktop (Electron) and mobile (Progressive Web App)
- **Budget Tracking**: Monthly budget planning and tracking by category
- **Transaction Management**: Add, edit, and categorize income and expenses
- **Forecasting**: AI-powered financial forecasting for future months
- **Chokepoint Detection**: Identifies potential budget problems before they happen
- **Data Sync**: Export/import functionality for cross-device synchronization

## Technology Stack

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Node.js + Express + SQLite
- **Desktop**: Electron wrapper
- **Mobile**: Progressive Web App (PWA)
- **Database**: Local SQLite database

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd BudgetApp
```

2. Install dependencies:
```bash
# Install client dependencies
cd client
npm install

# Install server dependencies
cd ../server
npm install

# Install Electron dependencies (optional, for desktop app)
cd ../electron
npm install
```

3. Start the development servers:

**Terminal 1 - Start the backend server:**
```bash
cd server
npm run dev
```

**Terminal 2 - Start the frontend:**
```bash
cd client
npm run dev
```

4. Open your browser and navigate to `http://localhost:3000`

### Desktop App

To run the desktop Electron app:

```bash
cd electron
npm start
```

## Project Structure

```
BudgetApp/
├── client/              # React frontend (PWA)
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── pages/       # Page components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── utils/       # Utility functions
│   │   ├── types/       # TypeScript type definitions
│   │   └── services/    # API service layer
│   ├── public/          # Static assets
│   └── package.json
├── server/              # Node.js backend
│   ├── src/
│   │   ├── routes/      # API routes
│   │   ├── models/      # Database models
│   │   ├── middleware/  # Express middleware
│   │   ├── services/    # Business logic
│   │   └── utils/       # Utility functions
│   ├── database/        # Database schema and migrations
│   └── package.json
├── electron/            # Electron desktop wrapper
│   ├── main.js          # Electron main process
│   └── package.json
├── shared/              # Shared types and utilities
├── docs/               # Documentation
└── scripts/            # Build and deployment scripts
```

## Data Sync Strategy

Since this is a privacy-first app, data synchronization is handled through file-based export/import:

1. **Export Data**: Users can export their data as a JSON file
2. **Import Data**: Users can import the JSON file on another device
3. **No Cloud Storage**: You never have access to user financial data

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/categories` - Get all categories
- `GET /api/transactions` - Get transactions
- `POST /api/transactions` - Create transaction
- `GET /api/budget/summary/:year/:month` - Get budget summary
- `GET /api/export` - Export all data
- `POST /api/import` - Import data

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Privacy Policy

This application is designed to be privacy-first:
- All data is stored locally on the user's device
- No data is transmitted to external servers
- No analytics or tracking
- Users have complete control over their financial data
