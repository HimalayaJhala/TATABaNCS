# Simulated BaNCS — Old Mutual Seek PoC

A simulated TCS BaNCS front-end and an Excel case work list, both built over one shared dummy dataset. Together they cover a single flow: **S&I 100% fee zeroing**, step for step as in the SAVINGS & INCOME – SWITCHING OFF FEES SOP. The original brief is in [docs/build-spec.md](docs/build-spec.md). The SOPs, as sent by Therlo Davids on 9 October 2026, are in [docs/sop/](docs/sop/).

## Run it

```sh
npm install
./scripts/setup-hosts.sh   # once, needs sudo: maps online.bancs.omapps.net to 127.0.0.1
npm run demo               # data-service + mail + BaNCS (npm run dev is the same command)
```

| Piece | Where | Stands in for |
| --- | --- | --- |
| Work list | `worklist/Split Fee Cases and Annuities Jul 2026.xlsx` | The team's Excel case list (S&I sheet) |
| `mail-sim` | http://localhost:4001/mail (Maker `?user=nzwane`, Checker `?user=dvisser`) | The Maker's and Checker's mailboxes |
| `bancs-sim` | http://online.bancs.omapps.net:4002/IIMS/ (or http://localhost:4002/login) | BaNCS IIMS open book. One login for both personas; the Checker lands on `/checker/home` and gets no latency or browser hang |
| `bancs-sim` (closed book) | http://localhost:4003/login, password `Closed@2026` | BaNCS IIMS closed book (`online.bancscb.omapps.net`) |
| Transition list | `worklist/Relationship Transition List Aug 2026-synthetic.xlsx` (and `.pdf`) | The PUF and CUF list: policies to move from one adviser to another |
| `data-service` | http://localhost:4000 | The BaNCS database. Single source of truth, no screens |

Logins (any password is accepted):

| User | Role | Use |
| --- | --- | --- |
| Nandi Zwane | SYS-ADMIN | **Maker** (capturer). Makes the fee zero. Seek drives this one |
| Daniel Visser | PREM-ADM | **Checker** (verifier). Verifies and activates ("must be completed by another person"). Lands on `/checker/home` after login |

The user list on the login page names them that way: "Nandi Zwane — Maker (SYS-ADMIN)" and "Daniel Visser — Checker (PREM-ADM)". Both use the same address and login page. After login the Maker lands on `/home` and the Checker on `/checker/home` (Home and the logo take each to their own); every other page has the same URL for both. Use a second browser profile to be logged in as both at once. The latency table and browser hang apply only to the Maker: the Checker's steps (search, Activate, and the rest) run at once. In the closed book the same user activates, so its latency still applies there.

## The email flow

The case starts in an email, not in BaNCS. Open the mailbox at http://localhost:4001/mail: Maker `?user=nzwane`, Checker `?user=dvisser`.

1. **Maker's inbox:** a case email from the team leader arrives with the work list attached (`Split Fee Cases and Annuities Jul 2026.xlsx`, downloadable). It names the contract to process, and gives the client, the **ID number** and the **declaration date** from the sheet, with a preview of the whole S&I sheet and the case row highlighted. One is already there after a reset, for policy `119900001001`.
2. The Maker logs in to BaNCS and does the SOP, reading the contract, ID and declaration date off the email.
3. **When the Maker clicks Submit,** a "Please verify" email arrives in the **Checker's** inbox with the quote number and the ID to check against.
4. The Checker verifies and activates. When they do, an "Approved" email, showing the fee now on the policy, arrives in the Maker's inbox.

The email data is read live, so it always agrees with BaNCS and the sheet. The hand-off emails (steps 3 and 4) are this build's addition to the SOP, to carry the work between the two people; remove them in `data-service/mail.js` if you do not want them. The mail pages carry the same Whatfix script and bank favicon.

## Loading and browser hang

**Loading state.** On a slow step the page behaves as in the recording. All the collapsible sections drop away, leaving the header band, a dotted-ring loader ("loading") at the far left under it, and the button row, which shows in the enabled blue with the last button blank. The left menu and breadcrumb stay, the cursor is the wait cursor, and the buttons can't be clicked. When the step finishes the full page comes back. The ring is built in CSS (12 grey dots stepping round), not an image.

**Browser hang (developer menu, one Yes/No per step, default No).** The latency table has a Browser hang column next to Normal and Stress, so every step (search, Endorse/Alter, the two Saves, the five quote-build steps, Submit, Activate) has its own switch. A step set to Yes freezes the page for its own **Hang time (s)**, which replaces that step's Normal/Stress wait (and applies even when the profile is Off). The page holds the request back, shows the loading state, runs a busy loop for that time with nothing else in flight (the same as freezing the thread from the console), and only then sends the request, so the server adds no wait of its own for that step: the page blocks its own main thread with a plain busy loop. Chrome itself then shows its native **Page Unresponsive** dialog with *Wait* and *Exit page*; nothing in the page draws it, as in your recording. Like in the recording, Chrome shows it about 15 seconds into the freeze and only once you click or type in the page, so it appears on the longer waits (Create or Refresh Layer is 30 s Normal, 90 s Stress). The freeze needs latency to be on; with the profile Off nothing hangs. Search and the other steps never freeze. Every frozen step still completes by itself, so there is nothing to retry; Seek must cope with the dialog.

I proved the freeze by measuring from inside the page (its main thread was blocked for 3,023 ms on a 3 s step and 52 ms with the switch off). I could not capture Chrome's own dialog here (no display access in the build environment), so please look at it once in your Chrome with Create or Refresh Layer at its default 30 s.

## The work list (Excel)

The workbook mirrors the "Split Fee Cases and Annuities Jul 2026" file shown in the 4 August 2026 recording:

- **Sheets:** OMEGA III, Annuities, OMEGA I, Flexcube and S&I. It opens on S&I; the other four sheets hold filler rows in their own shape.
- **S&I columns, as in the recording:** Assigned, Approver, ContractNumber, BaNCS Product Code, ProductCode, IntermediaryCode, Product Instance, Comm Share, Total Commission. Contract, intermediary and ID numbers are stored as text, as in the real sheet.
- **Two added columns, ID Number and Declaration Signed Date.** The SOP checks the ID number on the BaNCS search result and enters the declaration date at Acceptance. In the SOP both come from the Bizagi Service Transaction tab, so the work list now carries them.

