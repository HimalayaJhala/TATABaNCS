# Simulated BaNCS — Build Spec

Build brief for the Old Mutual Seek PoC: a simulated BaNCS front-end plus a dummy dataset, served from separate local servers so the demo looks and behaves like the real multi-application workflow.

> **Superseded in part.** Scene 1 now uses the team's Excel work list instead of Bizagi (`bizagi-sim` and screen 13 were removed), and the BaNCS screens follow the SOP screenshots in `/docs/sop/`. See `/README.md`, "Where the build differs from the brief".

---

## Scope boundary — read this first

The PoC is one flow: S&I 100% fee zeroing, per the SWITCHING OFF FEES SOP. Old Mutual said on the call that split fee cases are not part of this PoC. PUFS and CUFS was shown as an aside and was never agreed. Build the one flow well rather than three flows thinly.

| Item | In PoC | Note |
| --- | --- | --- |
| `data-service`, `bizagi-sim`, `bancs-sim` | Yes | The three processes the flow needs |
| `bancs-cb-sim` (closed book, port 4003) | No | Only exists for PUFS and CUFS. Skip it |
| Screens 1–6 and 9–13 | Yes | The fee-zeroing path end to end |
| Screens 7–8 (Adviser Change, sharing tables) | No | Split commission. Phase 2 |
| Milestones 1–7 and 9–10 | Yes | — |
| Milestone 8 (split commission) | No | Build only if the PoC lands early and Old Mutual asks |
| ID match, zero-fee skip, maker-checker, submission validation, step ordering | Yes | All come straight from the SOP |
| Error 56000 blocker | Judgement call | Not in the fee-zeroing SOP, but it is the only exception the demo gets to show. Cheap to build. Drop it if time is tight |
| Lapsed policy, multiple benefits, wildcard search | No | PUFS and CUFS stop conditions. Not reachable from this flow |
| Reset endpoint, configurable latency | Yes | Not BaNCS features, but they are what makes the demo repeatable |
| Audit panel | No | Nice to have. Leave it unless someone asks for it |

---

## Inputs

| Input | What it is used for |
| --- | --- |
| BaNCS screenshots (from Therlo Davids) | Visual fidelity — layout, colours, field placement, button styling. Put them in `/reference/`, named per screen, and open the matching file before building each screen |
| SWITCHING OFF FEES SOP (.docx) | The exact click path and field values for the main flow |
| SWITCHING OFF FEES – SPLIT COMMISSION SOP (.docx) | Phase 2 only. Two extra sharing tables and a fee recalculation |
| This spec | Architecture, routes, state machine, seed data |

Before starting, list the screenshots actually available against the screens table below. Any screen without a screenshot gets invented, and invented screens are the ones the customer notices in a live demo.

Suggested repo layout:

```
/docs/build-spec.md
/docs/sop/
/reference/
```

Work one milestone at a time. Do not generate the whole app in one pass.

---

## Architecture — separate servers, one shared dataset

Three processes for the PoC. The front-ends hold no data of their own; they read and write through the data service. That is what makes "dummy dataset called upon by the simulated front-end" true rather than decorative, and it is what lets Seek write a value on one screen and read it back on another.

| Process | Port | Stands in for | Needed for |
| --- | --- | --- | --- |
| `data-service` | 4000 | The BaNCS database | Everything. Single source of truth, JSON or SQLite backed |
| `bizagi-sim` | 4001 | Bizagi service transaction queue | Scene 1 — work item pickup, policy number and client ID |
| `bancs-sim` | 4002 | BaNCS IIMS open book | Scenes 2–10. The main build |

Add hosts entries so the address bar reads like the real thing during the demo — `bizagi.intranet` and `online.bancs.omapps.net` mapped to 127.0.0.1, each on its port. A demo where Seek visibly moves between two named applications is a different story from one where it moves between two localhost ports.

Run everything under one process manager with a single `npm run demo`.

---

## Stack and ground rules

