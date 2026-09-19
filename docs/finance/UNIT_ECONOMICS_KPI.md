# Financial KPI & Unit Economics

Status: **DESIGN / FINANCE CANON**

Owner decision: Business & Life must measure **costs together with revenue**. A revenue-only dashboard is not acceptable because it can hide a loss-making service, territory or promotional campaign.

Related:
- Issue #117 — FINANCE KPI — Unit economics, cost attribution and profitability dashboard
- Issue #34 — Payment providers, platform fees, settlements and reconciliation
- Issue #24 — Platform/country/territory commission hierarchy
- Issue #59 — Business masterplan KPI framework

## 1. Core financial equations

For each reporting period and supported dimension:

```
Platform Contribution
  = Platform Revenue - Variable Costs

Operating Profit / Loss
  = Platform Revenue - Variable Costs - Allocated Fixed Costs

Contribution Margin %
  = Platform Contribution / Platform Revenue

Net Margin %
  = Operating Profit / Platform Revenue
```

When Platform Revenue is zero, especially during an applicable promotional period, margin percentages are not meaningful. The dashboard must show absolute subsidy/cost instead:

```
Subsidy per Transaction
  = Total Platform Cost for Promo Transactions / Completed Promo Transactions

Subsidy per Active Account
  = Total Platform Cost for Promo Cohort / Active Promo Accounts
```

## 2. Financial views

Every KPI must be filterable by:
- country edition;
- territory / operating cell;
- service scope;
- fee-policy version;
- promotional vs paid stage;
- payment method/provider;
- day / week / month / quarter;
- Merchant / Supplier / Courier / Service Provider cohort.

Service scopes:
- Marketplace;
- Delivery / Courier;
- Supplier B2B;
- Local Services;
- future Accounting Pro;
- future enterprise/operator services.

A blended platform margin must never hide a loss-making service.

## 3. Revenue ledger

Count as platform revenue only amounts economically owned by the platform, such as:
- platform fees;
- platform-retained operator share;
- future paid subscription revenue;
- future sponsored placement revenue;
- future enterprise/API/integration revenue;
- other explicitly classified platform income.

Do **not** classify these as platform revenue:
- Merchant merchandise GMV;
- Supplier gross sales;
- Courier earnings;
- Service Provider job value;
- taxes collected for another authority;
- customer money temporarily held for settlement.

## 4. Variable/direct cost ledger

Allocate to the exact transaction/job/order whenever technically possible:
- payment processor percentage fee;
- payment processor fixed fee;
- unrecovered refund fee;
- chargeback/dispute cost;
- email/SMS/push cost;
- maps/routing/geocoding/live-tracking API cost;
- storage/bandwidth used by the transaction;
- AI/API usage cost;
- earned referral reward;
- platform-funded coupon/promotion;
- platform-funded delivery subsidy;
- fraud/bad-debt loss borne by the platform;
- operator revenue share;
- tax/withholding that is an actual platform cost.

## 5. Fixed and semi-fixed operating-cost ledger

Maintain a monthly cost ledger for:
- Railway compute/hosting/bandwidth;
- Neon/PostgreSQL/database;
- object storage and backups;
- domain and infrastructure services;
- monitoring/security/observability;
- GitHub and development tooling attributable to the project;
- Figma/Canva/other design-tool allocation where appropriate;
- customer support;
- legal/compliance/accounting;
- salaries/contractors when introduced;
- marketing overhead not linked to one acquisition;
- insurance/licences/company administration;
- other approved overhead.

No amount may be invented merely to complete a chart.

## 6. Evidence quality

Every cost record must identify one evidence class:

| Class | Meaning |
|---|---|
| `actual` | confirmed invoice, provider statement or payment |
| `accrued` | known cost already incurred but not yet paid |
| `estimated` | operational estimate with documented method/source |
| `budget` | planned ceiling or forecast |

Reports must expose the mix of actual vs estimated values. Estimated cost must not silently appear as confirmed historical cost.

## 7. Mandatory executive KPIs

### Platform economics
- GMV / Gross Service Value — context only, not revenue;
- Platform Revenue;
- Variable Costs;
- Platform Contribution;
- Contribution Margin %;
- Allocated Fixed Costs;
- Operating Profit / Loss;
- Net Margin %;
- Monthly Burn;
- Cash Runway, when treasury data exists;
- Break-even transaction volume.

