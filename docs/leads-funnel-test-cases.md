# EMA Leads Funnel — Test Cases

Every case below is automated in `tests/e2e/` unless marked BLOCKED or DEFECT.
`@smoke` = part of the smoke set. Each spec carries an in-line comment stating
the expected business outcome.

## A. Lead capture — `a-lead-capture.spec.ts`

| ID | Case | Tag / status |
|---|---|---|
| A-01 | Funnel entry point renders and starts the assessment | @smoke |
| A-02 | Lead is created and saved with a reference number | @smoke |
| A-03 | Required fields enforced (missing full name → 400) | |
| A-04 | Invalid email is rejected | **DEFECT DEF-001** (`test.fail`) |
| A-05 | Invalid phone (WhatsApp) format is rejected | **DEFECT DEF-002** (`test.fail`) |
| A-06 | Consent is mandatory (POPIA) | |
| A-07 | Business funnel rejects a submission without a firm name | |
| A-08 | Duplicate lead (same email) → 409 with existing reference | |
| A-09 | Duplicate lead (same WhatsApp) → 409 | |
| A-10 | Honeypot-filled bot submission: synthetic 201, no row stored | |
| A-11 | Thank-you page shows the lead reference | |
| A-12 | Full OTP verification walk in the UI | BLOCKED — needs real OTP delivery |

## B. Lead qualification — `b-lead-qualification.spec.ts`

| ID | Case | Tag / status |
|---|---|---|
| B-01 | Admin can log in and see the dashboard | @smoke |
| B-02 | Update lead status; persists after refresh | @smoke |
| B-03 | Assign an owner from the assignable-users roster | |
| B-04 | Add an internal note and read it back | |
| B-05 | Schedule a follow-up with a note | |
| B-06 | Changes persist after logout and re-login | |
| B-07 | Tag lead by source/city/segment | BLOCKED — no tag-editing API/UI |

## C. Outreach — `c-outreach.spec.ts`

| ID | Case | Tag / status |
|---|---|---|
| C-01 | Status → contacted appears in the activity timeline | |
| C-02 | Completing a follow-up stamps last-contacted | |
| C-03 | Outreach timeline visible on the lead detail page | |
| C-04 | Communication templates hub reachable | |
| C-05 | Campaign email send with message record verification | BLOCKED — sends real email (Resend); unlock via env-gated email sink |
| C-06 | Confirmation email/WhatsApp engagement record on finalize | BLOCKED — finalize triggers real sends; needs the same email sink |

## D. Conversion — `d-conversion.spec.ts`

| ID | Case | Tag / status |
|---|---|---|
| D-01 | Cannot convert before ready_for_case (409) | @smoke |
| D-02 | ready_for_case → converted creates a case | @smoke |
| D-03 | Conversion idempotent — retry returns the SAME case | |
| D-04 | Converted state reflected on the lead record page | |
| D-05 | Demo booking fields / date-time handling | BLOCKED — feature absent |

## E. Pipeline visibility — `e-pipeline.spec.ts`

| ID | Case | Tag / status |
|---|---|---|
| E-01 | New lead appears in the dashboard list | @smoke |
| E-02 | Lead shows in the correct stage after a status change | |
| E-03 | Stage counts update as a lead moves | |
| E-04 | Dashboard status filter narrows the list | |
| E-05 | Filter by owner via API query | |
| E-06 | Kanban drag-and-drop stage move | BLOCKED — DnD not reliably automatable |

## F. Negative & resilience — `f-negative.spec.ts`

| ID | Case | Tag / status |
|---|---|---|
| F-01 | Incomplete assessment form cannot advance | @smoke |
| F-02 | Invalid pipeline transition rejected; state untouched | |
| F-03 | Bogus status value rejected with 400 | |
| F-04 | Double submission does not create two leads | |
| F-05 | Browser back/forward does not crash the funnel | |
| F-06 | Unknown admin route degrades gracefully | |
| F-07 | Email-provider outage resilience | BLOCKED — cannot fault-inject Resend |

## G. RBAC — `g-rbac.spec.ts`

| ID | Case | Tag / status |
|---|---|---|
| G-01 | Unauthenticated requests cannot read leads | @smoke |
| G-02 | Unauthenticated visitor pushed to admin login | @smoke |
| G-03 | Wrong password rejected | |
| G-04 | Invalid legacy admin token rejected | |
| G-05 | Unauthorized users cannot perform restricted updates | |
| G-06 | Standard admin blocked from user management (superadmin-only) | |
| G-07 | Cross-tenant data leakage | N/A — single-tenant system |

## H. Auditability — `h-audit.spec.ts`

| ID | Case | Tag / status |
|---|---|---|
| H-01 | Status change produces an audit/timeline entry | @smoke |
| H-02 | Note creation captured in the audit trail | |
| H-03 | Assignment change captured in the audit trail | |
| H-04 | Audit trail visible in the lead activity feed UI | |