`npm run worklist` rebuilds a clean copy, which clears anything typed into Assigned/Approver. `npm run demo` builds it if it is missing. Close the file in Excel before rebuilding it.

## Endr Quote Summary calculations

**Calculate Premium** works out the summary for real, in [data-service/calc.js](data-service/calc.js) (server side, like every rule). Until it runs, the calculated cells are blank; Create or Refresh Layer alone does not fill them. The method, as an administrator of a fee-change endorsement would do it:

1. **Fee.** The asset advice fee is a percentage a year of the market value, collected monthly on the policy's due date. Fee a year = market value × fee %, fee a month = that ÷ 12. VAT Exclusive = VAT Inclusive ÷ 1.15.
2. **Fee period.** Only the period the endorsement lands in is adjusted: previous due date (next due less one month) to next due date. Days left = next due date less the effective date, within that period; later periods simply use the new fee.
3. **Refund or collection.** The monthly fee difference × days left ÷ days in the period. A fee that falls is **refunded** to the client; a fee that rises is **collected**.
4. **Commission.** The adviser is paid the VAT-exclusive fee, as-and-when (so nothing on contributions). **Clawback** = refund ÷ 1.15 × scaling. **Total Endorsement Commission** = the new monthly fee ÷ 1.15 for the days left. **Ongoing (AAW) commission %** = the new VAT-exclusive fee. **Commission payable immediately** = minus the clawback.
5. **EAC (effective annual cost).** Monthly contributions are projected at the fund's gross growth with and without charges; EAC is the gap between the two annualised returns. The milestones are years 1, 5, 10 and the policy term (1, 3, 5 and the term for a 10-year policy); each header carries its year as a tooltip. Charges: **Investment** (fund charge), **Advice** (the VAT-inclusive fee after the endorsement), **Admin** (platform charge plus the initial charge on each contribution), **Other** (none). Because charges interact slightly, each is measured alone and scaled so the rows add up to the EAC.

Worked example, policy `119900001001`, fee 0.575 to 0: R4,323.48 × 0.575% = R24.86 a year, R2.07 a month; period 30/07 to 30/08/2026 (31 days) with 26 left; refund R1.74, clawback R1.51, premium R600.00 unchanged; EAC 4.57 / 1.89 / 1.53 / 1.35 at years 1 / 5 / 10 / 20.