### Unit economics
- Revenue per completed transaction;
- Variable cost per completed transaction;
- Contribution per transaction;
- Processor cost per transaction;
- Infrastructure cost per transaction;
- Support cost per transaction;
- Promotional subsidy per transaction;
- Refund/dispute cost per transaction;
- Profit/loss per completed transaction.

### Customer/provider economics
- CAC by acquisition channel;
- cost per activated user;
- cost per active Merchant;
- cost per active Supplier;
- cost per active Courier;
- cost per active Service Provider;
- payback period;
- retention/churn by financial cohort;
- LTV and LTV:CAC only after enough real historical evidence exists.

## 8. Service-specific promotional-period economics

The promotional period is not “free” to the platform. Finance must measure its cost. Current Owner policy uses 90 days for Marketplace/Merchant and 30 days for Delivery/Courier; Supplier and Local Services remain at 90 days until separately changed.

For each promotional cohort show:
- active accounts;
- completed transactions;
- GMV;
- waived platform fees;
- platform cash revenue;
- payment-processing cost borne by platform;
- infrastructure cost;
- support cost;
- promotional/referral/subsidy cost;
- total platform subsidy;
- subsidy per transaction;
- subsidy per active account;
- conversion to paid stage;
- post-promo contribution.

The goal is to learn whether the free period generates users whose later contribution repays the acquisition and onboarding cost.

## 9. Break-even KPI

For a service with known average contribution per paid transaction:

```
Break-even Transactions
  = Monthly Allocated Fixed Cost / Average Contribution per Paid Transaction
```

Also display:
- current completed paid transactions;
- transactions remaining to break even;
- break-even progress %.

If average contribution is zero or negative, show **NO BREAK-EVEN AT CURRENT UNIT ECONOMICS** instead of producing a misleading number.

## 10. Cost-allocation policy

Preferred allocation hierarchy:
1. direct cost → exact transaction/job/order;
2. measured usage → service/territory/account;
3. documented operational driver;
4. shared fixed-cost allocation as last resort.

Potential drivers:
- transaction count;
- payment volume;
- API requests;
- storage bytes;
- active accounts;
- support minutes/tickets;
- infrastructure usage.

Allocation methodology must be versioned. Historical reports must retain the method used at the time or be explicitly labelled as a restatement.

Recommended primitives:
- `platform_cost_entries`;
- `platform_cost_allocations`;
- `cost_allocation_policy_versions`;
- deterministic financial KPI report queries;
- optional cached `financial_kpi_snapshots` for performance.

## 11. Guardrails and alerts

Finance/Super Admin should receive warnings when:
- contribution per transaction becomes negative;
- processor cost exceeds platform revenue;
- subsidy per active account rises materially;
- infrastructure cost grows faster than completed transactions;
- refund/chargeback cost spikes;
- paid conversion deteriorates;
- a territory remains structurally loss-making;
- a service cannot reach break-even at current economics.

Alert thresholds are versioned business policy. They must not be hidden constants.

## 12. Admin visibility

### Super Admin / Finance
Global authorized financial view:
- Revenue;
- Costs;
- Contribution;
- Profit/Loss;
- Margin;
- Burn;
- Runway;
- Break-even;
- service profitability;
- territory profitability;
- promo subsidy;
- provider/payment-method cost;
- cost evidence quality.

### Country Admin
Country-scoped metrics only.

### Territory Admin / operator
Territory-scoped financial metrics only where explicitly authorized.

## 13. Accounting invariants

- GMV != Platform Revenue.
- Processor fee != Platform fee.
- Cash movement != Profit.
- Waived promotional revenue is not cash income.
- Customer/provider money held for settlement is not revenue.
- Costs remain visible even when fees are waived.
- Historical fee-policy and cost-allocation versions are auditable.
- Never double count one economic cost across direct and fixed allocations.

## 14. Management question

The KPI system is considered successful only when Finance can answer, with evidence:

> **How much did Business & Life earn, what did it cost to earn it, and how much did the platform actually keep — per service, transaction, territory and cohort?**
