# Guided Onboarding Missions V1

## Design source

Approved implementation reference:

https://www.figma.com/design/PHzcLeL0a8biPACZNf8yBf

Figma states:
- Mobile coachmark on Account Home;
- Mobile Mission Center;
- Desktop first-profile guidance.

## Purpose

New users should not be dropped into Business & Life with a list of unexplained screens.

V1 provides a first-run tutorial based on **real product actions**, using a mission/checklist model similar to a game tutorial without using pressure, streaks, fake rewards or forced role selection.

## Journey

Canonical journey key:

`first_account_first_profile_v1`

Steps:

1. `welcome`
2. `complete_account`
3. `area_status`
4. `account_settings`
5. `manage_profiles`
6. `choose_profile`
7. `profile_onboarding`

The guide auto-completes facts that are already true, such as verified/completed account requirements or a profile already submitted/active.

## Interaction model

The guide uses:

- a spotlight around the **real UI target**;
- a compact coachmark with current mission and progress;
- Mission Center checklist;
- Skip for now;
- Resume;
- Restart tutorial from Account Settings;
- account-scoped persistence.

The spotlight is pointer-transparent so the user interacts with the actual Business & Life control rather than a duplicate tutorial control.

## Persistence

`guided_onboarding_progress` is keyed by account and journey.

It stores:

- current step;
- completed step IDs;
- active / paused / completed status;
- selected first-profile role;
- whether automatic first-run presentation is enabled;
- started / paused / completed / updated timestamps.

Progress survives logout and device changes.

## Neutral first-profile selection

Business & Life does not recommend or preselect a political, commercial, or work role for the person.

The guide says **choose the profile you need** and follows that choice:

- Customer;
- Merchant;
- Supplier;
- Delivery;
- Local Services.

Existing product governance remains authoritative:

- Customer uses its self-service activation gates;
- Merchant, Supplier and Delivery retain invitation/approval controls;
- Local Services retains its application/review flow.

The tutorial never bypasses or weakens a gate.

## Profile substeps

Inside the first profile, coachmarks follow the fields/actions that already exist.

Examples:

- Merchant / Supplier: business name;
- Local Services: headline, experience, requested service categories;
- Delivery: vehicle selection/evidence guidance;
- all governed applications: responsibility declaration, Save application, Submit for review.

Optional evidence remains optional. The tutorial does not invent new requirements.

## Geographic awareness

The guide consumes Account Geographic Assignment V1.

If the person has no official barangay, the guide directs them to complete it.

If the barangay is:

- onboarding / active — profile onboarding can continue;
- planned / paused / suspended / closed / not opened — the guide explains the real state and waits without pretending the territory is available.

Private street address and PSGC operating area remain separate.

## Google registration

Google may create an account before an official barangay is known. The guide therefore treats account/area completion as an explicit first mission.

## Company-managed test accounts

Company test identities do not receive personal-address tutorial requirements and are excluded from automatic personal first-run guidance.

## Accessibility and control

- coachmark uses dialog semantics;
- real target remains interactive;
- reduced-motion is respected;
- user can pause at any time;
- launcher remains available while paused;
- completed tutorial can be restarted from Account Settings;
- tutorial state never grants authorization.

## Registration reconciliation

V1 also reconciles the modern registration surface with Account Geographic Assignment V1: email registration in the modern auth card includes official PSGC barangay search and submits `home_psgc_code`.
