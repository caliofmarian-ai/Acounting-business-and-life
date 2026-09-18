---
document_id: BL-PH-CONTROLLER-ALLOCATION-001
title: Controller / PIC Allocation Assessment
document_type: privacy_controller_assessment
status: DRAFT_FACT_FINDING
country_code: PH
final_controller_model: UNRESOLVED
public_notice_status: NOT_READY
version: 1.0
---

# Business & Life — Controller / PIC Allocation Assessment

## 1. Why this assessment exists

Business & Life currently has two different human roles:

1. the **Project Owner**, who defines major product/policy decisions; and
2. the **initial Philippine operator**, a natural person designated to operate Business & Life locally.

Those roles are not automatically equivalent to:
- controller / Personal Information Controller (PIC);
- processor / Personal Information Processor (PIP);
- DPO.

The final privacy role must follow the actual processing-control facts.

## 2. Philippine controller/PIC rule used by this assessment

The Philippine Data Privacy Act and IRR define controller responsibility by actual control over personal-data processing.

Relevant questions include who determines:
- what information is collected;
- why it is collected / the processing purpose;
- the extent of processing;
- the processors/recipients used;
- retention/deletion rules;
- material changes to those decisions.

A person who merely performs processing under another controller's instructions is not treated as the controller for those instructed functions merely because that person performs the work.

Official sources:
- https://privacy.gov.ph/data-privacy-act/
- https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/

## 3. Known facts — Project Owner

The Project Owner has already made material decisions relevant to personal-data processing, including:

- selected referral attribution model: `registration_context_v1`;
- approved 90-day retention for unconverted referral events;
- approved a 12-month converted-attribution product target;
- directed the legitimate-interest assessment path;
- decided rewards remain OFF for the initial pilot;
- decided external PostHog remains OFF until the exact Business & Life project is verified.

These facts are evidence of decision-making authority for the **referral/growth processing domain**.

They do not, by themselves, prove that the Project Owner is the sole PIC for every Business & Life processing system.

## 4. Known facts — initial Philippine operator

The Project Owner designated a natural person in the Philippines as the first local Business & Life operator.

Current verified facts:
- she is expected to operate Business & Life locally;
- Business & Life is not yet a formed legal entity;
- her legal name/public contact have not been supplied for canonical publication;
- the repository currently has no verified evidence establishing whether she will have final authority over all processing purposes, data categories, retention or processors.

Therefore:

`PHILIPPINE_OPERATOR_PIC_STATUS = PROVISIONAL_CANDIDATE`

not:

`SOLE_PIC_CONFIRMED`.

If she is ultimately confirmed as an individual PIC, current NPC guidance treats the individual PIC as de facto DPO.

## 5. Local operation is not the same as controller authority

Examples:

- A local operator may execute Customer Support but follow privacy rules defined elsewhere.
- A Project Owner may define the purpose/retention of referral analytics while the Philippine operator administers users locally.
- Both people may participate in material decisions.
- A future registered Business & Life entity may later assume decision authority.

The project must document the real governance structure instead of assigning PIC status from job title alone.

## 6. Processing-domain allocation matrix

Current state before final Owner governance confirmation:

| Processing domain | Known purpose/policy decision evidence | Expected local operation | Current controller conclusion |
| --- | --- | --- | --- |
| Account identity/authentication | Product architecture exists; final human authority not recorded | Philippine operator expected | UNRESOLVED |
| Merchant/Supplier operations | Product architecture exists; final human authority not recorded | Philippine operator expected | UNRESOLVED |
| Courier / active delivery location | Product rules exist; final human authority not recorded | Philippine operator expected | UNRESOLVED |
| Service Provider CV/credentials | Product rules exist; final human authority not recorded | Philippine operator expected | UNRESOLVED |
| Payments/accounting | Product rules/provider architecture exist; final human authority not recorded | Philippine operator expected | UNRESOLVED |
| Support/Incident/privacy rights | Canonical workflow exists; final human policy authority not fully recorded | Philippine operator expected | UNRESOLVED |
| Referral/growth analytics | Material Project Owner decisions are recorded | Philippine operator expected | PROJECT OWNER CONTROL EVIDENCE EXISTS; FINAL MODEL UNRESOLVED |
| Admin authorization/audit | Governance architecture exists; final human authority not recorded | Philippine operator expected | UNRESOLVED |
| External processors/vendors | PostHog kept OFF by Project Owner; other vendor authority not fully allocated | operational execution may be local | UNRESOLVED |

