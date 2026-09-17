# Role × Documentation Matrix

Status: **INITIAL CANONICAL MATRIX — V1**

This matrix defines documentation responsibilities, not final runtime RBAC implementation.

Legend:

- R = Read
- A = Acknowledge
- X = Execute/follow
- C = Create/input
- V = Review/verify
- P = Approve
- G = Generate
- S = Sign/acknowledge
- U = Submit/use with authority
- D = Audit

| Document family | Customer | Merchant | Supplier | Courier | Service Provider | Business operator/staff | Territory Admin | Country Admin | Super Admin | Executive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public product docs | R | R | R | R | R | R | R | R | R | R |
| Profile user guide | R/X | R/X | R/X | R/X | R/X | R | R | R | R | R |
| Profile agreement | R/A/S | R/A/S | R/A/S | R/A/S | R/A/S | R | V | P | D | R |
| Job description | — | as applicable | as applicable | as applicable | as applicable | R/A/X | V | P | D | R |
| Role SOP | as applicable | R/A/X | R/A/X | R/A/X | R/A/X | R/A/X | V | P | D | R |
| Business accounting policy | — | R/A/X | R/A/X | — | — | R/A/X | V | P | D | R |
| Procurement SOP | — | R/A/X | R/A/X | — | — | R/A/X | V | P | D | R |
| Delivery SOP | R (public parts) | R/X | — | R/A/X | — | R | V | P | D | R |
| Local Services SOP | R (public parts) | — | — | — | R/A/X | R | V | P | D | R |
| Incident policy | R/X | R/X | R/X | R/X | R/X | R/X | V/X | P | D | R |
| Licence/permit checklist | as applicable | R/X/G | R/X/G | R/X/G | R/X/G | R/X/G | V | P | D | R |
| Private legal interpretation | — | limited applicable | limited applicable | limited applicable | limited applicable | R where assigned | R/V | R/P | R/D | R |
| Authority submission pack | — | G/S/U where applicable | G/S/U | G/S/U | G/S/U | G/U | V/U | P/U | D | R |
| Territory launch manual | — | — | — | — | — | R | R/A/X | V/P | D | R |
| Country operations manual | — | — | — | — | — | limited | R | R/A/X | V/D | R |
| Masterplan | — | — | — | — | — | limited extracts | limited extracts | R | R | R/P |
| Investor/partner pitch | public extract | public extract | public extract | — | — | limited | R | R | R | R/P |
| Security/DR procedure | — | — | — | — | — | assigned only | assigned only | assigned only | R/V/D | R/P |

## Important rule

This matrix is a documentation-policy design. It does not grant application permissions.

Runtime authorization must rely on merged application RBAC and must be tested separately.
