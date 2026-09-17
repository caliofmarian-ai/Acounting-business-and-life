# Accounting Business and Life

Mobile-first accounting and cash-control app for a small fast-food business in the Philippines.

## Purpose

The app is designed to answer a practical question: **where did the money go, and how much should still be available?**

It keeps business activity, personal spending and family/remittance money visibly separate. It records:

- sales;
- business expenses;
- money received from family/support;
- personal withdrawals;
- remittances sent vs PHP actually received;
- balances by Cash, GCash, Bank and Other;
- opening cash and end-of-day physical cash variance;
- stock quantities and low-stock warnings;
- 7-day and 30-day spending breakdowns;
- daily/weekly spending limits and low-money warnings;
- correction history for manually entered transactions.

Currency is PHP (Philippine peso) for local bookkeeping and the default business timezone is Asia/Manila.

## Accounting rules used by the app

1. **Sale** = business income.
2. **Business expense** = money spent to operate the business and reduces business profit.
3. **Money received / support** = increases available money but is **not business revenue or business profit**.
4. **Personal withdrawal** = money used for personal/living purposes and is **not a business expense**.
5. **Remittance** = records what was sent, fees/exchange information when known, and the PHP amount actually received. The received PHP amount is added automatically as `money_received`.
6. Physical cash reconciliation uses **Cash transactions only**. GCash and Bank balances are not mixed into the physical cash count.
7. Corrections to manual transactions are written to an audit trail. There is no silent delete flow.

## Recommended daily workflow

1. Open **Money** and record the physical cash present at the beginning of the day.
2. Record every sale in the account where it was actually received: Cash, GCash, Bank or Other.
3. Record every business purchase as **Business expense**.
4. Record household/personal use as **Personal withdrawal**.
5. If money arrives from abroad, use **Record money sent** instead of adding the received PHP manually.
6. At the end of the day, count the physical cash and use **Close day**. The app compares the actual count with the expected Cash balance for that day.
7. Review the 7-day and 30-day analysis to see business vs personal spending by category.

## Stack

- Node.js + Express
- PostgreSQL (Neon)
- Progressive Web App (installable on Android)
- Railway deployment
- GitHub Actions CI syntax validation

## Environment variables

- `DATABASE_URL` — PostgreSQL connection string
- `APP_PIN` — private PIN used to enter the app
- `TOKEN_SECRET` — long random secret used to sign login tokens
- `PORT` — supplied automatically by Railway

Secrets must remain in the hosting environment and must not be committed to GitHub.

## Local run

```bash
npm install
npm start
```

The database schema is created/extended automatically on startup with additive migrations.

## Security notes

- Login tokens expire after 24 hours.
- Repeated incorrect PIN attempts are rate-limited in memory.
- Application secrets are read only from environment variables.
- The PWA caches the application shell and keeps the most recent read-only dashboard data locally for temporary offline viewing.

## Accounting and tax note

This is an operational cash-control and bookkeeping aid. It does not replace Philippine BIR registration, official invoices/receipts, prescribed books of accounts, tax filings, payroll obligations, permits, or professional accounting/legal advice when those are required.