## 7. Possible controller structures

### Model A — Philippine operator as sole individual PIC

This model is factually supportable only if the Philippine operator has real final authority over the relevant processing purposes/extent and is not merely executing processing rules set by another controller.

If confirmed:
- she is the individual PIC;
- current NPC guidance treats her as de facto DPO;
- the EFFECTIVE Privacy Notice must use her verified legal/controller contact facts;
- applicable NPC registration must use truthful operator/controller data.

### Model B — Project Owner as individual PIC

This may be factually supportable if the Project Owner continues to determine the relevant collection, purposes, extent, retention and processor decisions while the Philippine operator predominantly executes those decisions.

This assessment does **not** select this model.

Because the platform concerns Philippine users/operations, Philippine-law territorial/extraterritorial applicability must be assessed on the actual facts.

### Model C — multiple/shared controller responsibility

This may need review where both people materially determine processing purposes or scope.

Do not mechanically import terminology from another jurisdiction; record the actual responsibility allocation and review it under Philippine privacy law.

### Model D — future Business & Life legal entity

When a real Business & Life entity is formed and actually assumes controller authority:
- update the controller allocation;
- update contracts/vendor terms;
- update NPC records where applicable;
- issue a versioned Privacy Notice change;
- preserve audit history of the earlier natural-person period.

## 8. PIC versus PIP boundary

Do not label the Philippine operator a PIP merely because another person made some product decisions.

A PIP classification requires analysis of whether that person processes personal information on behalf of a PIC under instructions for the relevant processing.

Likewise, the Project Owner is not automatically a PIC merely because he owns or designed the product.

The deciding factor is **actual control for the relevant processing domain**.

## 9. Extraterritorial relevance

The Project Owner's physical location outside the Philippines does not, by itself, eliminate Philippine privacy-law relevance.

The DPA/IRR includes extraterritorial provisions where the statutory connection to Philippine citizens/residents/entities or processing exists.

The project must therefore assess the Project Owner's controller role from actual decision-making facts, not from residence alone.

## 10. Activation impact

Until final controller allocation is confirmed:

`CONTROLLER_ALLOCATION_READY = false`

`EFFECTIVE_PRIVACY_NOTICE_READY = false`

`DURABLE_REFERRAL_ATTRIBUTION_ALLOWED = false`

`EXTERNAL_POSTHOG_ALLOWED = false`

This does not block ordinary software development.

It blocks publication/activation that would require a truthful controller identity and approved processing basis.

## 11. Facts needed to complete the allocation

For each processing domain, decide who has **final authority** to:

1. approve the purpose of processing;
2. decide what personal-data categories are collected;
3. approve/change retention and deletion;
4. select processors/recipients/vendors;
5. approve privacy notices and rights-handling rules;
6. stop or materially change the processing;
7. instruct the person who performs day-to-day operations.

The answer may differ by domain.

## 12. Current assessment outcome

`FINAL_CONTROLLER_MODEL = UNRESOLVED`

Current evidence supports:
- **Philippine operator:** local operational authority is expected;
- **Project Owner:** controller-level decision evidence exists at least in referral/growth policy;
- **future entity:** does not yet exist.

No EFFECTIVE public document should name a sole PIC until the actual authority allocation is confirmed and the responsible legal identity/contact is verified.
