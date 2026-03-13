-- Budget App Database Schema
-- Local SQLite database for privacy-first budgeting

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category_id TEXT NOT NULL,
    type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
    is_recurring BOOLEAN DEFAULT FALSE,
    recurring_frequency TEXT CHECK(recurring_frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

-- Budgets table
CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
    year INTEGER NOT NULL,
    total_income REAL DEFAULT 0,
    total_expenses REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(month, year)
);

-- Budget categories table (category budgets for a specific month)
CREATE TABLE IF NOT EXISTS budget_categories (
    id TEXT PRIMARY KEY,
    budget_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    budgeted_amount REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    UNIQUE(budget_id, category_id)
);

-- Forecasts table
CREATE TABLE IF NOT EXISTS forecasts (
    id TEXT PRIMARY KEY,
    month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
    year INTEGER NOT NULL,
    projected_income REAL NOT NULL DEFAULT 0,
    projected_expenses REAL NOT NULL DEFAULT 0,
    projected_net_income REAL NOT NULL DEFAULT 0,
    confidence REAL DEFAULT 0.8,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(month, year)
);

-- Forecast chokepoints table
CREATE TABLE IF NOT EXISTS forecast_chokepoints (
    id TEXT PRIMARY KEY,
    forecast_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    severity TEXT CHECK(severity IN ('low', 'medium', 'high')) NOT NULL,
    description TEXT NOT NULL,
    projected_overrun REAL NOT NULL DEFAULT 0,
    recommendations TEXT, -- JSON array of recommendations
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (forecast_id) REFERENCES forecasts(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

-- User preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default categories
INSERT OR IGNORE INTO categories (id, name, color) VALUES
    ('cat-income', 'Income', '#10B981'),
    ('cat-groceries', 'Groceries', '#F59E0B'),
    ('cat-entertainment', 'Entertainment', '#8B5CF6'),
    ('cat-utilities', 'Utilities', '#3B82F6'),
    ('cat-housing', 'Housing', '#EF4444'),
    ('cat-transportation', 'Transportation', '#6B7280'),
    ('cat-healthcare', 'Healthcare', '#EC4899'),
    ('cat-savings', 'Savings', '#14B8A6'),
    ('cat-other', 'Other', '#6B7280');

-- Insert default user preferences
INSERT OR IGNORE INTO user_preferences (key, value) VALUES
    ('currency', 'USD'),
    ('date_format', 'MM/DD/YYYY'),
    ('start_of_month', '1'),
    ('forecast_months', '3');
