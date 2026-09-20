# Notification Sound & Attention System V1

Status: **OWNER-APPROVED DIRECTION / IMPLEMENTATION CONTRACT**

Parent issue: #309

## 1. Product rule

Business & Life uses one notification language across all profiles.

The sound answers **what happened**.  
A subtle role accent may answer **in which profile it happened**.

Do not create unrelated sounds per screen, feature or team.

### Owner-fixed sound-set decision

The accepted product model uses three spoken notification sets:

1. **Set 2 — Friendly** is the fixed/default Business & Life choice.
2. **Set 1 — Professional** remains available as an alternative.
3. **Set 3 — Business** remains available as an alternative.

The user is not forced to select one pack globally. The user may choose a different set for each notification sound slot. For example:
- Merchant new order → Set 2;
- Courier new delivery request → Set 3;
- Payment / finance → Set 1;
- all remaining slots → inherited default Set 2.

Selecting Set 2 removes the override and returns that slot to the product default.

Spoken alerts must not read sensitive private values such as names, addresses, balances, payment amounts, security codes or private incident details aloud.

Sound is never the only carrier of meaning. Every audible event must also have visible notification content and, where supported and enabled, haptic feedback.

## 2. Base attention families

| Family | Meaning | Default audible behavior | Typical duration |
|---|---|---|---:|
| INFO | routine update or message | one soft cue | 0.3–0.5 s |
| SUCCESS | accepted, ready, completed | one positive cue | 0.5–0.8 s |
| ACTION | response required | distinct cue | 0.8–1.2 s |
| URGENT | time-sensitive response / serious operational incident | strong two-part cue, controlled repeats | 0.9–1.3 s |
| FINANCE | money received, refund, payout, settlement/payment state | recognizable neutral-positive cue | 0.5–0.8 s |
| WARNING | failure, cancellation, authorization/security problem | serious descending/contained cue | 0.6–0.9 s |

### Forbidden sound styles

Do not use:
- sirens;
- alarm-clock loops;
- horns;
- exaggerated cash-register sounds;
- casino/game reward sounds;
- long melodies;
- marketing sounds that imitate operational or financial alerts.

The audio identity should feel professional, calm and recognizable in a noisy real-world environment.

## 3. Role accents

Role accents are optional micro-signatures layered into the base family. They must remain subtle.

| Role/profile | Accent purpose |
|---|---|
| customer | neutral/base family; no extra accent required |
| merchant | distinguishes store/order work from personal/customer activity |
| courier | distinguishes delivery work from merchant/customer activity |
| supplier | distinguishes procurement/B2B work |
| service_provider | distinguishes local-service jobs |
| admin | reserved for incidents/actions requiring administrative attention |

A user with only one active profile does not need an obvious role accent.

A multi-profile user must be able to distinguish at least:
- Merchant ACTION;
- Courier ACTION;
- personal/Customer INFO.

Role accents must not create six unrelated musical themes. They are variants of the same Business & Life sound language.

## 4. Current event mapping

The mapping is role-aware. The same event code may require different attention for different recipients.

