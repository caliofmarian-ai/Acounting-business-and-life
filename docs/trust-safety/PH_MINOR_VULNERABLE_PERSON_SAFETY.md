# Philippines minor and vulnerable-person safety — V1

Status: launch control pending final Philippine legal and privacy review
Policy version: `ph-adult-eligibility-v1`

## Launch decision

Business & Life uses an adult-only boundary for the controlled Philippines pilot. A personal account must explicitly declare that the account holder is at least 18 before any Customer or operational profile can be activated, entered, reactivated or onboarded.

This is a conservative product-safety decision for commerce, payments, Delivery, Local Services/home visits and work profiles. It is not a claim that self-declaration proves age, and it does not establish a legal “age of digital consent.”

## Data-minimizing implementation

- Do not collect date of birth merely to operate this gate.
- Do not collect disability, medical or capacity data.
- Do not infer that a pending account belongs to a child.
- Record only a versioned eligibility state, time, source and append-only audit event.
- A Google-created or legacy personal account remains `pending` until authenticated attestation.
- Company-managed QA identities receive a distinct `company_test_exempt` state; this exemption cannot be used by personal accounts.
- Existing active legacy profiles are not silently disabled by migration, but the gate applies before the next profile activation, switch, reactivation or onboarding action.
- Governed Merchant, Supplier, Courier and Service Provider approval requires an explicit human Admin eligibility review. The event does not claim document-based identity or age verification.

## Product safeguards

1. Password registration requires an unchecked-by-default 18+ declaration tied to the current policy version.
2. Pending accounts can sign in and use Account Settings, support, privacy and reporting paths, but cannot enter operational profiles.
3. The authenticated attestation endpoint is rate-limited and audited.
4. Governed profile approval fails closed without explicit Admin confirmation.
5. Restricted status can only be cleared through a future documented Trust & Safety review flow; self-attestation cannot overwrite it.
6. Child/vulnerable-person exploitation reports route through the severe Trust & Safety escalation control; reports remain allegations until human review.
7. Exact location, contact and evidence remain private and purpose-limited under their dedicated controls.

## Vulnerable adults

Philippine child-protection sources can include some adults who cannot protect themselves from abuse or exploitation because of a condition or disability. V1 therefore does **not** treat “18+” as a complete vulnerable-person safeguard. The platform must not ask users to disclose disability to pass the gate, automatically exclude adults on that basis, or attach stigmatizing labels. Reports involving exploitation, coercion, trafficking, threats or immediate safety risk must use the severe human-review escalation path.

## Required follow-up before allowing minors

The adult-only pilot boundary may be changed only after a documented Child Privacy Impact Assessment, legal review and product controls covering guardian involvement where appropriate, age assurance proportionate to risk, child-friendly notices, highest-privacy defaults, geolocation minimization, communications safety, reporting, incident response and breach communications.

## Primary sources reviewed

- [NPC Advisory No. 2024-03 — Guidelines on Child-Oriented Transparency](https://privacy.gov.ph/wp-content/uploads/2024/12/Advisory-2024.12.17-Guidelines-on-Child-Oriented-Transparency-w-SGD.pdf)
- [NPC FAQ — Guidelines on Child-Oriented Transparency](https://privacy.gov.ph/wp-content/uploads/2024/12/FAQs-Advisory-on-Guidelines-on-Child-Oriented-Transparency.pdf)
- [Republic Act No. 10173 — Data Privacy Act of 2012 (NPC)](https://privacy.gov.ph/data-privacy-act/)
- [NPC — Data Subject Rights](https://privacy.gov.ph/data-subject-rights/)

The NPC guidance says child-related processing needs a risk-based, context-specific approach; it identifies highest-privacy defaults and warns that self-declaration alone may be inadequate for high-risk processing. That is why V1 combines self-attestation, operational blocking, human review for governed profiles and a documented future-assessment requirement rather than representing the declaration as verified age.