**Server-rendered multi-page, not a single-page app.** Real BaNCS is a JSP application: every click is a form post, every result is a full page load, the left menu is a real navigation. Build it the same way — server-side templates, plain forms, full page reloads. An SPA would be faster to write and would behave nothing like the thing Seek has to drive in production, which undermines the PoC's whole claim.

**No client-side framework.** Plain HTML, a stylesheet matched to the screenshots, and the minimum JavaScript needed for the popup windows. Seek reads the DOM; keep the DOM stable and boring.

**Stable, meaningful element identifiers.** Every field, button and link gets a predictable `id` or `name`. Do not generate them. This is what Seek's configuration binds to, and churn here costs re-configuration later.

**Popups as real windows.** The Endorsement Initiation screen opens as a separate browser window in BaNCS. Reproduce that with `window.open` rather than an in-page modal — switching windows is part of what the demo is proving Seek can do.

**Server-side state.** All status transitions, validation and rule enforcement live in the data service, never in the browser. If a rule is enforced client-side, the demo proves nothing.

**Seed from a file, reset on demand.** The dataset ships as a JSON seed. A reset endpoint restores it. Never mutate the seed file itself.

---

## Screens to build

Every BaNCS screen sits inside a shared shell: top navigation, a welcome bar showing the logged-in user and role, batch date and system date, the left navigation panel, and the policy header band.

| # | Screen | Route | Must contain | Used in |
| --- | --- | --- | --- | --- |
| 1 | Login | `/login` | User and role selector. Two users: a SYS-ADMIN capturer and a PREM-ADM verifier | Setup |
| 2 | Quote/Contract Search | `/policy-servicing/search` | Contract No., Product, Quote No., Status, Party Code, ID No. fields. Search, Clear, Back | Scene 2 |
| 3 | Search results | `/policy-servicing/results` | Grid with Quote/Contract No. as a blue hyperlink, Contract Owner Name, ID No., Product, Status, Start Date, Endr Date | Scene 2 |
| 4 | Policy action bar | `/policy/:id` | Endorse/Alter, Cancel Policy, Endr History/New, Premium Transaction, Follow up Report, Back, Continue, Premium Projection, EAC | Scene 4 |
| 5 | Endorsement Initiation (popup) | `/policy/:id/endorse` | Endorsement Quote Date, Type of Endorsement multi-select with Change Adviser Details present, Later Effective Date, Quote Instance Number, Bizagi Case Id, CARMA Grouping Key, Requester Stake Code, Requester Party, Quote Required, Reason. Save | Scene 4 |
| 6 | Basic Details | `/policy/:id/basic-details` | Two-column field grid, and at the bottom a Remuneration & Fee Details section with VAT Inclusive and VAT Exclusive Asset Advice Fee. SAVE below the fold so a scroll is needed | Scenes 3, 5 |
| 7 | Adviser Change | `/policy/:id/adviser-change` | Links to Edit Contribution Remuneration Sharing and Edit Asset Remuneration Sharing | **Phase 2** |
| 8 | Remuneration sharing tables | `/policy/:id/sharing/:type` | Existing shares, an Add control that renders a blank record row, per-adviser fields, Save | **Phase 2** |
| 9 | Acceptance | `/policy/:id/acceptance` | List with a hyperlinked serial number; detail with Application Accepted Yes/No and a date field. Save | Scene 6 |
| 10 | Endr Quote Summary | `/policy/:id/quote-summary` | Action bar in order: Create or Refresh Layer, Calculate Premium, End Sub Endorsement, Lock EBQ, Finalise Endorsement. Commission Summary and EBQ Summary tables | Scene 7 |
| 11 | Endr Quote Submission | `/policy/:id/quote-submission` | Admin Requirements Outstanding, Underwriting Requirements Outstanding, All admin requirements received, Reinsurance Verified, Legal Verification. Save and Submit | Scene 8 |
| 12 | Endorsement Quotes | `/policy/:id/endorsement-quotes` | Serial No., Endr Quotation Number, Type of Endorsement, Endr Effective Date, Endr Quote Status, Cooling Off Applicable. Serial hyperlinked | Scene 9 |
| 13 | Bizagi work queue | `bizagi.intranet/queue` | Case list; Service Transaction tab per case showing Policy Number, ID Number, transaction type, declaration date | Scene 1 |