| Event | Recipient role | Family | Priority behavior |
|---|---|---|---|
| `order.created` | merchant | ACTION | audible once; repeat only if explicit acknowledgement workflow is introduced |
| `order.customer_checked_in` | merchant | ACTION | audible once |
| `order.customer_checked_in` | customer | INFO | one soft cue |
| `order.preparing` | customer | INFO | one soft cue |
| `order.ready` | customer | SUCCESS | audible once; stronger visual emphasis for pickup |
| `order.payment_confirmed` | merchant/customer | FINANCE | one finance cue |
| `order.completed` | customer | SUCCESS | one cue |
| `order.cancelled` | customer/merchant | WARNING | one warning cue |
| `delivery.assigned` | courier | ACTION | action cue |
| `delivery.assigned` | customer/merchant | INFO | one soft cue |
| `delivery.picked_up` | customer/merchant | INFO | one soft cue |
| `delivery.in_transit` | customer | INFO | one soft cue |
| `delivery.arrived` | customer | ACTION | audible once; vibration where available |
| `delivery.completed` | customer/merchant/courier | SUCCESS | one cue |
| `supplier.relationship_invited` | supplier | ACTION | one cue |
| `supplier.relationship_updated` | merchant | INFO | one soft cue |
| `procurement.po_created` | supplier | ACTION | one cue |
| `procurement.po_updated` | merchant/supplier | INFO or WARNING | status determines family |
| `procurement.payment_received` | supplier | FINANCE | one finance cue |
| `service.request_created` | service_provider | ACTION | one cue |
| `service.quote_created` | customer | ACTION | one cue |
| `service.quote_accepted` | service_provider | SUCCESS | one cue |
| `service.status_changed` | customer/provider | INFO or SUCCESS | status determines family |
| `support.ticket_created` | admin | ACTION / URGENT | ticket priority determines family |
| `support.user_reply` | admin | INFO | one cue unless ticket is urgent |
| `support.reply` | requester | INFO | one cue |
| `incident.updated` | requester/admin | WARNING / URGENT | escalation determines family |
| `profile.application_submitted` | admin | INFO / ACTION | normal review queue; no repeated audio |
| `profile.application_reviewed` | applicant | SUCCESS or WARNING | result determines family |
| `profile.authorization_changed` | affected profile | WARNING | mandatory visual notice; audible if enabled |
| `legal.reconsent_required` | account | ACTION | no urgent/repeating sound |

## 5. Planned time-sensitive events

When explicit offer/acceptance workflows are added, they must use dedicated event codes rather than overloading generic delivery/order events.

Recommended future codes:
- `delivery.offer_received`
- `delivery.offer_expiring`
- `delivery.offer_withdrawn`
- `order.merchant_ack_required`
- `order.merchant_ack_expiring`

### Controlled repeat policy

For an event that genuinely expires:
- initial cue immediately;
- at most two repeats before expiry;
- stop immediately on accept, decline, acknowledgement, cancellation or expiry;
- never loop continuously;
- do not create a second notification event for each repeated sound;
- respect OS/browser mute and Do Not Disturb controls.

Provisional cadence for acceptance testing:
- initial;
- +15 seconds;
- +30 seconds.

The cadence must later be tuned to the real acceptance timeout.

## 6. Vibration contract

Vibration is supplemental, never mandatory.

Recommended patterns, where the platform supports them:

| Family | Pattern concept |
|---|---|
| INFO | short single pulse |
| SUCCESS | two short gentle pulses |
| ACTION | medium + pause + short |
| URGENT | two strong pulses, pause, one strong pulse |
| FINANCE | short + short |
| WARNING | medium + pause + medium |

Exact millisecond values belong in the implementation policy and automated tests.

Users must be able to disable vibration globally.

## 7. Marketing rule

Marketing, promotions, referrals and recommendations are **silent by default**.

They must never:
- reuse ACTION, URGENT, FINANCE or WARNING audio;
- use repeated vibration;
- use `requireInteraction`;
- replace an operational notification with the same tag.

## 8. Admin noise control

Admin roles can receive high event volume.

Routine events such as normal payments, normal completed orders and standard profile queue activity must not produce a sound for every transaction.

Audible admin attention is reserved for:
- urgent support tickets;
- escalated incidents;
- payment-system failures that require action;
- security events;
- compliance/legal deadlines requiring action;
- operational service degradation requiring intervention.

Normal business telemetry belongs in dashboards, counters and digest views.

## 9. User settings contract

Target settings under **Profile → Settings → Notifications**:

### Global
- Sounds: On / Off
- Vibration: On / Off
- Important alerts: On / Off
- Preview sound / vibration

### Per-notification voice choice
Each supported notification sound slot exposes the same three choices, ordered with the default first:
- Set 2 — Friendly (default);
- Set 1 — Professional;
- Set 3 — Business.

