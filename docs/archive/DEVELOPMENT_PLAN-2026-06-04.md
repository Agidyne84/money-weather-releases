# Budget App — Development Plan

> Last updated: June 4, 2026

---

## Recently Completed (Current Session)

### 1. Budget Analytics — Budget Summary Card
- **Three arc gauges** for Checking, Savings, and Credit accounts showing % of budget spent vs. actual
- **Dual-zone arc design**: midpoint (12-o'clock) = 100% budget target; left zone = 0–100%, right zone = 100–200% overage
- **Flipped overage logic**: for Savings and Credit, spending *more* than budgeted is shown as positive (green); for Checking, overage is negative (red)
- **Always-visible Savings gauge**: shown whenever a savings account exists, even if no savings transfer budget items are configured (displays "no target" state)
- **Credit gauge net model**: budget/actual = transfers (payments, positive) minus expenses (purchases, negative). Transfer payments raise the gauge, credit purchases lower it.
- **Signed-value ArcGauge**: handles `budget <= 0` (no target / carrying balance states) with `isGood = actual >= budget` for all sign combos
- **Month navigation**: Prev/Next month buttons with context label

**Files modified**: `client/src/components/analytics/BudgetSummaryWidget.tsx`, `client/src/pages/Budget.tsx`

### 2. History Page — Bank Description Display
- Clicking a row with a **BANK** badge expands the row to reveal the original `bankDescription` from the import
- Bank description shown in blue monospace between the main description and the metadata line
- Only BANK rows are clickable for expansion; checkbox and action buttons don't trigger expansion

**Files modified**: `client/src/pages/History.tsx`

### 3. Bank Import — Transfer Flag Propagation
- During `/api/import/commit`, history rows now copy `is_transfer` and `transfer_to_account_id` from the matched budget transaction
- Applies to all three insert paths: unassigned rows, assigned rows, and fallback occurrence rows
- **Startup migration** backfills these fields on existing history rows whose linked budget transaction is a transfer but the history row was missing the flag

**Files modified**: `server/src/index.ts`

---

## Prior Completed Work (Earlier Sessions)

### Budget Analytics Cards
- **Budget vs Actual**: bar chart with min-width + stretch-to-fill, sort by max(budget, actual), parent→child drilldown with History navigation prompt, credit-flipped coloring/verbiage
- **Spending by Category**: parent/child category toggle, drilldown to child categories, click-to-navigate to History with filters
- **Budget Progress by Category**: parent→child drilldown, click-to-navigate to History, credit-flipped logic
- **State persistence**: activeTab, analyticsPeriod, summaryMonthOffset, drilldown states saved to/restored from `sessionStorage` when navigating to History and back

### Budget Page Structure
- Month navigation on Budget Summary (Prev/Next month, context-aware labels)
- Credit account detection for "flipped" budget items (paying more than budgeted is good)
- Transfer-to-credit categories properly identified via `getCreditPaymentCategoryIds`

---

## Known Issues / Potential Improvements

| # | Item | Priority | Status |
|---|------|----------|--------|
| 1 | **History API `isTransfer` flag not returned** — `mapHistoryRow` maps it, but the GET `/history` endpoint may not include the columns in its SELECT. Verify the query selects `is_transfer` and `transfer_to_account_id`. | Medium | Not started |
| 2 | **Arc gauge overflow beyond 200%** — when spending exceeds 2× budget, the arc fills completely and the exact magnitude is only visible in the text label. Consider a numeric overflow indicator. | Low | Not started |
| 3 | **Budget Summary overall status** — the overall "On Track / Over Budget" summary below the gauges uses totalSpent/totalBudget which includes transfers. May double-count or misrepresent when transfers move money between accounts. | Medium | Not started |
| 4 | **Savings gauge actual calculation** — currently only counts transfers TO savings. If the user manually adds a savings deposit as an expense on a savings account (not as a transfer), it won't be captured. | Low | Not started |

---

## Potential Next Steps

### Analytics & Visualization
- [ ] Add trend line to Budget Summary (compare current month to prior 3-month average)
- [ ] Export analytics data as CSV
- [ ] Add a "run rate" projection for current incomplete month
- [ ] Category-level budget summary gauges (mini versions per category)

### Reconciliation & Import
- [ ] Show transfer destination account in History row metadata when `isTransfer = true`
- [ ] Allow editing `bankDescription` during reconciliation (before commit)
- [ ] Batch exclude/include in reconciliation UI
- [ ] Auto-suggest rules from unmatched bank rows

### Data Integrity & Maintenance
- [ ] Audit existing history rows for orphaned `transaction_id` references
- [ ] Add database constraints: `historical_transactions.is_transfer` should default to `0`
- [ ] Verify all SELECT queries on `historical_transactions` include `is_transfer` and `transfer_to_account_id`

### Mobile / UX Polish
- [ ] Responsive layout for three gauges on narrow screens (stack vertically below ~640px)
- [ ] Touch-friendly expand/collapse for History BANK rows
- [ ] Swipe gestures on Budget Summary month navigation

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| Jun 4 | Dual-zone arc gauge (0–200%) | Single-zone capped at 100% couldn't show overages visually; splitting at midpoint makes target and overage immediately visible |
| Jun 4 | Always show Savings gauge | User explicitly requested it; encourages setting up savings budget items even if none exist yet |
| Jun 4 | `bankDescription` shown only on click | Keeps History table compact; BANK badge signals clickability |
| Jun 4 | Startup migration for transfer flags | Idempotent, safe to re-run; fixes historical data without user action |
| Jun 4 | Credit gauge net model (transfers − purchases) | Payments to credit (transfers) reduce debt and should raise the gauge; purchases increase debt and should lower it. Signed `isGood = actual >= budget` works for all sign combos. |
| Jun 4 | Signed-value ArcGauge (`budget ≤ 0` states) | Credit net model can produce budget ≤ 0 (carrying balance plan). Gauge shows "no target" for zero and "carrying balance" for negative, with coverage arc instead of percentage. |
