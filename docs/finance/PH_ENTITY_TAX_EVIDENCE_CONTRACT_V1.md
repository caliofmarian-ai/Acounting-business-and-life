---
document_id: BL-70-PH-FIN-COMPLIANCE-001
title: Philippines Entity Tax / Compliance and Financial Evidence Contract V1
document_type: design_contract
status: DRAFT
access_class: BUSINESS_PRIVATE
country_code: PH
territory_scope: versioned_lgu
owner_role: Finance / Compliance Design
approver_role: Project Owner / Controlled Legal Review
version: 0.1
legal_classification: IMPLEMENTATION_DESIGN_NOT_LEGAL_ADVICE
related_issues: [32, 31, 24, 247, 759, 13]
---

# Philippines Entity Tax / Compliance and Financial Evidence — Draft Contract V1

**Design only; not live, not legally approved, and not a statement of present app capability.**
This document proposes the missing integration boundary for [#32](https://github.com/caliofmarian-ai/Acounting-business-and-life/issues/32). It does not activate requirements, schedules, government filing, tax calculations, automatic record disposal, or a new permission. The economic entity remains responsible for registration, filing, payment and professional advice. Unknown applicability must be represented as **Needs local / qualified review**, not as compliant, exempt or overdue.

## 1. Existing authority and exclusions

Use [Financial Document Engine V1](FINANCIAL_DOCUMENT_ENGINE_V1.md) as the **derived evidence layer**, not a second journal. Business Merchant/Supplier accounting transactions, account-owned profile money, Payment Core intents/allocations/refunds, and source orders/procurement/fulfilment remain authoritative. The Financial Document Engine already distinguishes internal evidence, fiscal candidates and independently fiscal-validated documents; this proposal never silently advances that status.

Use [Generated Documents & Forms](../governance/GENERATED_DOCUMENTS.md) for template versioning and private generated-instance governance; [Accounting Corrections SOP](../sop/SOP_ACCOUNTING_CORRECTIONS.md) for source-corrected linked entries; and [Philippines Business Registration Baseline](../compliance/ph/BUSINESS_REGISTRATION_BASELINE.md) plus the [source registry](../compliance/ph/SOURCE_REGISTRY.md) for regulator routing. The #31 Compliance & Training Center is the source for versioned guidance and training; #32 owns **business obligations, evidence and exports**, not professional accreditation or a parallel legal catalogue.

The proposed workspace is initially for authorized **Merchant and Supplier business entities**. Customer/Courier/Local Services financial documents retain their existing account/profile scopes; expansion to an independent legal operating entity requires a separately reviewed binding. A business shared between Merchant and Supplier must be counted **once** when consolidating its authoritative ledger.

Out of scope until separately authorized: calculating a legally payable tax, submitting BIR/LGU filings, paying fees, issuing statutory invoices, making government acceptance assertions, licensing a business, executing provider payouts, cross-entity consolidation and assigning an unverified privacy controller.

## 2. Business scope and provenance rules

An entity compliance profile is a private relationship between an immutable economic-entity ID and an **authorized business workspace ID**. A display trade name, person account, Merchant/Supplier profile ID, and legal entity are distinct objects. Multiple business workspaces must not be merged because their registered names, owner accounts or contact emails look alike; any legal-entity linkage needs an explicit verified relationship with an auditable decision.

Proposed minimal profile snapshot:

| Field / record | Meaning and authority |
| --- | --- |
| entity_id / business_id / country_code | Stable canonical identifiers; country fixed to PH for this edition; reject cross-business authority. |
| registration_form | Sole proprietor / corporation / partnership / cooperative / other / unknown; self-declared pending evidence and review. |
| legal_name / trading_name | Separate declared and verified states; names do not prove registration. |
| tax_classification_version | Nullable approved ruleset reference; null means no automatic tax calculation. |
| registered_territory / operating_territory | PSGC-coded region, province where applicable, city/municipality, barangay as applicable; distinct from the account user's residence. |
| regulator_registration_refs | Private DTI/SEC/CDA/BIR/LGU references with issuing authority and evidence pointer, never public identity. |
| effective_dates | Issue, verified-as-of and expiry dates where sourced; unknown remains null. |
| evidence_policy_ref / controller_ref | Approved privacy/retention policy and real controller assignment **only when verified**; absent values block automated disposal. |
| reviewed_by / reviewed_at / source_version | Audit of a privileged platform review, not government approval. |

TIN and scans of government/financial records are sensitive; store encrypted at rest in designated private storage, maintain server-side business-scoped authorization, minimize responses, and never place them in URLs, analytics, search indexes, public templates, GitHub or browser error logs. Admin ability to see aggregated statuses is **not** permission to view raw TIN, entire attachments or banking documents.

## 3. Versioned applicability and obligation definition

A compliance rule is a reviewed proposition, not a national default. Suggested rule key:

**country edition + authority + PSGC territorial scope + entity type + business activity/category + tax classification (where known) + effective interval + rule version**.

Do not infer municipal requirements from only barangay or from a free-text address. An LGU requirement for one territory cannot spill into another. Rule matching may return three explicit classes: APPLICABLE_VERIFIED, NOT_APPLICABLE_VERIFIED, or APPLICABILITY_UNRESOLVED. The last class is the conservative default and must not create a fake exemption, legal deadline, fine or active-operating permission.

A rule version includes: immutable rule ID and revision; evidence/source registry references; source publication/effective dates and reviewer timestamps; jurisdiction resolution; applicability question and answer; obligation type; optional date-calculation configuration only after qualified review; any superseding version; status DRAFT / REVIEW_REQUIRED / EFFECTIVE / SUPERSEDED / RETIRED. Draft rules may inform a research checklist but **cannot enforce a deadline or assert a statutory violation**. Revisions must preserve the originally attached version for every historical obligation.

Initial authorities to research, not automatically require, are DTI BNRS (sole proprietor business name when applicable), SEC (registered companies/partnerships), CDA (cooperatives), BIR registration/filing/payment, the particular LGU Business/Mayor's Permit and sector regulators. Business-name registration alone is not an operating permit. Do not derive a tax amount, tax rate, filing form, due date or authority from these generic descriptions.

Official reference entry points for controlled review:
- DTI: https://www.dti.gov.ph/ and https://bnrs.dti.gov.ph/
- SEC: https://esparc.sec.gov.ph/
- CDA: https://cda.gov.ph/
- BIR: https://www.bir.gov.ph/
- NPC: https://privacy.gov.ph/
- LGU: only the separately verified official site/source for the selected PSGC territory.

The source registry currently has a dated historical verification; every executable obligation needs a **fresh source/applicability decision** and the responsible authorized reviewer identity. A general reference link is not a current tax opinion.

## 4. Proposed private record families

These names describe a future logical schema, not migrations or existing endpoints.

**entity_obligation:** obligation_id; entity_id; business_id; rule_revision_id nullable; authority; territorial applicability snapshot; obligation category; reporting period start/end; due_at nullable with timezone provenance; required evidence categories; user visibility status; created/updated timestamps; superseded_by nullable. A null deadline is not zero and must never display as overdue.

**obligation_filing_claim:** claim_id; obligation_id; action (prepared, submitted_external, paid_external, exemption_asserted, withdrawal, correction); actor account ID / authorized membership; declaration time; declared amount and currency nullable; payment/reference type; linked evidence refs; source of assertion (USER_DECLARED, REVIEWER_VERIFIED, AUTHORITY_VERIFIED, PROVIDER_CONFIRMED); recorded timestamp and change reason. Preserve successive claims; never mutate prior filing/payment declarations in place.

**obligation_evidence:** opaque evidence_id, business_id, owner of evidence, MIME/type, encrypted object pointer, sha256 content digest, capture/source time, private access class, malware/quarantine status, origin declaration, linked claim/obligation/financial-document identifiers, uploader, reviewer and restricted audit. Content digests prove an unchanged byte sequence, **not** authenticity, official acceptance or a qualified signature.

**obligation_review:** review_id; scoped decision; reviewer authorization/territory/function snapshot; status PENDING / VERIFIED_EVIDENCE / REJECTED / NEEDS_REVIEW / SUPERSEDED; referenced evidence hash/version; reviewed_at; non-public reason/code. A reviewer checks platform evidence only; official acceptance requires independently verifiable authority evidence or an approved authorized integration.

**report_manifest:** report_id; requested_by and permission snapshot; business_id (or explicitly permissible set); period start inclusive / end exclusive in Asia/Manila; currency; filters; canonical ledger/query revision; source watermarks; generated_at; template version; row count/totals; sha256 of deterministic canonical export; associated source and evidence indexes; revocation/supersession status. A manifest is never a ledger entry.

**audit:** append-only events for all claim/evidence/review/report access and creation, with business scope, actor, object, action, minimal metadata and correlation ID. Do not log TIN, bank secrets, raw receipts or private attachment content.

## 5. State and truthfulness contract

Keep three independent dimensions:

1. **Work preparation:** NOT_CONFIGURED / UPCOMING / PREPARED / PAST_CONFIGURED_DUE_DATE / NEEDS_REVIEW. The date-sensitive value is merely a configured follow-up, not a legal conclusion.
2. **Submission/payment claim:** NONE / USER_RECORDED_SUBMISSION / USER_RECORDED_EXTERNAL_PAYMENT / CLAIM_CORRECTED / CLAIM_WITHDRAWN. A button or upload can only advance this *claim* dimension.
3. **Verification:** NOT_REVIEWED / EVIDENCE_ATTACHED / PLATFORM_REVIEWED / OFFICIAL_CONFIRMED (only with supported official confirmation) / DISPUTED. Government acceptance must be separately proven. Staff approval of an uploaded PDF is **not** equivalent to confirmed BIR filing.

Never show the single badge **Tax paid**, **Filed by Business & Life**, **BIR-approved**, **Legally compliant**, **Business licensed** or **Exempt** merely from an internal declaration. Suggested accessible copy: *Recorded by this business; official acceptance and payment have not been verified.* If a recorded deadline is exceeded, say *Configured due date passed; check the current official requirement* unless actual legal applicability was independently approved.

An independent correction adds a new event and links to its predecessor; filing, payment and evidence history remain reconstructable. If a reviewed rule is superseded, preserve the old rule association on historical events, surface which periods may require re-review, and do not rewrite past evidence.

## 6. Money-flow evidence graph

The export is a traceable projection over the existing canonical chains:

- Customer payment: order → internal payment intent → provider-confirmed payment ID + webhook verification → immutable allocations (merchandise, delivery, processor, platform, operator/territory if applicable) → business ledger entries → later independent payout/settlement proof.
- Refund: original payment intent → refund request/authorization → provider-confirmed refund when applicable → balancing accounting document / linked ledger correction. Never delete the original.
- Procurement: purchase order → receiving confirmation → supplier evidence/invoice candidate → supplier payable → payment confirmation or user-recorded cash movement → ledger and reconciliation.
- Manual bookkeeping: authorized transaction → protected correction/reversal chain → document/statement reference; manual entries do not become provider-confirmed funds.

A provider's confirmed Customer payment **must not** be represented as Merchant bank settlement without separate payout reconciliation. Never count gross payment, its allocation and the resulting ledger entry as three separate revenues. Linked payment-derived entries cannot be edited as unrelated manual accounting records. Keep raw source IDs private; expose only opaque public report references.

The report projection must not invent platform, territory or operator fees: report configured policy version/charged_to and actual monetary amounts where present; otherwise show **Not configured / not confirmed**, not zero asserted as legally owed. Keep processor fee separate and avoid assigning it to Merchant when the source policy has not charged Merchant.

## 7. Export pack and reproducibility

The first pack is a business-authorized data export (CSV for accountant workflows, PDF only when an approved template/rendering exists). It must not replace current V1 statements or claim BIR invoice status. The exact canonical input joins, row-level authorization and reconciliation policy must be documented for each report before activation.

| Export / content | Canonical source intent | Failure or non-authority caveat |
| --- | --- | --- |
| Transaction / cash / bank / e-wallet movements | scoped accounting transaction and money-account movement, correcting entries | ledger account balance is not bank statement/provider settlement |
| Sales, income, expenses, procurement | linked orders, business transactions, purchases and evidence docs | invoice candidate is not automatically fiscal-valid |
| Customer receivables / Supplier payables | approved source obligations + matched settlement/adjustment events | unpaid balance cannot be inferred from a mere quote |
| Delivery / platform / processor / operator fees | immutable commercial allocation and policy snapshots | omitted fee is unconfigured, not silently absorbed into merchandise |
| Inventory movement and cost | scoped stock movements and verified cost sources | estimated cost explicitly labelled, no fabricated COGS |
| Reconciliation / day close | canonical movements + matching provider/physical-bank evidence | mismatches retained as unresolved, never silently netted away |
| Obligation register / official-evidence index | rule-versioned business obligations, user claims, review decisions | uploaded receipt is not automatically certified official evidence |
| Proof-of-money-flow graph | above source IDs and links plus correction/supersession history | source gaps produce an explicit incomplete chain |

CSV: UTF-8, stable header/schema version, machine-readable ISO timestamps with offset, decimal strings in explicit currency, escaping against spreadsheet formula injection for every untrusted text cell, deterministic sort, and no unsanctioned PII. PDF: generation date, business identity, currency, Philippines timezone, inclusive displayed period/exclusive query boundary, source/revision digest, page counts, column totals, document classification **INTERNAL ACCOUNTING EVIDENCE — NOT A GOVERNMENT FILING**. Hash is for reproducibility, not a cryptographic signature.

Before publishing an export, obtain a repeatable canonical snapshot/watermark (or transactionally consistent DB snapshot if available); reconcile debit/credit or source movement totals to the canonical account/role scope. If source data changes during generation, fail/retry from a new snapshot rather than mixing versions. Regeneration from the same immutable source versions and filters should reproduce rows and digest. Later corrections create a **new** report version referencing the previous manifest instead of rewriting history.

Report creation never alters journal balances, changes payment/order state, or performs an external transfer. No public/shareable report URL by default; any download uses an expiring, scoped, authenticated access path and records privileged export access. Large exports require size and time bounds, cancellation and rate controls before implementation.

## 8. Authorization, confidentiality and retention gates

Authorize every read/write/download against **current server-side business membership**, scope and permitted finance/compliance action, not just a UI-selected business ID. Re-evaluate at final delivery after a long export: logout, session rotation, revoked membership or business switch must prevent any stale private download. A Country/Territory Admin may see aggregated compliance counts only within its verified assignment, not all raw entity documents.

Separate view-own-summary, manage-own-obligation, attach-private-evidence, request-export, review-credential/evidence and view-sensitive-identifier permissions. Super Admin access alone is not a reason to bulk export sensitive documents; explicit functional authority and audit are required.

Retention periods, controller/contact, lawful basis, legal hold priority, backup expiry/reconciliation and deletion workflow are **unapproved dependencies of #759/#815**. Their values must remain null/unactivated until controlled decisions are published; this document does not import a schedule or authorize a background purge. Private evidence may need holds on correction, dispute or audit, but those are not proof of an approved statutory retention term.

User-facing actions must be keyboard/Android accessible; EN-PH and Filipino copy must distinguish *self-reported*, *platform-reviewed* and *officially confirmed*, including errors and empty states. Do not show a profile publicly compliant by default just because its finance exports are complete.

## 9. Proposed acceptance / negative test matrix

All fixtures below are synthetic. Runtime implementation needs isolated Preview checks and post-merge caliof.com verification; this DRAFT adds no runtime.

1. Merchant and Supplier each see only their own approved business; same business viewed through two profiles counts the shared ledger once.
2. Business A cannot obtain B's obligations, TIN, document URLs, report ID or row totals by changing route IDs or replaying an expired link.
3. A territory-A LGU rule is absent from territory B unless B has an independently reviewed applicability match; unverified rule gives Needs local review, never a generated deadline.
4. Unknown entity type, classification, locality or effective date cannot produce a legal tax amount/rate, deadline, exemption or fully compliant badge.
5. User uploads a claimed BIR payment receipt: state is user-recorded + evidence attached, not official payment confirmation; a failed/malicious upload remains quarantined.
6. Platform reviewer accepts an evidence format: state is platform-reviewed only; official-confirmed requires independent authority evidence.
7. Customer payment with delivery/processor/platform allocations exports **once** with traceable gross/fees/net; provider paid without payout evidence cannot show bank settlement.
8. Refund/correction after an export produces a replacement manifest with references to both old and new report, never mutates the historical report.
9. CSV untrusted merchant-supplied values beginning with spreadsheet operators cannot become executable formulas when opened by an accountant.
10. Source change during export cannot mix two inconsistent ledgers; cancelled generation creates no partial downloadable report or journal movement.
11. Account/profile/business switch, logout or revoked delegation while an export is preparing invalidates delivery authority, including late AJAX responses.
12. An Admin without explicit sensitive-evidence rights can retrieve aggregate status but cannot download TIN, evidence bytes or a cross-territory index; denied attempts audit.
13. A missing effective source/reviewer/retention controller blocks policy enforcement or automated disposal while leaving safe accounting statements usable.
14. Periods spanning Asia/Manila midnight and year/ISO-week boundaries include each authorized row exactly once; cross-currency amounts are not silently added.
15. A test pack documents reproducible filters, manifest content hash and unambiguous disclaimer, with no invented government filing receipt/signature.

## 10. Implementation handoff gates

**Design acceptance (issue #32):** reconcile this contract with current #24 fee hierarchy, #31 guidance, #247 document engine, #13 country edition and accounting corrections; review unresolved data classifications, private permissions and source-version precedence. Reviewers must identify actual current DB fields and source events, not assume proposed schema names already exist. Official PH/LGU/legal advisers determine *applicability* before turning any draft rule into an executable obligation.

**Implementation release (separate scoped child PRs):** (a) authorized entity context and private obligations with audit; (b) safe evidence storage/reviews and negative authorization tests; (c) deterministic CSV and report manifests with reconciliation; (d) controlled PDF output; (e) PH-rule activation only after qualified source/legal decision and privacy-retention policy; (f) exact-head isolated Preview acceptance, reviewed merge, Production SUCCESS and independent caliof.com acceptance. Keep all provider activity inert until its separate live-payment gates pass.

**Current status:** PH draft integration/design proposal only. No endpoint, database migration, export generator, regulator activation, approval, TIN processing, payment, external submission, Railway service, Preview deployment or production behavior is created by this file.