Current configurable slots include Merchant new order, Merchant action, Courier new delivery, Courier action, Supplier action, Service Provider action, payment/finance, general update, success, general action, urgent and warning.

### Topics
- Messages
- Orders & requests
- Delivery activity
- Financial activity
- Support & incidents
- Security & account
- Legal & compliance
- Promotions & marketing

### Multi-profile overrides
A user may override operational sound behavior for:
- Customer
- Merchant
- Supplier
- Courier
- Service Provider
- Admin

Security/legal mandatory in-app availability remains governed by the notification policy. Audible sound itself must not be treated as mandatory.

## 10. Accessibility and safety

- Never communicate a state through sound alone.
- Provide text, iconography and state labels.
- Do not bypass device mute, accessibility preferences or Do Not Disturb.
- Avoid startling frequency peaks and long high-volume sounds.
- Do not require hearing to complete an action.
- Time-sensitive actions must expose the remaining time visually.
- Repeated alerts must have a clear stop condition.

## 11. Platform capability contract

### Current PWA / Web Push

The current app uses Web Push and `ServiceWorkerRegistration.showNotification()`.

Portable web notification options support:
- system notification behavior;
- `silent`;
- vibration where supported;
- `renotify`;
- `requireInteraction` where supported;
- tags/grouping.

The web notification standard does **not** expose a portable custom sound-file option.

Therefore:
- background Web Push uses browser/OS notification sound behavior;
- branded audio can be used in the foreground only when browser media/autoplay policy permits;
- application logic must still send an attention family so every client can map it to the best supported behavior.

### Future native Android shell

Android Notification Channels can map attention families to:
- custom sound;
- channel importance;
- vibration;
- user-visible channel controls.

Because Android channel behavior persists after channel creation, channel identifiers must be versioned if auditory behavior changes materially.

## 12. Data contract

Notification events should gain an application-level attention classification independent of transport:

```text
attention_family = info | success | action | urgent | finance | warning
attention_role   = customer | merchant | supplier | courier | service_provider | admin | ""
attention_repeat = none | controlled
attention_haptic = off | soft | action | urgent | finance | warning
```

This classification belongs in a central policy function, not copied into individual routes.

The policy function should accept at least:
- `event_code`;
- recipient `role_hint`;
- event `priority`;
- event data/status where needed.

## 13. Audio asset acceptance rules

Final branded audio assets are not accepted merely because a file exists.

They require an Android listening test for:
- quiet room;
- street/noisy environment;
- phone speaker at low/medium volume;
- repeated alerts without annoyance;
- clear Merchant ACTION vs Courier ACTION distinction;
- no confusion between FINANCE and SUCCESS;
- no confusion between WARNING and URGENT.

Target asset names:

```text
bl-info
bl-success
bl-action
bl-urgent
bl-finance
bl-warning
```

Role variants, if the listening test proves necessary:

```text
bl-action-merchant
bl-action-courier
bl-action-supplier
bl-action-service
```

Do not create role variants unless they materially improve recognition.

## 14. Implementation order

1. Add central attention policy + unit tests.
2. Include attention metadata in in-app/push payloads.
3. Add PWA vibration/renotify/interaction behavior.
4. Add notification settings model without breaking existing preferences.
5. Add foreground audio adapter with graceful no-audio fallback.
6. Produce candidate audio assets.
7. Android owner listening/acceptance test.
8. Only after acceptance, freeze V1 asset names.
9. When a native Android shell exists, map the same families to Notification Channels.

## 15. Definition of done

V1 is complete when:
- every current notification event has deterministic attention behavior;
- multi-profile users can distinguish critical Merchant and Courier actions;
- marketing cannot impersonate operational alerts;
- admins are protected from notification noise;
- sound/vibration can be disabled;
- background PWA behavior degrades correctly to OS capabilities;
- automated tests cover the mapping and safety rules;
- final branded sounds pass Android listening acceptance.