The left navigation changes by product and by whether an endorsement is open. Keep it data-driven rather than hard-coded per page, or screen 6 will drift from screen 10.

---

## UI specification — match the recording

The values and labels below are read off the screen recording of 4 August 2026. Use them as the literal defaults.

### Shared chrome, on every BaNCS page

Top left: TCS BaNCS wordmark with the TATA mark beneath it. Centred: "Welcome &lt;user name&gt;". Right: a blue strip carrying the role (SYS-ADMIN or PREM-ADM), then HO, then ENGLISH, each on its own blue tab, with a power icon at the far right. The header band is a pale yellow-to-white gradient sweeping right.

Under the header, in red: "Batch Date: 03/08/2026", "System Date: 04/08/2026", and "System Name:" followed by the .ear version string. Top right of that row: "Useful Links | Company Portal".

Navigation strip: an olive-yellow bar with Business Operations highlighted at the left, then Work Items, Business Partners, Maintain Intermediary, New Business, Policy Servicing, Claims, Document & Fax. The active tab renders teal. Below it a teal sub-bar with "Search Policy" in yellow and "Show Policy Version" with a star icon.

Left panel: a vertical menu, each item with a small round icon, the selected item highlighted blue with a right-pointing chevron. Bottom of the page: a yellow "My Work Items" tab.

Policy header band, two columns — left: Product Name, Quotation Number, Status. Right: Currency, Policy Number (blue hyperlink), Sub Status.

Buttons: blue gradient rectangles, white text, roughly 110px wide, laid out in rows and often repeated below the fold. Body text is small sans-serif, around 11px.

### Left navigation, exact order

LISP / S&I with an endorsement open: Contracting Party, Replacement Con Pty, Contribution Payer Info, Contribution Detail, Repay Contribution, Fund Allocation, Fund Property, Basic Details, Payment Cycle, Beneficiary, AML Details, Underwriting Details, Endr Quote Summary, Policy Action Details, Endr Quote Submission, Acceptance, Requestor Advisor Info, Adviser Info.

### Quote/Contract Search

Centred title "Quote/Contract Search". Left column: Product with a lookup button, Quote No., Date From with a calendar icon, Status as a dropdown defaulting to `--Select--`, Party Stake Name, Parameter, Branch Code defaulting to ALL. Right column: Contract No., Date To, Party Code with a lookup button, ID No./Passport No./Registration No. Below: "Tip: Click Table Header to sort results". Buttons: Search, Clear, Back.

Results: "Search Result Page: 1   Display Page: 1", Page Size 10. Columns — Quote/Contract No (blue hyperlink), Contract Owner Name, ID No., Product, Status, Start Date, Expiry Date, Endr Date, Cover Amount, REPL.

### Policy action bar

Endorse/Alter, Cancel Policy, Endr History/New, Premium Transaction, Follow up Report on the first row; Back, Continue, Premium Projection, EAC on the second.

### Endorsement Initiation Screen (separate window)

Window title "Endorsement Initiation Screen". Fields, in order, red asterisk on each mandatory one: Endorsement Quote Date with calendar; Type of Endorsement as a dual list box with `>` and `<` transfer buttons; Do You Want to have a Later Effective Date? (No); Endorsement Quote Instance Number (99999); Bizagi Case Id (NA); CARMA Grouping Key (NA); Requester Stake Code (Contract Owner); Requester Party; Endorsement Quote Required (Yes); Enforce Due to Occupation Change (No); Reason for initiating this action, a textarea.

