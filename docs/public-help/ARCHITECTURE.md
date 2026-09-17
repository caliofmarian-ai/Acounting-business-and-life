# Business & Life — Public Help Center Architecture

Status: **ACTIVE DESIGN / PUBLIC DOCUMENTATION FOUNDATION**

Source of truth: GitHub `main`. Public documentation must describe executable behavior, not assumptions from stale planning prose.

Visual reference: Figma file **Business & Life — Public Help Center**.

## 1. Product characterization

**Business & Life — Philippines** is a mobile-first local economic ecosystem built around one human account that can participate through several separate profiles.

A single account may have these public profiles:

1. **Customer** — discovers local merchants and service providers, places orders, requests delivery, tracks fulfilment and requests local services.
2. **Merchant** — operates a storefront/business workspace, handles orders, products, stock, accounting, procurement and delivery dispatch.
3. **Supplier** — manages a supply business, catalog, Merchant relationships, purchase orders and its own business-scoped accounting workspace.
4. **Courier / Delivery Provider** — manages eligibility, documents, availability, assigned deliveries, active location and verified handoff.
5. **Service Provider / Local Services** — presents skills and qualifications, receives requests, sends quotes, performs jobs and receives verified reviews.

**Administration is not a public profile.** Super Admin / Country Admin / Territory Admin authority belongs to a separate privileged operations surface and must not be presented as another marketplace persona.

## 2. Documentation principles

The public Help Center is part of the product.

Every article should answer one user intent:
- What is this?
- How do I use it?
- Why am I seeing this message?
- What should I do next?
- What information is private/public?
- When do I need Admin approval?
- When should I contact Support or submit an Incident?

Articles must:
- use plain language;
- be usable on Android-sized screens;
- start with a short answer before detail;
- show numbered steps for actions;
- link to the next likely task;
- name the profile(s) the article applies to;
- state important gates/limitations explicitly;
- never claim a payment, legal, licence, tax or regulatory action occurred when the platform did not perform it.

## 3. Information architecture

```text
Help Center
├── Getting started
│   ├── Create an account
│   ├── Sign in / recover password
│   ├── Verify email
│   ├── Account & profile switcher
│   └── Invitations / profile approval
├── Customer
│   ├── Marketplace
│   ├── Orders
│   ├── Cash pickup rules
│   ├── Delivery
│   ├── Local Services
│   └── Incidents / support
├── Merchant
│   ├── Storefront
│   ├── Orders
│   ├── Accounting
│   ├── Cash/day reconciliation
│   ├── Inventory / products / recipes
│   ├── Supplier procurement
│   └── Delivery dispatch
├── Supplier
│   ├── Supplier profile
│   ├── Catalog
│   ├── Merchant relationships
│   ├── Purchase orders
│   ├── Fulfilment
│   └── Business-scoped accounting
├── Delivery
│   ├── Eligibility / documents
│   ├── Availability
│   ├── Assigned deliveries
│   ├── Location sharing
│   └── Customer handoff
├── Local Services
│   ├── Public profile
│   ├── Services offered
│   ├── Credentials / CV evidence
│   ├── Requests / quotes
│   ├── Jobs
│   └── Verified reviews
├── Safety & privacy
│   ├── Private incident reports
│   ├── Evidence limits
│   └── What other users can see
└── Troubleshooting
    ├── Sign-in
    ├── Profile approval
    ├── Business workspace access
    ├── Order/payment gates
    ├── Delivery quote/eligibility
    ├── Supplier relationship gates
    └── Service-provider approval
```

## 4. Contextual help contract

Public documentation routes use stable paths:

- `/help` — Help Center home
- `/help/profile/:role` — profile guide
- `/help/article/:slug` — exact article
- `/help/error/:code` — stable help/error code resolver

The application should eventually attach a contextual action such as **Learn more** to actionable user-facing errors.

Example:

```text
Delivery quote is missing or expired.
[Get a new quote]  [Learn more]
                    ↓
/help/error/ERR-DEL-004
                    ↓
/help/article/delivery-quote-expired
```

Do not use changing English error text itself as the permanent documentation identifier. Use a stable help code.

## 5. Current implementation boundary

The first Help Center release documents behavior already merged into `main` through V0.9.

It does **not** describe unmerged PR behavior as live. At the time this architecture was created, scoped Admin RBAC / Support Operations was still in an open PR and therefore remains outside public-current documentation.

## 6. Localization

Initial content locale: `en-PH`.

The content model must remain translation-friendly so `fil-PH` can be added without changing article identity or URLs.

Stable article slug/help-code identity should remain locale-independent.

## 7. Visual system

Figma defines three baseline artifacts:
- product/profile architecture map;
- Help Center home page;
- article + troubleshooting template.

Illustrations and diagrams should explain workflows, not decorate pages without informational value.

## 8. Documentation lifecycle

For every product PR that changes user-visible behavior:

1. identify affected Help Center articles;
2. update content on the same feature branch or a linked docs branch;
3. mark old behavior as superseded;
4. add/update contextual help-code mappings if the error state changed;
5. test public routes without authentication;
6. verify links on mobile.

A user-visible feature is not fully documented until the Help Center describes how to use it and how to recover from its common failure states.