- **Out of date.** A fee saved after Calculate Premium (or a new split) marks the figures out of date: the page says so, Calculate Premium opens again, and End Sub Endorsement is refused (`30411`) until it is recalculated. Basic Details locks at End Sub, so the premium you submit is always the one for the final fee.
- **Premium Calculation Basis.** A collapsed section under EBQ Fees Details shows every step above, so a reviewer can check each number. It is an addition to the BaNCS screen.
- **Assumptions to confirm with Old Mutual** (all on the workbook's Assumptions sheet, and in `ASSUMPTIONS` in `calc.js`): the fee is a yearly percentage of market value, collected monthly on the due date; fund charge 0.85% (LISP) and 0.70% (TFI II); platform charge 0.35%; initial charge 1.725% of each contribution (from the data: R10.35 off R600.00); no CGT or MVA on a fee change; the premium itself does not change.

## The calculation workbook

`worklist/Fee Switch-Off Calculations.xlsx` holds the numbers behind the SOP, on the same 26 synthetic policies, with live Excel formulas, so you can check what BaNCS should show at each step and what Seek should decide.

| Sheet | What it answers |
| --- | --- |
| **Fee Switch-Off** | Per policy: the VAT Inclusive fee now, its VAT Exclusive value, the rand a year and a month it costs the client, the new fee (default 0), and the saving a year. The total counts only the policies the process changes. |
| **Process Checks** | The SOP's decisions in order: ID number against the work list, error 56000, skip if the fee is already 0.000. It gives an **Expected outcome** (`PROCEED`, `SKIP` or `STOP`), the status path, the Legal Verification action (select Approved if blank) and the acceptance date to enter. |
| **Split Fee** | The split commission SOP: the new VAT Inclusive fee for the staying adviser's share. 0.575 at 50% gives 0.287 and 0.250 exclusive, as in the SOP; 60/40 gives 0.345 / 0.300. Change the yellow share cells to try others. |
| **Quote Summary** | What Calculate Premium shows: the fee refund (or collection), the adviser commission and the clawback, per policy, from the new fee on the Fee Switch-Off sheet. |
| **EAC** | The Effective Annual Cost at the four milestones by Investment, Advice, Admin and Other, with Excel `FV` and `RATE`. |
| **Latency Budget** | Seconds spent waiting in one full case (157 s Normal, 472 s Stress) and a suggested timeout per step, so a bot that gives up early can be spotted. |

Blue figures are inputs, yellow cells can be changed, black figures are formulas. VAT Exclusive is VAT Inclusive ÷ 1.15, and each ROUND carries a `+1E-9` guard so binary noise cannot flip an exact half (84,450 × 1.15% is exactly 971.175 and shows 971.18).

**One assumption to confirm with Old Mutual:** the rand columns treat the asset advice fee as a percentage *a year* of the market value. If it is charged differently, only the rand columns change; the percentages and the process decisions do not.

It is checked two ways. `npm run test:sheet` runs against the live app: every fee, every expected outcome (56000, ID mismatch, skip), the "after" figures for each of the 20 policies the process changes, and each Split Fee row saved through the app's own split rules (621 checks), including Calculate Premium in the app against the Quote Summary and EAC sheets for every policy that can be endorsed. Separately, all 4,054 formula cells were recalculated with an independent spreadsheet engine and agree with the stored results. Regenerate it with `npm run calcsheet` (`npm run reset` does this too); close it in Excel first.

## Demo controls

**The developer menu.** The login page is clean: just the login form and a small **bug icon** at the top right (where the logout icon sits once you are logged in; if you visit the login page while logged in, the bug sits beside it). Click the bug to open the developer menu, which holds **Reset data**, **Dummy data** (download the synthetic work list and the Relationship Transition List as Excel or PDF), the **latency profile**, the **Browser hang** switch and the **latency table**. Click it again, press Esc, or click anywhere outside to close it. It exists on the login page only; no other screen has it. In your flows its button is `#btn-dev-menu`, the menu is `#demo-controls` and it stays hidden until the button is used.


- **Reset data** — the **Reset data** button in the developer menu (the bug icon on the login page; it asks you to confirm). The demo saves every change you make, so use it to start again. It puts the BaNCS data back to the start and keeps the latency table. **Ctrl+Alt+R** on any BaNCS page does the same, and `npm run reset` also rebuilds the Excel work list. The seed file itself is never written to.
- **Latency** — a per-step table in the same developer menu, closed until you open it, and nowhere else. See "Latency" below.
- **Whatfix** — the embed script is in the head of every BaNCS page (login, home, search, every policy screen and dialog), so your DAP flows run on the site. It lives in [bancs-sim/views/partials/whatfix.ejs](bancs-sim/views/partials/whatfix.ejs); delete the `include('whatfix')` line in `partials/top.ejs` to turn it off. Because Chrome waits for async scripts before it fires the page-load event, the automated tests block the `whatfix.com` hosts (including `cdn.whatfix.com`) so their timings stay exact.
- **State** — the live data is kept in `data-service/data/state.json`, so a restart mid-demo resumes where it left off.
- **Logins survive a restart** — sessions are saved to `bancs-sim/data/sessions.json` and last 12 hours, so restarting the demo does not log anyone out. If the data is reset while someone is mid-flow, they stay logged in and simply lose the open endorsement. To force everyone out, delete that file or use the power icon.

## Test

With the demo running, `npm run test:sheet` checks the calculation workbook against the app. `npm test` resets the data and walks the fee-zeroing SOP end to end in headless Chrome. `npm run test:split` does the same for the split commission SOP, and `npm run test:forms` checks the dropdowns, calculations and latency. Each test turns latency off through the login page, as a person would, and puts the whole table back at the end; the forms test also times every step against an edited table. It takes the case from the workbook, captures as SYS-ADMIN, and verifies and activates as PREM-ADM in a separate session. It then runs the negative paths. Screenshots go to `test-output/`. Set `CHROME_PATH` if Chrome is not in `/Applications`.

## The flow, as the SOP has it

**Capture (SYS-ADMIN):**
1. Business Operation → Policy Servicing.
2. Paste ContractNumber into Contract No. → Search.
3. Check that the ID No. matches the work list → click the blue contract number.
4. Endorse/Alter. The Endorsement Initiation Screen opens as a modal over the policy screen, in the same tab (URL `/policy/<contract>/endorse`).
5. Select **Change Advisor Details**, click `>`, then Save. The modal closes and you are back on Policy Action Details, where the header reads DRAFT ENDORSEMENT QUOTE / Sub-Endorsement Started.
6. Basic Details → scroll to Remuneration And Fee Details → VAT Inclusive Asset Advice Fee = 0 → scroll down → Save. Both fees now read **0.000**.
7. Acceptance → serial **1** (Acceptance Details modal, URL `/policy/<contract>/acceptance/1`) → Yes, and the declaration date → Save. You return to the Acceptance list, now showing Yes and the date.
8. Endr Quote Summary → scroll down, then click Create or Refresh Layer, Calculate Premium, End Sub Endorsement, Lock EBQ and Finalise Endorsement in turn. The bar sits under the summary tables, and **only the next step is enabled**; the others are greyed, as in the SOP screenshots.
   If you are unsure which button comes next, hover a greyed one: the tooltip names the next step (for example "Not available yet. Next step: Lock EBQ"). The header's **Sub Status** also tells you where you are: Sub-Endorsement Started → Sub-Endorsement End → Endorsement Quote Locked → Endorsement Submission Pending. A step clicked twice, or too early, shows an error that names the step to take next (`30404`, `30410`).
9. Endr Quote Submission:
   - Admin Requirements Outstanding: blank
   - Underwriting Requirements Outstanding: blank
   - All admin requirements received: Accepted
   - Reinsurance Verified: Yes
   - Legal Verification: Approved, if it isn't already
   - Save, then Submit. You return to the Endorsement Summary, at FINAL ENDORSEMENT QUOTE / Endorsement Submitted.

**Verification (PREM-ADM):**
1. Search the policy and re-check the ID.
2. Endorsement Quotes → the "Change Advisor Details" serial.
3. Endr Quote Submission → Activate. The status becomes **Approved Endorsed Quote**.

## Split commission flow (Advisor Change)

The SAVINGS & INCOME – SWITCHING OFF FEES – SPLIT COMMISSION SOP ([docs/sop/](docs/sop/), screenshots in [reference/split-sop/](reference/split-sop/)) is built as well. It follows the first SOP up to Endorse/Alter, then:

1. Left menu → **Advisor Change** (only on a Change Advisor Details endorsement). The screen has three Details buttons, and Save, Back and Continue.
2. **Edit Contribution Remuneration Sharing → Details** opens a modal over the screen. The current adviser appears greyed (Latest Indicator OLD).
3. **Add** shows a blank record: Sale Event, Advisor Code, Primary Adviser, the four share columns, and Latest Indicator NEW. Fill in each adviser, then Save. **Delete** removes the ticked records, and Close leaves without saving.
4. **Edit Asset Remuneration Sharing → Details** works the same way, with its own columns.
5. **Save** on the Advisor Change screen commits what the two dialogs staged. Finalise is refused (`30408`) until you do this.
6. **Basic Details** → set VAT Inclusive Asset Advice Fee to the new percentage → Save. It is already filled in from the split (50/50 of `0.575` gives `0.287`, with `0.250` exclusive, as in the SOP; 60/40 gives `0.345`). See "The fee follows the split" below.
7. Acceptance, Endr Quote Summary and Endr Quote Submission run as in the first SOP. Calculate Premium checks the fee from step 6 (see below). On Activate, the committed split replaces the policy's advisers. Check it under Adviser Info.

Rules in the dialog: Advisor Code and Primary Adviser are mandatory; exactly one primary adviser; no adviser twice; every filled share column adds up to 100.00 (`56303`–`56309`). Run it with `npm run test:split`.

Use `119900001001` as in the screenshots (THELMA RIKHOTSO at 100%, new adviser SANDILE MKHIZE). Edit Contribution Remuneration Percentage is shown, but it isn't part of either SOP, so it only shows an info message.

## Latency

The waits in the recording cluster on the quote build, which is where the team's existing bot gives up. The demo reproduces them step by step, so Seek has to wait each one out rather than retry.

**Where it is set.** In the developer menu on the login page (the bug icon at the top right), before anyone logs in: choose the **Active profile** (*Off*, *Normal* or *Stress*), edit any figure in the table, then **Apply**. **Restore table defaults** brings the recording's figures back. The settings are kept across restarts and are not touched by a data reset; log out to reach the page again.

**Where it happens.** On the server. The delay runs in `data-service`, inside the very request the browser is waiting on, and only after the step's own checks pass, so a rejected action (an error, 56000, a failed validation) comes back at once. The front end only shows a loader while it waits; it cannot skip, shorten or retry the wait, and every wait ends in success on its own.

| Step | Observed in the recording | Normal | Stress |
| --- | --- | --- | --- |
| Policy search → results | A few seconds | 2 s | 6 s |
| Endorse/Alter → initiation screen opens | Short | 3 s | 10 s |
| Save on the initiation screen | Noticeable | 5 s | 15 s |
| Basic Details SAVE | Noticeable | 5 s | 15 s |
| Create or Refresh Layer | The longest single wait, around a minute and a half | 30 s | 90 s |
| Calculate Premium | Around forty seconds | 25 s | 75 s |
| End Sub Endorsement | Around half a minute | 10 s | 30 s |
| Lock EBQ | Over a minute | 20 s | 60 s |
| Finalise Endorsement | Noticeable | 15 s | 45 s |
| Endr Quote Submission → Submit | Around half a minute | 20 s | 60 s |
| Activate, verifier side | Around half a minute | 20 s | 60 s |

Save on the Acceptance screen and the other saves not in this table have no wait. A full run spends about two and a half minutes waiting on Normal, and almost eight on Stress.

## Dropdowns and calculations

**Quote/Contract Search** (`npm run test:forms` checks all of this)
- **Parameter** sets how Contract No., Quote No. and ID No. are matched: *Exact match* (the default for Contract No. and ID No.), *Starts with*, *Contains*. A `%` anywhere is a wildcard, as in the SOP screenshot (`1144932%`).
- **Status** matches the policy's status or any of its endorsement quotes, so DRAFT, FINAL and REJECTED ENDORSEMENT QUOTE find the right policies.
- **Branch Code** (ALL or HO) filters, and **Party Stake Name** is accepted for owner, payer and life assured, which are the same person on every dummy policy. All dropdowns keep their selection after Search.

**Endorsement Initiation modal**
- **Do You Want to have a Later Effective Date? = Yes** reveals a *Later Effective Date* field. The date is mandatory (`56102`) and must be after the system date (`56105`), and it becomes the endorsement's effective date in Endorsement Quotes. A future-dated quote then also blocks a new Endorse/Alter (`56000`), as in the business rules.
- **Requester Party** follows **Requester Stake Code**: Contract Owner and Contribution Payer list the client; Adviser lists the policy's advisers.

**Basic Details**
- Segment, Distribution Channel, Sales Code Type, Currency, Savings Need, Admin Quote, Reason for Investing, Trustee Endorsed and Rider Commission Applicable are read-only in BaNCS, so they are greyed out and disabled.
- **Amend Pot Percentage Reason** (Customer request, Error correction, Change of adviser, Regulatory requirement), **No Dealings** and **Remove Reason** are editable. They are saved with the fee and shown after the refresh, and written to the policy on Activate.

**Endr Quote Submission** (the SOP's five dropdowns)
- Fillable as soon as the quote is open, not only after Finalise. Save works from the draft stage, and the choices carry through to Finalise. **Submit** stays greyed out until the endorsement is finalised. Once submitted, the form locks, apart from Save, Reject and Activate.
- Each dropdown offers the SOP value, and a tooltip on the field repeats the SOP instruction:

  | Field | Options | SOP value |
  | --- | --- | --- |
  | Admin Requirements Outstanding | (blank), Yes, No | blank |
  | Underwriting Requirements Outstanding | (blank), Yes, No | blank |
  | All admin requirements received | (blank), Accepted, Pending, Rejected, Yes, No | Accepted |
  | Reinsurance Verified | (blank), No, Yes | Yes |
  | Legal Verification | (blank), Approved, Pending, Rejected | Approved |

- **All Contracting Parties have accepted the application** is greyed out and always follows the Acceptance screen (Yes once the acceptance is saved as Yes).
- Submit refuses, listing every control that is wrong (`48120`).

**Calculations**
- **VAT Exclusive = VAT Inclusive ÷ 1.15**, 3 decimals, after Save.
- **Split commission:** each share column must add up to 100.00, with exactly one primary adviser.
- **The fee follows the split, and the system works it out.** The SOP says the client's fee has to be adjusted "for the remaining adviser to receive the same fees". The build reads that as *new VAT Inclusive fee = current fee × the remaining adviser's asset advice fee share*, rounded down to 3 decimals. The SOP's figures fit: at 50%, 0.575 becomes 0.287, and 0.250 exclusive. **When you click Save on Advisor Change, the fee is calculated and staged**, so Basic Details already shows it (a 60/40 split gives 0.345 / 0.300). Click Save there as the SOP says, or type a different value. A fee that doesn't match is refused at **Calculate Premium** and **End Sub Endorsement** (`30409`). The error names the exact number to enter, and Basic Details is still open at that point, so you can correct it and carry on. These are the last points where the fee can still be changed. The remaining adviser is the policy's current primary adviser if still on the new split, otherwise the new primary. This is the one place the build adds a check BaNCS itself may not make; to relax it, edit `expectedSplitFee` in [data-service/rules.js](data-service/rules.js).

## The demo policy

| | |
| --- | --- |
| Work list row | S&I sheet, row 2 |
| Contract No. | `119900001001` (OMS LISP Investment) |
| Quotation No. | `119900001/Q000025731666` |
| Client | NOKUTHULA JANE MAHLOBO (fictional), ID `8609144417086`, declaration signed 04/08/2026 |
| Fee | 0.575 VAT inclusive → 0.500 VAT exclusive (an advice fee of 0.50% a year, ex-VAT) |
| Contribution | R600.00 a month, of which R10.35 is deducted (1.725%) |
| Endorsement history | none at the start: Endorsement Quotes is empty until a run creates serial 1 (the same for every contract on the dummy work list) |

## Opening screens

The first screens follow the SOP screenshots and the recording:

- **Home.** SYS-ADMIN sees three tiles (Accounting, Business Operation, Re-insurance), as in the recording; other roles see two (Business Operation, Re-insurance), as in the SOP. The tiles sit at the same places across the page as in the screenshots.
- **Quote/Contract Search.** Label edges, input widths and the Product row (two inputs and the lookup button on one line) are laid out as in the SOP. The right-hand labels such as "ID No./Passport No./Registration No." stay on one line. The Tip line sits under the Search, Clear and Back buttons.
- **Search results.** Cover Amount has thousands separators (`1,500,000.00`), and an empty Endr Date shows `-`, as in the SOP.
- **Policy Action Details.** One bordered header box, then the SOP's two button rows. EAC shows only for LISP policies, as in the recording; the SOP's OMP Life screenshot has none.

## Test data: 26 policies for the fee-switch-off SOP

The data hangs together, so a person (or Seek) can check one number against another:

- **Fees** are entered ex-VAT at realistic advice-fee levels (0.30% to 1.50% a year) and shown VAT-inclusive (× 1.15); VAT-exclusive is always inclusive ÷ 1.15, as BaNCS shows it.
- **Contributions** run from R600 to R5,000 a month. TFI II stays within the R3,000 a month tax-free limit. The amount deducted from each regular contribution is 1.725% of the contribution (policy A: R600.00 → 10.35, as in the recording).
- **Market Value, Maturity Date and the yields** follow from the start date, the term and the contributions paid to the system date (04/08/2026). Next Policy Anniversary and Next Due Date are worked out from the start date.
- **Advisers**: twelve, each with one party code that is the same on every policy. Brokers and tied advisers use different distribution channels.
- **Quote numbers**, contract numbers (`11xxxxxxx001`), 13-digit ID numbers (valid check digit, date of birth and gender match) and the Excel work list all come from the same seed. Several policies carry an earlier, already approved endorsement, so Endorsement Quotes is not empty on first open.

Run `npm run seed` then `npm run worklist` to regenerate; `npm run reset` restores the data.

### Happy path: single adviser, non-zero fee (14)

| Contract No. | Product | Client | Monthly contribution | Fee incl. / excl. VAT | Adviser |
| --- | --- | --- | --- | --- | --- |
| 119900001001 | LISPI | Mbalenhle Ndlovu | R600 | 0.575 / 0.500 | Thelma Rikhotso |
| 110671307001 | TFII | Sipho Khumalo | R2,500 | 1.150 / 1.000 | Sandile Mkhize |
| 112333103001 | LISPI | Thandeka Zulu | R1,200 | 0.863 / 0.750 | Annelie Du Toit |
| 112953094001 | TFII | Riaan Steyn | R3,000 | 0.575 / 0.500 | Rajesh Govender |
| 113162231001 | LISPI | Ayesha Patel | R4,500 | 1.438 / 1.250 | Linda Nkosi |
| 113165622001 | LISPI | Kagiso Molefe | R1,500 | 1.150 / 1.000 | Mark Jacobs |
| 113402518001 | TFII | Charlene Adams | R1,000 | 0.690 / 0.600 | Sandile Mkhize |
| 113577840001 | LISPI | Bongani Mahlangu | R2,000 | 1.035 / 0.900 | Annelie Du Toit |
| 111890254001 | LISPI | Fatima Osman | R2,800 | 0.460 / 0.400 | Priya Nair |
| 112045877001 | TFII | Itumeleng Sello | R1,800 | 0.920 / 0.800 | Johan Van Der Merwe |
| 112476310001 | LISPI | Chantel Van Wyk | R3,500 | 1.725 / 1.500 | Lerato Mokgosi |
| 112718459001 | TFII | Mpho Dlamini | R600 | 0.345 / 0.300 | Thelma Rikhotso |
| 113084721001 | LISPI | Nomvula Tshabalala | R5,000 | 0.805 / 0.700 | Sandile Mkhize |
| 113290536001 | LISPI | Deon Bekker | R2,200 | 1.265 / 1.100 | Mark Jacobs |

### Fee already 0.000: the skip rule (3)

| Contract No. | Product | Client | Monthly contribution | Fee incl. / excl. VAT | Adviser |
| --- | --- | --- | --- | --- | --- |
| 113690412001 | LISPI | Naledi Mokoena | R1,400 | 0.000 / 0.000 | Rajesh Govender |
| 113712955001 | TFII | Werner Coetzee | R2,100 | 0.000 / 0.000 | Linda Nkosi |
| 113845106001 | LISPI | Zanele Dube | R3,200 | 0.000 / 0.000 | Mark Jacobs |

### Exceptions

| Contract No. | Scenario |
| --- | --- |
| 113901377001 | Finalised endorsement effective 01/11/2026, so Endorse/Alter returns **56000** |
| 114020658001 | Open draft endorsement, so Endorse/Alter returns **56000** |
| 114137290001 | The ID number in the work list differs from BaNCS (the identity check should fail) |
| 114250817001, 114318964001 | Legal Verification defaults blank, so Approved has to be chosen before Submit |

### Split commission, two or three advisers (4)

| Contract No. | Product | Client | Monthly contribution | Fee incl. / excl. VAT | Adviser |
| --- | --- | --- | --- | --- | --- |
| 114561023001 | LISPI | Busisiwe Mthembu | R3,000 | 1.150 / 1.000 | Mark Jacobs 60% / Themba Sibiya 40% |
| 114602745001 | TFII | Andre Du Plessis | R2,000 | 1.150 / 1.000 | Sandile Mkhize 50% / Karen Botes 50% |
| 114688139001 | LISPI | Palesa Radebe | R1,800 | 0.575 / 0.500 | Annelie Du Toit 50% / Yusuf Ebrahim 30% / Themba Sibiya 20% |
| 114723506001 | LISPI | Ruben Pillay | R2,400 | 1.150 / 1.000 | Rajesh Govender 80% / Karen Botes 20% |

## Enforced rules (all in [data-service/rules.js](data-service/rules.js))

| Rule | Error |
| --- | --- |
| Endorse/Alter while an endorsement is open, submitted-but-not-activated, or finalised with a future effective date | `56000` |
| Endr Quote Summary step out of order (greyed in the UI; also refused if posted directly) | `30401`–`30405` |
| Finalise before contracting-party acceptance is captured | `30407` |
| Fee change outside an endorsement, or after End Sub Endorsement | `56010` / `56011` |
| Submit unless the five SOP controls hold their required values | `48120` (lists each failing control) |
| Activate by the user who submitted | `71035` (segregation of duties) |

VAT exclusive is always derived: inclusive ÷ 1.15. Activation writes the endorsement's fee onto the policy.

**Submission defaults** follow the recording: Reinsurance Verified = No, All admin requirements received = Yes, Legal Verification = Approved (blank on the two legal-blank policies). So Seek has to set at least two controls on every run.

**Date fields open a calendar** (Acceptance Date, Endorsement Quote Date, search Date From/To, the Submission dates): click the field or its calendar icon, pick a day, and it fills in as DD/MM/YYYY. Typing a full valid date also works, and Esc closes it. **On Endr Quote Summary the action buttons stay pinned to the bottom of the screen**, so every step is in view without scrolling; the SOP's "scroll down" is not needed.

Successful saves and steps show no message; the page just refreshes, as in the SOP screenshots. Only errors render, in the pale-yellow band with the code prefix intact (`56000*****: …`).

## Navigation and context

The URL always names the contract. The session remembers whether you are looking at the **policy** or at an **endorsement** of it, just as BaNCS does:

- Saving the Endorsement Initiation Screen, or clicking a serial in Endorsement Quotes, puts that endorsement in context. The header then shows the endorsement quotation number, its status, and a blue **Parent Policy Number** link.
- Opening the policy from search results, clicking the Parent Policy Number link, or opening Endorsement Quotes returns to the policy context.
- **The left menu** comes from [bancs-sim/nav.js](bancs-sim/nav.js) and follows the SOP screenshots:
  - **Where it is.** On every policy screen, including the dialogs that open over them (Endorsement Initiation, Acceptance Details, the sharing tables). It is not on the login page, the home page, search or the search results, as in the SOP. On a short window it scrolls so the highlighted item is always in view.
  - **On the policy view** (for example Endorsement Quotes): Contracting Party … Policy Action Details, Acceptance, Requestor Advisor Info, Adviser Info, Layer Info, Endorsement Quotes. No Endr Quote Summary, Endr Quote Submission or Advisor Change. Nothing is greyed.
  - **Once an endorsement is open:** Endr Quote Summary, Policy Action Details and Endr Quote Submission appear, and **Advisor Change** and Layer Info follow Adviser Info. Advisor Change only appears for a Change Advisor Details endorsement.
  - **Grey items are the sections the endorsement type works on**, not pages you have visited. For Change Advisor Details they are Basic Details, Adviser Info and Advisor Change; every other item is plain. For Change Payment Method it is Payment Cycle. The highlighted (blue) item is the screen you are on.
  - It depends on product (LISP or TFI II). Items without a built screen open a generic section page.

**The 56000 page has its own URL**, so a DAP flow can branch on it: **`/policy/<contract no.>/error/already-exist`**, for example `http://localhost:4002/policy/119900001001/error/already-exist`. Endorse/Alter sends you there whenever it returns 56000, whether from the button or from opening the `/endorse` address directly. In a DAP URL rule use `*/policy/*/error/already-exist`. On that page `<body>` carries `data-screen="error-already-exist"`, the screen block is `#screen-error-already-exist`, the message is `#error-message` and the explanation is `#error-hint` with its link `#link-error-hint`. The page is built from the policy's live state, so a refresh shows the same thing, and if the policy is no longer blocked the URL goes straight back to the policy. It is a normal 200 page, like the real BaNCS error screens.

**Why Endorse/Alter can return 56000.** Only one endorsement can be in progress on a policy. A second Endorse/Alter is refused while the first is an open draft, submitted but not yet activated, or approved with an effective date still in the future. The error text is the BaNCS one, unchanged; under it a hint names the blocking quote, says what state it is in, and links to Endorsement Quotes. To carry on, open the blocking quote from Endorsement Quotes (click its serial), or cancel it with **Reject Endorsed Quote**, or use **Reset data**.

## Parent blocks, for DAP flows

Every control sits inside a parent `div` with its own stable `id` and a `data-block` attribute. When you build a DAP flow you can pick the control itself, or its whole block: the field with its label, the section, the grid, the button bar, the dialog.

```
body[data-screen]
└─ #page [page]
   ├─ #region-header [header]            logo, user, role, dates
   ├─ #top-navigation [top-navigation]   module tabs
   ├─ #region-subbar [sub-navigation]
   ├─ #left-nav [left-navigation]
   ├─ #content [content]
   │  └─ #screen-<name> [screen]         e.g. #screen-basic-details, #screen-quote-summary
   │     ├─ #block-messages [messages]   #error-band / #info-band
   │     ├─ #policy-header [policy-header]
   │     ├─ #sec-<name> [section]        a collapsible section
   │     │  └─ #body-<name> [section-body]
   │     │     ├─ #fields-<name>         the field grid
   │     │     │  └─ #field-<id> [field]            label + required mark + control
   │     │     │     └─ #control-<id> [field-control]
   │     │     │        └─ the input / select / textarea, id = <id>
   │     │     └─ #grid-<name> [grid]    a table; its rows keep their own ids
   │     ├─ #bar-<name> [button-bar]     e.g. #bar-submission-actions, #endorsement-action-bar
   │     │  └─ the buttons, each with its own #btn-... id
   │     └─ #endorse-modal [modal]       also #acceptance-modal, #sharing-modal
   │        ├─ #...-modal-header [modal-header]
   │        └─ #...-modal-body [modal-body]
   └─ #region-footer [footer]
```

- **Field blocks are named after the control.** The control `#all-admin-requirements-received` sits in `#control-all-admin-requirements-received`, inside `#field-all-admin-requirements-received`. Select the field block to take the label and the dropdown together.
- **Ids never depend on position.** Block ids come from the control's id, so they do not shift when a screen gains or loses a field.
- **Every block has `data-block`** with one of: `page, header, top-navigation, sub-navigation, left-navigation, content, screen, messages, policy-header, section, section-body, field, field-control, grid, button-bar, action-bar, modal-overlay, modal, modal-header, modal-body, form-frame, dual-list, module-tiles, demo-controls, footer`. Fields also carry `data-field="<id>"`, and the page carries `data-screen="<name>"`.
- **Examples:** `#field-vat-inclusive-asset-advice-fee` (the fee with its label), `#sec-remuneration-fee-details` (the whole section), `#bar-submission-actions` (Save and Submit), `#endorse-modal` (the whole Endorsement Initiation dialog), `[data-block=field][data-field=legal-verification]`.
- `npm run audit:blocks` walks every screen and fails if a control is not inside a field block, or a section, grid, bar or dialog is missing its block. It runs against the live demo.

## Element IDs for Seek

The IDs are hand-written and stable. The main ones:

- **Search:** `#contract-no`, `#id-no`, `#btn-search`, `#result-link-<contract>`, `#result-id-<contract>`
- **Header:** `#hdr-product-name`, `#hdr-quotation-number`, `#hdr-status`, `#hdr-policy-number`, `#hdr-sub-status`
- **Errors:** `#error-band` / `#error-message`
- **Left nav:** `#nav-<slug>`, e.g. `#nav-basic-details`, `#nav-endr-quote-summary`
- **Policy action bar:** `#btn-endorse-alter` and the other `#btn-*` buttons
- **Endorsement modal:** `#endorse-modal`, `#endorsement-types-available`, `#btn-move-right`, `#endorsement-types-selected`, `#btn-save`, `#btn-endorse-back`, `#btn-modal-close`. Errors inside it use `#modal-error-message`.
- **Basic Details:** `#vat-inclusive-asset-advice-fee`, `#vat-exclusive-asset-advice-fee`, `#btn-save` (below the fold)
- **Acceptance:** `#acceptance-serial-1` (opens the modal `#acceptance-modal`), then `#application-accepted`, `#acceptance-date`, `#btn-save`, `#btn-acceptance-back`
- **Endr Quote Summary:** `#endorsement-action-bar`, containing `#btn-create-refresh-layer`, `#btn-calculate-premium`, `#btn-end-sub-endorsement`, `#btn-lock-ebq` and `#btn-finalise-endorsement`. A greyed button carries `disabled`.
- **Submission:** `#admin-requirements-outstanding`, `#underwriting-requirements-outstanding`, `#all-admin-requirements-received`, `#reinsurance-verified`, `#legal-verification`, `#btn-save`, `#btn-submit`, `#btn-activate`
- **Endorsement Quotes:** `#endr-serial-<n>`, `#endr-row-<n>`
- **Advisor Change:** `#btn-edit-contribution-sharing`, `#btn-edit-asset-sharing`, `#btn-save`. In the dialog: `#sharing-modal`, `#btn-share-add`, `#btn-share-delete`, `#btn-share-save`, `#btn-share-close`, and per new row `#share-advisor-<i>`, `#share-primary-<i>`, `#share-<i>-<k>` (k = share column, from 0).

## Where the build differs from the brief

These follow the SOP screenshots and the recording, because Seek ultimately has to drive the real system:

1. **The work list replaces Bizagi.** The case comes from the Excel S&I sheet, and the Bizagi app has been removed. BaNCS's own "Bizagi Case Id" field on the Endorsement Initiation Screen stays at `NA`, as in the SOP.
2. **"Change Advisor Details"** is the spelling in the picklist and the endorsement tables (SOP screenshots). The SOP text and the brief say "Adviser".
3. **"Approved Endorsed Quote"** is the sub status after Activate (SOP screenshot 25). The SOP text says "Approve Endorsement Quote".
4. **Step ordering is enforced by greying out buttons**, as BaNCS does, rather than by an error after the click. The server still refuses an out-of-order step.
5. **Intermediate sub statuses** come from the recording and the SOP: "Endorsement Quote Locked" after Lock EBQ, and FINAL ENDORSEMENT QUOTE / "Endorsement Submission Pending" after Finalise.
6. **The Endorsement Initiation Screen and Acceptance Details are in-page modals**, not browser windows, so there is nothing to switch to or to unblock. (The SOP shows them as pop-ups.)
7. **Distribution Channel** is "Personal Finance Advice SA", and **Policy Start Date** is 30/01/2026. Both are read off the recording.

## Not built

- **No real logic behind** Cancel Policy, Premium Transaction, EAC, Premium Projection, Cool Off, Start Sub Endorsement, Reject Sub Alteration, Endorsement Detail and Follow-up Report. They show an info message.
- **Reference images:** frames from the recording are in [reference/](reference/), and the SOP screenshots are in [reference/sop/](reference/sop/), numbered in SOP order. Both show real client names and ID numbers, so keep them internal.

## Developer menu: dummy data

**Dummy data** downloads `worklist/Split Fee Cases and Annuities Aug 2026-synthetic.xlsx` (Download Excel) or the same as a PDF (Download PDF). It is the S&I tab only, with four contracts, and it is synthetic: no real client names, ID numbers, contracts or adviser codes. Rows 1, 3 and 4 (119900001001, 110671307001, 112333103001) are the normal flow: the fee is switched off to 0, then Submit and Checker Activate. Row 2 (102790002001) is lapsed: Endorse/Alter gives 56020 and nothing is changed. Status and Summary are blank for the run to fill in.

## Loading state

While a step loads, the screen keeps its layout: the sections go blank in place, the loading ring sits over them, and every button stays where it was, with its own enabled or disabled look. Nothing moves, so a flow can find the next button where it expects it.

## Checker (Verification Steps in the SOP)

Log in as the Checker (dvisser), who lands on `/checker/home`, then, as the SOP lists them: Policy Servicing > Contract No. > Search > the blue policy number > **Endorsement Quotes** > the serial for "Change Advisor Details" > **Endr Quote Submission** (sub status Endorsement Submitted) > **Activate**. The screen returns to Endr Quote Summary with sub status Approved Endorsed Quote. Endr Quote Submission shows Save, Reject and Activate once the Maker has submitted; after Activate or Reject the three stay in place, disabled.

## Relationship Transition List and the closed book

The edge case from about 38 min of the 4 August 2026 recording: the team receives a **Relationship Transition List** ("PUF and CUF") of policy numbers to move from one adviser (IMED_CODE_FROM) to another (IMED_CODE_TO). The list does not say which BaNCS a policy is in. Some are in the **open book**, and some are in the **closed book**, a second BaNCS with its own link, login and policies (`online.bancscb.omapps.net`, system `BaNCS_V11.0.3.3.16_019.ear`).

**The closed book** runs alongside the open one on http://localhost:4003. The changes from the open book are:
- **Login:** it has its own password, `Closed@2026`. Any other password gives `Invalid username/password; logon denied`, as when the open-book login was tried in the recording.
- **Deep links:** a page opened without logging in returns **401 Unauthorized**.
- **Search:** it is called "Quote/Contract/Voucher Search" and shows `No Result Found` when nothing matches.
- **Contract numbers:** one per benefit, `13394001/LSD/1`, `13394001/LSD/2`. Search with a wildcard (`13394001%`) to get all of a policy's benefits, and move each one separately.
- **Separate policies:** each book only finds its own policies. Opening the other book's policy gives 20001.
- **No second person:** the same user submits and activates; there are no Checker emails.

**The move (Change Primary IMED)**, the same in both books:
1. **Open the quote:** Policy Action Details → **Endorse/Alter** → *Change Primary IMED* → Save.
2. **Add the new adviser:** **Requestor Advisor Info** → **Add** opens the *Basic Information* dialog. Fill in:
   - **Sales Code** = IMED_CODE_TO, then click the blue button beside **Advisor Party Code**. It fills the party code and channel, standing in for Intermediary Enquiry; the list also carries the party code.
   - **Sales Code Type** `0`.
   - **Distribution Channel**.
   - **Primary Flag** `Yes`.
   - **Advisor to be Replaced** = the IMED_CODE_FROM adviser.

   Then click **Save**. The new adviser shows as a `NEW` row and the old one as `To be replaced`. Delete, with the NEW row ticked, takes it off again.
3. **Finish the quote** as in the fee SOP:
   - Acceptance.
   - Endr Quote Summary: Create or Refresh Layer, Calculate Premium, End Sub Endorsement, Lock EBQ, Finalise Endorsement. Finalise is refused (30412) until a new adviser is added.
   - Endr Quote Submission: Save, then Submit.
4. **Activate.** In the open book a Checker activates; in the closed book the same user does. On Activate the new adviser takes the old one's place, share and primary flag. Sharing advisers are untouched.

**Checks in the Add dialog:**

| Code | Check |
| --- | --- |
| `56402` / `56403` | Party code missing / unknown |
| `56404` / `56405` | Sales code missing / not that party's |
| `56406` | Sales Code Type required |
| `56407` | Distribution Channel required |
| `56408` | Primary Flag required |
| `56409` | Adviser already on the policy |
| `56410` | Advisor to be Replaced required |
| `56411` | Primary Flag must match the adviser being replaced |
| `56401` | Add or Delete used outside a Change Primary IMED quote |

**Endorse/Alter on a policy that is not ACTIVE** (lapsed) gives `56020`. This is how the build carries the team's rule "can't move because of the lapsed status".

**The list** (`npm run transition` writes it from the seed; also under *Developer menu → Relationship Transition List*) uses the template's columns: IMED_CODE_FROM, IMED_CODE_FROM NAME, IMED_CODE_TO, IMED_CODE_TO NAME, POLICY NUMBERS, CLIENT INITIALS, CLIENT SURNAME. It adds **NEW ADVISOR PARTY CODE**, so no Intermediary Enquiry is needed, as suggested in the recording. It also adds blank **STATUS** (Moved / Lapsed / IMED mismatch / Diarised / Not found) and **COMMENTS** columns to write back to. A second tab, *Expected (test key)*, gives each row's book, benefits and outcome:

| Policy number | Book | What should happen |
| --- | --- | --- |
| 102790001001 | open | Active, adviser 610901: move it (Checker activates) |
| 102790002001 | open | LAPSED: do not move (56020) |
| 102790003001 | open | Requestor Advisor Info shows 633310, not 610901: stop, IMED mismatch |
| 13394001 | closed | Two benefits, LSD/1 (three advisers, only the primary changes) and LSD/2: move each |
| 13394002 | closed | 56000, a quote takes effect 01/11/2026: diarise to that date |
| 13394003 | closed | LAPSED: do not move |
| 15263901 | closed | GL Final Expenses, LSFE/1: move it |
| 15269999 | neither | Not found in either book |

`npm run test:transition` runs every row above in both books in a real browser, then resets the data.

**Not modelled:** the overnight run. In BaNCS the new adviser shows on Requestor Advisor Info the day after Activate. Here the change shows at once.

