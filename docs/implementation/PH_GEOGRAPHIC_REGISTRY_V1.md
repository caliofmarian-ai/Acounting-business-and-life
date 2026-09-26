---
title: PH Geographic Registry V1
status: implemented
country_code: PH
owner_role: Product Owner
source_authority: Philippine Statistics Authority
source_registry: Philippine Standard Geographic Code
source_version: 2026-06-30
---

# PH Geographic Registry V1

## Purpose

Business & Life separates **official Philippine geography** from **Business & Life operating territories**.

The official geography registry is reference data. Importing or synchronizing it never opens a market, grants a profile, delegates Admin authority, starts onboarding or enables payments.

An operating territory is created only when an authorized Admin explicitly selects an official PSGC geography record and chooses a Business & Life territory status.

## Canonical source

PH Geographic Registry V1 is pinned to:

- Philippine Statistics Authority (PSA);
- Philippine Standard Geographic Code (PSGC);
- 2Q 2026 publication / source date 2026-06-30;
- official PSA publication landing page: https://psa.gov.ph/classification/psgc;
- official publication workbook: PSGC-2Q-2026-Publication-Datafile.xlsx.

The importer records the authoritative PSA source URL and version. When PSA permits the server-to-server XLSX download, the workbook SHA-256 is recorded. When PSA blocks Railway with HTTP 403, V1.1 falls back to the pinned `@ianlabicani/geoph-lite@2.0.0` Q2 2026 snapshot, generated from the same PSA 30 June 2026 release; the package/commit reference and a deterministic snapshot SHA-256 are recorded as transport provenance.

## Data model

ph_geographic_registry_imports records each synchronization attempt and its evidence:

- source version;
- source URL;
- source/snapshot SHA-256;
- source transport and pinned transport reference;
- row and level counts;
- actor;
- success/failure;
- timestamps and bounded error evidence.

ph_geographic_registry stores versioned PSGC reference rows. A row includes:

- 10-digit PSGC code;
- correspondence code when published;
- official name;
- raw and normalized geographic level;
- derived parent PSGC code;
- derived readable hierarchy path;
- old name, city class, income classification, urban/rural and population fields when present;
- source version and source-row evidence.

Old source versions are not deleted when a newer source is introduced.

territories remains the operational table and now additionally records:

- psgc_code;
- geographic_source = PSA_PSGC;
- geographic_source_version.

Only opened Business & Life territories belong in territories.

## Import safety

The sync endpoint runs only on an explicit Super Admin action. It first attempts the pinned official PSA workbook. If that transport is blocked or unavailable, it uses the pinned offline Q2 2026 snapshot rather than failing solely because of the transport layer.

Before committing reference rows, the importer verifies the XLSX/ZIP payload and validates the pinned 2Q 2026 counts:

- 18 regions;
- 82 provinces;
- 149 cities;
- 1,493 municipalities;
- 42,010 barangays.

A transport failure alone may trigger the validated offline fallback. A failed parse, integrity check or count validation records a failed import attempt and does not replace an existing successful registry. The fallback additionally verifies the Q2 2026 `Sawata` change (`1102324000`) and `City of Bacoor` (`0402103000`) before import.

## Admin workflow

Admin → Territories no longer asks an operator to type an official Philippine city/province/barangay name or invent an internal geographic code.

The workflow is:

1. synchronize the pinned official PSGC publication when the registry is not ready;
2. search by official name, hierarchy or PSGC code, or browse from regions to child geography;
3. select an official geography record;
4. choose the Business & Life status: planned, onboarding, active, paused, suspended or closed;
5. open the selected geography as an operating territory.

The server derives name, type and code from the registry. Client-provided text cannot override the official PSGC identity.

## Compatibility boundary

Manual administrative-area creation remains available only for:

- custom_cell operating scopes;
- internal QA environments;
- automated test environments.

This preserves existing QA/CI fixtures without allowing production Admin users to create an unofficial Philippine province, city, municipality or barangay by free text.

## Territory hierarchy

The reference registry derives parent relationships from PSGC hierarchy components.

When an official geography is opened, Business & Life links it to the nearest already-open official ancestor if one exists. Opening City of Bacoor therefore does not automatically activate CALABARZON or Cavite as Business & Life operating territories.

This preserves the invariant that reference geography exists nationally, while operating territory exists only by explicit Business & Life activation.

## APIs

Scoped Admin routes:

- GET /api/governance/admin/geography/status
- GET /api/governance/admin/geography/search
- POST /api/governance/admin/geography/sync
- POST /api/governance/admin/territories

National registry synchronization additionally requires an active Super Admin assignment.

## Non-goals

V1 does not:

- auto-open all Philippine administrative units;
- infer a user's territory from IP;
- change existing orders, applications, authorizations or accounting history;
- activate payment or commercial policy;
- replace address/geocoding providers;
- create a second country edition.

Future country editions should implement their own authoritative geographic registry adapter rather than reusing PSGC as a global geography model.
