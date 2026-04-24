-- Budget App Database Schema
-- Local SQLite database for privacy-first budgeting

-- Accounts table
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('checking', 'savings', 'credit', 'investment')) NOT NULL,
    starting_balance REAL NOT NULL DEFAULT 0,
    current_balance REAL NOT NULL DEFAULT 0,
    include_in_low_balance_analysis BOOLEAN DEFAULT TRUE,
    import_settings TEXT, -- JSON for import preferences
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Categories table (hierarchical)
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT, -- NULL for top-level categories
    color TEXT NOT NULL DEFAULT '#3B82F6',
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- Transactions table (enhanced)
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    frequency_value INTEGER NOT NULL DEFAULT 1,
    frequency_unit TEXT CHECK(frequency_unit IN ('days', 'weeks', 'months', 'years', 'custom')) NOT NULL DEFAULT 'monthly',
    custom_frequency_pattern TEXT, -- e.g., "1st and 15th"
    start_date DATE NOT NULL,
    end_date DATE, -- NULL for indefinite
    pause_start_date DATE,
    pause_end_date DATE,
    category_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    type TEXT CHECK(type IN ('income', 'expense', 'administrative')) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

-- Forecast overrides table (one-time changes)
CREATE TABLE IF NOT EXISTS forecast_overrides (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    date DATE NOT NULL,
    original_amount REAL NOT NULL,
    override_amount REAL NOT NULL,
    is_posted BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
);

-- Transaction rules table (for import categorization)
CREATE TABLE IF NOT EXISTS transaction_rules (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    pattern TEXT NOT NULL, -- Description pattern to match
    category_id TEXT NOT NULL,
    confidence REAL DEFAULT 0.8,
    match_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

-- Historical transactions table (archived posted transactions)
CREATE TABLE IF NOT EXISTS historical_transactions (
    id TEXT PRIMARY KEY,
    transaction_id TEXT,
    account_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    date DATE NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT CHECK(type IN ('income', 'expense', 'administrative')) NOT NULL,
    -- 1 when a user has manually edited this row via PUT /api/history/:id.
    -- Bi-directional migration honors this flag: rewinds won't delete manual
    -- rows, and advances won't clobber them with auto-generated copies.
    is_manual_edit INTEGER NOT NULL DEFAULT 0,
    -- 1 when this row represents a forecast occurrence that was deleted
    -- from the Forecast view. These appear in History but are filtered from Forecast.
    is_suppressed INTEGER NOT NULL DEFAULT 0,
    archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

-- User preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default hierarchical categories
INSERT OR IGNORE INTO categories (id, name, parent_id, color, sort_order) VALUES
    ('cat-income', 'Income', NULL, '#10B981', 1),
    ('cat-housing', 'Housing', NULL, '#EF4444', 2),
    ('cat-transportation', 'Transportation', NULL, '#6B7280', 3),
    ('cat-food', 'Food', NULL, '#F59E0B', 4),
    ('cat-utilities', 'Utilities', NULL, '#3B82F6', 5),
    ('cat-healthcare', 'Healthcare', NULL, '#EC4899', 6),
    ('cat-savings', 'Savings', NULL, '#14B8A6', 7),
    ('cat-entertainment', 'Entertainment', NULL, '#8B5CF6', 8),
    ('cat-other', 'Other', NULL, '#6B7280', 9);

-- Insert sub-categories
INSERT OR IGNORE INTO categories (id, name, parent_id, color, sort_order) VALUES
    ('cat-groceries', 'Groceries', 'cat-food', '#F59E0B', 1),
    ('cat-restaurants', 'Restaurants', 'cat-food', '#F59E0B', 2),
    ('cat-rent', 'Rent/Mortgage', 'cat-housing', '#EF4444', 1),
    ('cat-home-insurance', 'Home Insurance', 'cat-housing', '#EF4444', 2),
    ('cat-property-tax', 'Property Tax', 'cat-housing', '#EF4444', 3),
    ('cat-gas', 'Gas/Fuel', 'cat-transportation', '#6B7280', 1),
    ('cat-car-insurance', 'Car Insurance', 'cat-transportation', '#6B7280', 2),
    ('cat-car-maintenance', 'Car Maintenance', 'cat-transportation', '#6B7280', 3),
    ('cat-electric', 'Electric', 'cat-utilities', '#3B82F6', 1),
    ('cat-water', 'Water', 'cat-utilities', '#3B82F6', 2),
    ('cat-gas-utility', 'Gas Utility', 'cat-utilities', '#3B82F6', 3),
    ('cat-internet', 'Internet', 'cat-utilities', '#3B82F6', 4),
    ('cat-phone', 'Phone', 'cat-utilities', '#3B82F6', 5);

-- Insert default user preferences
INSERT OR IGNORE INTO user_preferences (key, value) VALUES
    ('currency', 'USD'),
    ('date_format', 'MM/DD/YYYY'),
    ('forecast_start_date', DATE('now')),
    ('low_balance_tracking_count', '10'),
    ('include_net_worth_in_analysis', 'true');