The picklist must contain at minimum: Restart Regular Contribution, Change Payment Method, Waive Premium due to Contribution Protection Claim, Change Contribution Payer, Outright Cession, Add Security Cession, Remove Security Cession, Update Contracting Party Details, Change Correspondent, Change Payer Bank Account or Payroll Details, Bank Collection Cancellation Only, Payroll Collection Cancellation Only, **Change Adviser Details**, Change Primary IMED, Replace Sharing Intermediary, Remove Sharing Intermediary, Add Sharing Intermediary.

Change Adviser Details is the one the demo uses; the rest are there so the list looks real and the correct selection is a genuine choice.

### Basic Details

Two-column field grid.

Left: Waiver Number, Quote Instance Number, Distribution Channel, Sales Code, Broker External Reference, Quote Expiry Date, Nature of Contracting Party, Organization Name, Contracting Party First Name, Contracting Party Last Name, Legal Structure, Individual Identity Type, Minor, Savings Need, Policy Expiry Date, Income Payment Date, Amount deducted from contract value, Amount deducted from first regular contribution, Market Value, Net Estimated Refund Amount, Maturity Date, Net Yield Percentage.

Right: Admin Quote Status, Segment, Adviser Party Code, Sales Code Type, Quote Date, Currency, Contracting Party Code, Contracting Party Initials, Contracting Party Middle Name, Contracting Party Date of Birth, Organization Identity Type, Identity Type Number, Plan Type, Policy Start Date, Next Policy Anniversary Date, Amount deducted from each regular contribution, Amount deducted from lump sum and/or transfer amount, Investment Term in months, Outstanding ZIL Amount, Gross Yield Percentage.

Greyed-out fields are read-only in the real system; render them the same way. Below the grid: the Remuneration & Fee Details section with VAT Inclusive Asset Advice Fee, VAT Exclusive Asset Advice Fee and an effective date. SAVE sits below the fold so a scroll is genuinely required.

### Endr Quote Summary

Action bar: Create or Refresh Layer, Calculate Premium, End Sub Endorsement, Lock EBQ, Finalise Endorsement, with Back, Continue and Premium Projection alongside.

Collapsible sections, in order:

- **Commission Summary at Benefit Level for selected Commission Type** — Benefit Name, Type of Commission, Immediate Commission Percentage, Ongoing (AAW) Commission Percentage, Primary Upfront Commission Payable, Secondary Upfront Commission Payable, Commission Payable each time a Premium is paid, Commission Payable immediately, Commission Scaling percentage, Distribution Fee Scaling percentage.
- **EBQ Summary** — Endorsement Effective Date, Endorsement Type, Endorsement Quote Instance Number, Case id, CARMA Grouping Key, Requester Stake Code, Requester Code, Admin Quote, Waiver Number, Admin Quote Status, Total Endorsement Premium including Cashback, Total Endorsement Commission Amount, Endorsement Premium Refund Amount, Endorsement Clawback Commission Amount, Endorsement Premium Collection Amount, Bizagi EBA Case Id, CARMA UWR Grouping Key, Estimated CGT, MVA Fees.
- **EAC Details** — rows Investment, Advice, Admin, Other, EAC against columns Milestone 1 to Milestone 4.
- **Applicable Tax Class** — Product Name, Product Wrapper, Applicable Tax Class.
- **EBQ Fees Details** — Reduction fee, Transaction admin fee.

### Endorsement Quotes

Columns: Serial No (blue hyperlink), Endr Quotation Number, Type of Endorsement, Endr Effective Date, Endr Quote Status, Cooling Off Applicable, Cool off flag. Buttons Cool Off and Back.

### Errors

Rendered as a red band at the top of the content area with the code prefix intact, for example:

```
56000*****: This transaction cannot be processed as financial or Special Non-Financial transactions is already in progress.
```

---

## State machine and enforced rules

The policy header is the checkpoint Seek reads at every stage, so the status transitions have to be real and server-side.

