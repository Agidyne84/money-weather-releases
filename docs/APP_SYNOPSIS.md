# Budget App - Complete Feature Synopsis

## Overview
A privacy-first, local-first personal budgeting application that replicates and enhances Excel-based budgeting systems with advanced forecasting, transaction management, and balance analysis features.

## Core Philosophy
- **Privacy First**: All data stored locally, never shared without explicit permission
- **User Control**: Complete ownership of financial data and export/import capabilities
- **No External Dependencies**: Core functionality works entirely offline
- **Enhanced Excel Workflow**: Maintains familiarity while adding automation and intelligence

## Key Features

### 🏦 Monthly Budget Management
- **Flexible Transaction Scheduling**: 
  - Number + dropdown (days/weeks/months/years)
  - Custom patterns (e.g., "1st and 15th of each month")
  - Seasonal expenses with pause/resume capability
- **Dynamic Transaction Changes**: Automatic handling of amount changes with date-based transitions
- **Hierarchical Categories**: Pre-defined structure (Food > Groceries) with full customization
- **Account Assignment**: Multiple account types (checking, savings, credit, investment)

### 📊 Forecast & Transaction Management
- **Consolidated Interface**: Single view combining forecast and dashboard data
- **One-Time Overrides**: Edit individual transactions without changing base budget
- **Posted Transaction Tracking**: Mark transactions as complete with automatic reset on date changes
- **Manual Transaction Addition**: Add individual transactions and link to budget categories
- **Historical Archive**: Complete transaction history for trend analysis

### 🏦 Bank Data Import System
- **Smart CSV Import**: Auto-detect columns and formats from various bank exports
- **Intelligent Assignment**: Learn transaction categorization after 3 examples
- **User Control**: Confirm, edit, or exclude individual imported transactions
- **Account Memory**: Remember import settings per account for future use
- **Review Process**: User approval workflow for all imported data
- **Transfer Preservation**: Matched transfer budget items create transfer-type history rows with correct destination account
- **Bank Description Retention**: Original CSV descriptions preserved on history rows for audit and rule creation

### 📈 Dashboard & Analysis Tools
- **Main Dashboard**: Account balance charts, key metrics, low balance indicators
- **Configurable Analysis**: Track X lowest daily balances per account and totals
- **Future-Focused**: Identify potential cash flow problems before they occur
- **Interactive Filtering**: Date ranges and account selection
- **Visual Indicators**: Clear formatting for warnings and important data points
- **Budget Analytics** (Budget page → Analytics tab):
  - Account-specific budget-vs-actual arc gauges (Checking, Savings, Credit)
  - Dual-zone overage visualization (0–200% scale with target marker)
  - "Flipped" logic for Savings/Credit where exceeding budget is positive
  - Month navigation (Prev/Next) with dynamic context labels
  - Budget vs. Actual bar chart with drilldown to child categories
  - Spending by Category with parent/child toggle
  - Budget Progress by Category with drilldown
  - Click-through navigation to History page with pre-filtered transactions
  - State persistence when navigating away and returning

### 📉 Historical Analysis & Trends
- **Spending History**: Complete archive of accepted transactions
- **Bank Description Audit**: Expandable BANK rows reveal original imported bank descriptions
- **Trend Analysis**: Averages, increases, spending patterns over time
- **Local Recommendations**: Algorithm-based budget suggestions (no external AI)
- **Category Performance**: Budget vs actual comparisons by category
- **Privacy Analytics**: All analysis performed locally on device

## Privacy & Security Features

### 🔒 Absolute Privacy Protection
- **Zero External Sharing**: No data transmitted without explicit user permission
- **Mandatory Consent**: Required permission dialog before ANY external data sharing
- **LLM Transparency**: Specific notices if AI services are used with retention policies
- **Zero Retention**: External services cannot retain user financial data
- **Local Processing**: All calculations, forecasting, and analysis performed on device

### 🛡️ Data Control
- **Local Storage**: SQLite database on user's device
- **Export/Import**: User-controlled backup and cross-device synchronization
- **No Cloud Dependencies**: Core functionality works completely offline
- **Fallback Solutions**: Alternative local approaches if privacy requirements can't be met

## Technical Capabilities

### 📅 Date & Frequency Handling
- **Proper Date Objects**: Reliable forecasting with accurate date calculations
- **Flexible Input**: Freeform text entry or datepicker interface
- **Custom Patterns**: Local parsing for complex schedules like "1st and 15th"
- **Historical Integration**: Prompt to include earlier transactions when relevant

### 🔄 Cross-Device Considerations
- **Export/Import Sync**: File-based data synchronization maintaining privacy
- **Local Network Options**: Investigating WiFi direct/Bluetooth for secure sync
- **Privacy Priority**: Security preferred over convenience for data access

### 📱 Multi-Platform Support
- **Desktop Application**: Electron wrapper for Windows/Mac/Linux
- **Mobile Access**: Progressive Web App (PWA) for smartphones
- **Responsive Design**: Optimized interface for different screen sizes
- **Consistent Experience**: Same functionality across all platforms

## User Workflow

1. **Initial Setup**: Create monthly budget with transactions and frequencies
2. **Ongoing Management**: Adjust amounts, add manual transactions, mark posted items
3. **Bank Integration**: Import CSV data, confirm categorization, accept transactions
4. **Forecast Review**: View future balances, identify potential issues
5. **Historical Analysis**: Review spending patterns, adjust budgets based on trends
6. **Data Management**: Export for backup, import across devices, maintain privacy

## Advantages Over Excel

- **Automation**: Automatic date calculations and transaction generation
- **Intelligence**: Learning categorization and trend analysis
- **Accessibility**: Available on phone and desktop without Excel dependency
- **Data Integrity**: Better handling of large datasets and complex relationships
- **Privacy**: No cloud storage or third-party data access
- **Performance**: Faster calculations and smoother user experience

## Target Users

- Individuals who currently use Excel for budgeting
- Privacy-conscious users who want local data storage
- Users wanting mobile access to budget data without cloud services
- People needing advanced forecasting beyond basic budgeting
- Those wanting automated bank import while maintaining control

## Implementation Status

This document serves as the definitive guide to the app's functionality and will be updated during implementation to reflect any changes or additional features discovered during development.
