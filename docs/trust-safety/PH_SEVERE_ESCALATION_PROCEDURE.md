---
document_id: BL-110-PH-TS-002
title: Business & Life Philippines — Severe Fraud and Personal-Safety Escalation Procedure
document_type: trust_safety_procedure
status: DRAFT
access_class: INTERNAL_CONTROLLED
country_code: PH
territory_scope: country
owner_role: Trust & Safety
approver_role: Project Owner
version: 1.0
legal_review: LEGAL_REVIEW_REQUIRED
---

# Business & Life Philippines — Severe Fraud and Personal-Safety Escalation Procedure

## 1. Purpose and boundary

This procedure turns a small closed set of structured Incident signals into a prioritized, auditable human-review queue. It covers immediate personal danger, child or vulnerable-person risk, credible threats/stalking/doxxing, account takeover or identity theft, severe payment fraud or money-mule concerns, and severe illegal or exploitative content.

An escalation is an allegation and investigation input. It is not a finding of criminal conduct, an automatic restriction, an automatic report to an authority, or confirmation that emergency services were contacted.

Business & Life is not an emergency service. Where anyone may be in immediate danger, the reporting user is instructed to contact the appropriate local emergency service first and use the platform report when it is safe.

## 2. Structured routing matrix

The runtime policy version is `ph-severe-escalation-v1`. Free-text descriptions and attachments do not enter the routing decision.

| Structured trigger | Severity | Internal route | Response target | Country scope | Legal review | Preserve evidence |
| --- | --- | --- | ---: | --- | --- | --- |
| Immediate danger | critical | immediate personal safety | 15 minutes | yes | yes | yes |
| Child or vulnerable person at risk | critical | child/vulnerable safety | 30 minutes | yes | yes | yes |
| Credible threat, stalking or doxxing | critical | threat/stalking/doxxing | 30 minutes | yes | yes | yes |
| Account takeover or identity theft | high | account security/fraud | 4 hours | when otherwise unscoped | case-dependent | yes |
| Payment fraud or suspected money mule | high | payments/fraud | 4 hours | when otherwise unscoped | yes | yes |
| Severe illegal or exploitative content | critical | illegal/exploitative content | 30 minutes | yes | yes | yes |
| Category: Exploitation concern | critical | child/vulnerable safety | 30 minutes | yes | yes | yes |
| Category: Harassment / threat | high | personal safety | 4 hours | when otherwise unscoped | case-dependent | yes |
| Category: Dangerous / unsafe product or service | high | product/service safety | 4 hours | when otherwise unscoped | case-dependent | yes |
| Admin-created Support escalation | high | Trust & Safety priority | 4 hours | inherited | case-dependent | yes |

When the selected category and urgency indicator map to different routes, the runtime chooses the higher severity; ties use the shorter response target and then the explicit urgency indicator. A conflicting selection therefore cannot lower the applicable route.

These are internal response targets, not a promise of a continuously staffed emergency response. Public launch readiness must assess staffing and on-call coverage separately.

## 3. Required operating sequence

1. The Incident and its Trust & Safety case are created in one database transaction.
2. If a structured severe trigger matches, the same transaction creates `trust_case_escalations`, raises the case severity and records an allegation-class risk event plus an automated or reviewed routing action.
3. Critical country-scoped escalations are visible only to Country Admin/Super Admin authority with `incident.triage`.
4. The reviewer opens the case, reads only the evidence necessary for the task, and acknowledges the escalation with explicit human-review confirmation and rationale.
5. Acknowledgement assigns ownership and moves an open case to investigation. It does not impose a sanction.
6. The reviewer records proportionate safety, security, payment, privacy or legal handoffs outside the case only through an approved specialist process.
7. The reviewer resolves the escalation only after acknowledgement, with a resolution rationale.
8. The Incident and case cannot be closed while a severe escalation remains active. Case severity cannot be reduced below the active escalation.
9. All case views, evidence views, acknowledgements, resolutions and case-state changes remain audited.

## 4. External-reporting and legal boundary

`external_reporting_state` is fixed at `not_determined` in V1. No V1 API can mark an authority report as completed. A later legally reviewed process must define authorized reporters, destinations, approval/separation-of-duties controls, required contents, safe transmission, receipt evidence, correction and audit before this state can change.

Republic Act No. 11930 includes preservation, takedown and reporting duties for specified actors and covered circumstances involving online sexual abuse or exploitation of children. The exact Business & Life duty depends on its final service/operator role and the facts of the case. A critical internal route therefore requests legal review and evidence preservation; it does not assume that every report is covered or that the platform has already fulfilled a statutory notification.

Primary source:
https://lawphil.net/statutes/repacts/ra2022/ra_11930_2022.html

The same role-specific legal determination applies to payment-fraud, money-mule, privacy, cybercrime and law-enforcement requests. Staff must not invent a reporting destination or disclose evidence without an approved lawful process.

## 5. Due process and data minimization

- A report remains an allegation until human review establishes supported facts.
- Free text is never parsed into a severe classification in V1.
- The escalation record stores closed trigger/route codes, not the report narrative, address, phone, email, raw evidence or access token.
- An escalation alone does not suspend an account, remove content, freeze funds or notify another party.
- Any later adverse action must use the proportionate intervention ladder, reason category, human review, audit and appeal/review path defined by the parent Trust & Safety architecture.
- Evidence access must remain need-to-know and independently audited.

## 6. Quality and release gates

Before promotion to `main`:

1. local syntax and regression tests pass;
2. GitHub CI passes on the exact PR head;
3. the exact head deploys to `accounting-preview` using the isolated QA database;
4. Preview verifies schema constraints, `/health`, queue priority, acknowledgement, resolution, close guards and external-reporting copy;
5. logs show no startup/schema/runtime error;
6. only after Preview PASS may the PR merge and production be verified.