| Trigger | Status | Sub Status |
| --- | --- | --- |
| Seeded | ACTIVE POLICY | Active |
| Endorsement type saved on the initiation screen | DRAFT ENDORSEMENT QUOTE | Sub-Endorsement Started |
| End Sub Endorsement | DRAFT ENDORSEMENT QUOTE | Sub-Endorsement End |
| Finalise Endorsement, then Submit | FINAL ENDORSEMENT QUOTE | Endorsement Submitted |
| Activate, by a different user | FINAL ENDORSEMENT QUOTE | Approve Endorsement Quote |
| Reject Endorsed Quote | REJECTED ENDORSEMENT QUOTE | — |

Rules the server must actually enforce. Each one exists because the demo needs to show Seek handling it, and a mock that always succeeds proves nothing.

**Maker-checker.** Activate returns an error if the current user is the one who submitted. The error must be visible and specific, not a silent no-op. This is the moment the demo hands back to the human.

**Transaction in progress.** Endorse/Alter on a policy that already has an open or future-dated finalised endorsement returns error 56000. The dataset must contain at least one such policy.

**VAT derivation.** VAT Exclusive Asset Advice Fee is calculated from VAT Inclusive, not entered. Writing 0 to inclusive must produce 0.000 in both after the page refresh. This is what Seek's read-back check verifies.

**Step ordering.** The Endr Quote Summary actions must be taken in sequence. Clicking Lock EBQ before Calculate Premium returns an error rather than proceeding, so the demo can show Seek following the SOP rather than firing clicks at a page.

**Submission validation.** Submit is rejected unless all five controls hold their required values. Legal Verification defaults to blank on some seeded policies so the Approve-if-blank branch gets exercised live.

---

## Dummy dataset — mirrored from the recording

Mirror the structure, the codes, the amounts and the statuses exactly. Replace only the person-identifying values — client names and the 13-digit South African ID numbers — with fictional ones of the same shape. Keep the ID numbers internally consistent, since the identity check turns on matching them between Bizagi and BaNCS.

### Entities

- **policy** — contract number, product name and code, owner name, owner ID number, status, start date, currency, branch, benefits
- **fee** — VAT inclusive asset advice fee, VAT exclusive (derived), effective date
- **adviser** — party code, sales code, name, type, segment, distribution channel, primary flag
- **endorsement** — policy, serial, quotation number, type, effective date, status, sub status, captured-by user, activated-by user
- **bizagi_case** — case reference, policy number, client ID number, transaction type, declaration signed date

### Environment constants

| Setting | Value |
| --- | --- |
| Batch Date | 03/08/2026 |
| System Date | 04/08/2026 |
| System Name | BaNCS_V11.0.3.4.72_071.ear |
| Capture user | SYS-ADMIN · HO · ENGLISH |
| Verifier user | PREM-ADM · HO · ENGLISH |
| Currency | South African Rand |

### Reference policy A — the fee-zeroing walkthrough

| Field | Value |
| --- | --- |
| Contract No. | 119900001001 |
| Quotation Number | 119900001/Q000025731666 |
| Product Name / BaNCS Product Code | OMS LISP Investment / OMSLISPI |
| Status / Sub Status | ACTIVE POLICY / Active |
| Contracting Party Code | BNCSGC-SYNTH00000001 |
| Contracting Party | fictional, initials NM, DOB 14/09/1986 |
| ID Number | fictional 13-digit, same value in the Bizagi case |
| Sales Code | 699001 |
| Adviser Party Code | BNCSMD-100199001 |
| Distribution Channel / Segment | Personal Finance SA |
| Policy Start Date | 04/08/2026 |
| Next Policy Anniversary Date | 30/01/2027 |
| Quote Expiry Date | 03/09/2026 |
| VAT Inclusive Asset Advice Fee | 0.575 |
| Amount deducted from each regular contribution | 10.35 |
| Total Endorsement Premium | 600.00 |
| Benefit / Type of Commission | LISP Investment Benefit / As and when - Full Term |
| Commission Scaling / Distribution Fee Scaling | 100.00 / 0.00 |
| Requester Stake Code | CON-OWNER |
| Endorsement Quote Instance Number | 99999 |

