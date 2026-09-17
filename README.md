# Accounting Business and Life

Mobile-first accounting and cash-control app for a small fast-food business in the Philippines.

## Purpose

The app keeps business money and personal money visibly separate. It records:

- sales;
- business expenses;
- money received from family/support;
- personal withdrawals;
- cash expected versus physical cash;
- stock quantities and low-stock warnings;
- daily profit and cash variance.

Currency is PHP (Philippine peso) and the default business timezone is Asia/Manila.

## Stack

- Node.js + Express
- PostgreSQL (Neon)
- Progressive Web App (installable on Android)
- Railway deployment

## Environment variables

- `DATABASE_URL` — PostgreSQL connection string
- `APP_PIN` — private PIN used to enter the app
- `TOKEN_SECRET` — long random secret used to sign login tokens
- `PORT` — supplied automatically by Railway

## Local run

```bash
npm install
npm start
```

The database schema is created automatically on startup.

## Accounting note

This is an operational cash-control and bookkeeping aid, not a substitute for Philippine BIR registration, official books/receipts, tax returns, or advice from a qualified accountant when those are required.