Seed policy A's endorsement history so the Endorsement Quotes list looks lived-in rather than empty on first open:

| Serial | Endr Quotation Number | Type of Endorsement | Effective Date | Status |
| --- | --- | --- | --- | --- |
| 1 | 1199000010010001 | Automatic Contribution Schedule Termination | 09/06/2026 | FINAL ENDORSEMENT QUOTE |
| 2 | 1199000010010002 | Change Adviser Details | 04/08/2026 | REJECTED ENDORSEMENT QUOTE |
| 3 | 1199000010010003 | Change Adviser Details | 04/08/2026 | REJECTED ENDORSEMENT QUOTE |

The serial the demo creates becomes 4. Two prior rejections on the same policy is true to the recording and makes the point that this is not a one-click process today.

### Bizagi queue rows

Mirror the columns of the work list seen in the recording: ContractNumber, BaNCS Product Code (OMSTFII or OMSLISPI), ProductCode (TFII or LISPI), IntermediaryCode, Product Instance (0), Comm Share (100), Total Commission.

Contract number shapes to follow: 110671307001, 112333103001, 112953094001, 113162231001, 113165622001. Intermediary codes in the 6xxxxx range — 694653, 657110, 631710, 631631, 630174. Total commission values spread between 0.19 and 100.69 so the list does not look generated.

Each Bizagi case also carries the client ID number and the date the declaration was signed, since both are read at pickup and used again at the identity check and at acceptance.

### Scenario spread

Around twenty policies, so a rehearsal does not exhaust the clean cases.

| Scenario | Count | Why it is there |
| --- | --- | --- |
| Single adviser, non-zero fee | 8 | The happy path. Vary the fee (0.575, 1.00, 1.15) so the demo does not look canned |
| Fee already 0.000 | 3 | Exercises the skip rule without raising an endorsement |
| Open or future-dated endorsement | 2 | Triggers error 56000. One dated 01/11/2026, as in the recording |
| ID number mismatch against the Bizagi case | 1 | The cross-system identity check |
| Legal Verification blank | 2 | Forces the Approve-if-blank branch during submission |
| Split commission, two or more advisers | 4 | Phase 2 only. Seed them now, build the screens later |

Use realistic South African data shapes — contract numbers in the BaNCS format, 13-digit ID numbers, South African Rand, product names from the real set (OMS LISP Investment, OMS TFI II). Names should be plausible and obviously fictional.

---

## Demo controls

Not features of BaNCS, but features of a demo that survives contact with an audience.

**Reset.** `POST /admin/reset` restores the seed. Bind it to a key or a hidden corner of the login page. You will use it between rehearsals and, at least once, mid-demo.

**Latency, configurable.** Calculate Premium and Create or Refresh Layer carry a delay — default around eight seconds, driven by an environment variable. Long enough that the audience feels what the team lives with and sees Seek sit through it; short enough that a live demo does not stall. Set it near zero while building.

**Two sessions, side by side.** The capturer and the verifier are different logins. Run them in two browser profiles so the maker-checker hand-off is visible on screen rather than explained. This is the single most persuasive moment in the demo — Seek completes everything, hits the wall the policy puts there, and a human clicks once.

---

## Acceptance checklist

The build is finished when a person can do all of this by hand, in order, without touching code or the database. If a step cannot be done manually, Seek cannot do it either.

### Main flow — switching off fees

- [ ] Open the Bizagi queue, open a case, read the Policy Number and ID Number off the Service Transaction tab
- [ ] Open BaNCS, log in as the capture user; header shows the user name and SYS-ADMIN
- [ ] Business Operations → Policy Servicing; paste the contract number into Contract No.; Search
- [ ] One result row returns, showing an ID number that matches the Bizagi case
- [ ] Click the blue contract hyperlink; policy header reads OMS LISP Investment / ACTIVE POLICY / Active
- [ ] Left nav → Basic Details; scroll; Remuneration & Fee Details shows 0.575 VAT inclusive and the derived VAT exclusive value
- [ ] Return to the action bar → Endorse/Alter; the Endorsement Initiation Screen opens in a separate window
- [ ] Select Change Adviser Details, move it across with the transfer button, Save; the window closes
- [ ] Policy header now reads DRAFT ENDORSEMENT QUOTE / Sub-Endorsement Started
- [ ] Left nav → Basic Details; set VAT Inclusive Asset Advice Fee to 0; scroll down; SAVE
- [ ] Page refreshes and both fee fields read 0.000
- [ ] Left nav → Acceptance; click the serial number hyperlink; select Yes; enter the declaration date; Save
- [ ] Left nav → Endr Quote Summary; Create or Refresh Layer, and the page visibly waits
- [ ] Calculate Premium, End Sub Endorsement, Lock EBQ, Finalise Endorsement, in that order
- [ ] Clicking Lock EBQ before Calculate Premium returns an error instead of proceeding
- [ ] Left nav → Endr Quote Submission; Admin Requirements Outstanding blank, Underwriting Requirements Outstanding blank, All admin requirements received Accepted, Reinsurance Verified Yes, Legal Verification Approved; Save; Submit
- [ ] Returned to the Endorsement Summary screen; status reads Endorsement Submitted
- [ ] Still as the capture user: Endorsement Quotes → the new serial → Endr Quote Submission → Activate returns a segregation-of-duties error
- [ ] Log in as the verifier in a second browser profile; header shows PREM-ADM
- [ ] Search the policy, re-check the ID number, open Endorsement Quotes, pick the serial for Change Adviser Details, Endr Quote Submission, Activate
- [ ] Status moves to Approve Endorsement Quote
- [ ] Re-open Basic Details; the fee still reads 0.000
- [ ] Call the reset endpoint; re-open Basic Details; the fee reads 0.575 again

### Negative paths

- [ ] A policy with a finalised endorsement effective 01/11/2026 returns the 56000 error on Endorse/Alter, as a red band with the code prefix intact
- [ ] A policy already at 0.000 can be opened and read without raising anything
- [ ] A policy whose ID number differs from its Bizagi case is visibly different on screen, so the check has something to fail on
- [ ] A policy seeded with Legal Verification blank requires Approve to be selected before Submit is accepted

---

## Build order

Each milestone leaves something runnable, so Seek configuration can start before the build finishes.

1. **Data service and seed.** Entities, seed file, reset endpoint, read and write API. Nothing visual yet.
2. **BaNCS shell and styling.** Top nav, welcome bar, left nav, policy header, stylesheet matched to the screenshots and to the chrome spec above. Get this right before building screens — every screen inherits it, and retrofitting fidelity later means touching every template.
3. **Search to policy.** Screens 2, 3 and 4.
4. **Endorsement initiation and Basic Details.** Screens 5 and 6, with the status transition and VAT derivation. This is the core of the PoC; once it works the demo exists.
5. **Acceptance, quote summary, submission.** Screens 9, 10 and 11, with step ordering and submission validation.
6. **Endorsement Quotes and maker-checker.** Screen 12, the second login, the Activate rule.
7. **Bizagi queue.** Screen 13. Small, and it opens the demo, so do not leave it until the morning of.
8. **Split commission.** Screens 7 and 8, plus the fee recalculation. **Out of PoC scope — do not build unless asked.**
9. **Demo controls.** Latency, reset binding, two browser profiles.
10. **Rehearse against reset.** Walk the acceptance checklist by hand from a clean seed, then run Seek against it three times end to end.

Steps 1 to 7, 9 and 10 are the PoC. Step 8 is phase 2 and sits outside it — the scope boundary table above governs. If the build lands early, rehearse more rather than adding scope.
