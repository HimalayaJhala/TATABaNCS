# Changelog

Changes to the dummy BaNCS site and its test data. Add an entry at the top for every change, then commit
(`git add -A && git commit`). Run the test suites before committing; they are listed in the README.

## 2026-10-30: login heading and Google Sheets dates

- The login box heading is now "Insurance - Login", without "TCS BaNCS".
- **Google Sheets:** the copied formula wraps IMPORTDATA in MAP/LAMBDA, so Declaration Signed Date (and the transition list's dates) shows as 04/08/2026 instead of the serial 46238. Only whole numbers in the 2000–2049 date range are converted, and no code or amount in either list falls there.

## 2026-10-30: every action button is clickable

- **Buttons are no longer greyed to enforce the order of steps**, as in the recording. That covers the Endr Quote Summary and Policy Action Details step bar, Submit on Endr Quote Submission, the Checker's Save / Reject / Activate and Maker buttons, and Requestor Advisor Info Add / Delete. The invented hover texts ("Not available yet. Next step: …", "Finalise Endorsement first", "Maker step…") and the Checker's "not submitted yet" note are gone.
- **The server rules are unchanged** and refuse a wrong click with an error band, and the quote doesn't move: `30401`–`30405` / `30410` for a step out of order (naming the next step), `48101` for Submit before Finalise, `71020` for Activate before Submit, and `71037` for a Maker step by the Checker.
- `48101` now gives the current Sub Status and says to complete the Endr Quote Summary steps first.
- Read-only fields stay greyed; only the buttons changed.
- **Why:** a guided flow could skip Finalise Endorsement without anything visibly going wrong; Submit just stayed grey. Now the click goes through and the error says what is missing.
- **Tests:** updated to check that buttons are clickable and that out-of-order clicks are refused.

## 2026-10-29: the Checker only verifies

- **Server rule 71037:** the Checker (PREM-ADM) can no longer do any Maker step, whether through the screens or by calling the server directly. That covers Endorse/Alter, Basic Details, Acceptance, the Endr Quote Summary steps, saving or submitting Endr Quote Submission, Requestor Advisor Info and Advisor Change. The Checker can also only reject a quote that has been submitted. This is the counterpart of 71035, where the Maker can't activate their own quote.
- **Screens:** the Checker sees those buttons greyed, with the tooltip "Maker step". On a quote that hasn't been submitted, Endr Quote Submission shows Save, Reject and Activate greyed, read-only fields, and the note "This quote has not been submitted for verification yet (Sub Status: …)".
- **Tests:** added to `npm test`.

## 2026-10-29: Endr Quote Summary button rows as in the recording

- The endorsement step buttons are smaller: 10.5px text and tighter padding. The whole step row, Endorsement Detail included, now fits on one line, with Back / Continue / Premium Projection right-aligned on the line below, as in the recording. This holds while loading and when not loading.
- It's two rows at 1366px and wider at every stage. At 1280px, only the 10-button state right after Create or Refresh Layer wraps.
- The Google Sheets new-tab test now waits for the tab itself, instead of a fixed 3 s.

## 2026-10-29: start page and keep-awake

- `start/index.html` is a static start page (Render static site `om-bancs-start`). It shows the BaNCS loading ring and "Starting TCS BaNCS…" while the free service wakes, then opens `https://om-bancs.onrender.com/IIMS/`. Share this link with users.
- `.github/workflows/keep-awake.yml` pings `/IIMS/` every 10 minutes, so the service normally doesn't sleep and the data isn't reset by idling. That's about 0.5 MB of traffic a month, and free on a public repo.

## 2026-10-29: clearer error when activating an approved or rejected quote

- Activate on a quote that is already Approved Endorsed Quote, or rejected, now returns 71021 "It has already been activated (Approved Endorsed Quote)" or "…rejected". It used to return 71020 "It has not been submitted".

## 2026-10-29: left menu greys sections only while the quote is a draft

- Basic Details, Adviser Info and Advisor Change are greyed for Change Advisor Details only while the quote is DRAFT ENDORSEMENT QUOTE.
- Once the quote is finalised the menu is plain, which is what the Checker sees in the SOP (picture 23, after Activate) and in the recording. Before this, the Checker also saw them greyed.
- SOP pictures 24 and 25 show a different policy (OMP Family Funeral, 101600509001), so their menu is the funeral product's and isn't copied.

## 2026-10-29: Google Sheets option in developer tools

- Each test data set now has a Google Sheets button next to Excel and PDF. It opens a new Google Sheet and copies `=IMPORTDATA("https://om-bancs.onrender.com/login/dummy-data/csv", ",", "en_GB")` (or `transition-csv`). Pasted into A1, the formula loads the data from the hosted site.
- New CSV endpoints: `/login/dummy-data/csv` and `/login/dummy-data/transition-csv`, built from the first tab of each workbook.

## 2026-10-29: forms checked against the SOP

- Compared every Maker form with the SOP screenshots and the recording. Endorsement Initiation, Basic Details, Acceptance and Endr Quote Submission already open with the values shown there, so no defaults changed.
- "All admin requirements received" now lists only Accepted, No and Yes, as in the recording. Blank, Pending and Rejected were removed.
- 112333103001 (row 4 of the dummy sheet) opens Endr Quote Submission with Legal Verification blank. This covers the SOP's "if not pre-populated then select the Approved option".
- Rebuilt `Fee Switch-Off Calculations.xlsx` to match.

## 2026-10-29: developer tools panel cleanup

- Renamed "Developer menu" to "Developer tools" and restyled it as a neutral panel, replacing the yellow note look. It has three groups: Reset data, Test data and Induced artificial latency.
- "Browser hang" is now "induced client latency", and the per-step column is "Client latency". The Normal and Stress waits are labelled "server latency".
- Shorter notes, and the Activate row is labelled "Activate (closed book)", since the Checker never waits.
- Element ids are unchanged, so tests and DAP selectors still work.

## 2026-10-29: Basic Details collapses while saving

- While Save is loading, Basic Details hides its sections so Save and Continue sit directly under the loader, the same as Endr Quote Summary.

## 2026-10-29: Whatfix initiator script

- The Whatfix script on every BaNCS page, and on the mailbox, is now `https://cdn.whatfix.com/prod/e7817f15-91df-440e-906c-959e507b7b6d/initiator/initiator.nocache.js`. It was `.../embed/embed.nocache.js`.

## 2026-10-29: no seeded endorsement quotes on the dummy work list contracts

- Removed the seeded quote history from 119900001001 (serials 1 to 3, copied from the recording) and from 110671307001 and 112333103001 (one approved quote each). 102790002001 had none.
- Endorsement Quotes on these contracts is now empty until a run creates serial 1, for example `1199000010010001`.
- The seeded quotes behind the 56000 cases (113901377001, 114020658001) are unchanged.

## 2026-10-29: loading time and Quote Summary loading layout

- **A step now loads for whichever is longer: the real response or the configured latency.** They used to be added together.
  - For example, a 5 s response with 4 s latency loads for 5 s; a 6 s response with 10 s latency loads for 10 s.
  - A step that fails still answers at once.
  - The latency now runs in BaNCS alongside the call to data-service; data-service no longer adds its own wait.
- **Endr Quote Summary while loading:** the summary sections drop away, so the action bar moves up under the loader (as Search does). Other screens keep their layout.

## 2026-10-29: Render hosting

- Added `render.yaml` (one free web service, `om-bancs`) and `scripts/render-start.js`. The start script runs data-service and the open-book BaNCS on Render's port.
- No app changes: same paths, the same login with both users, and any password accepted.
- The hosted site has no mailbox and no closed book; `npm run demo` still runs everything locally.

## 2026-10-29: baseline (first commit)

The state of the demo when version tracking started.

- **Services:**
  - data-service :4000;
  - mail-sim :4001;
  - BaNCS open book :4002;
  - BaNCS closed book :4003 (password `Closed@2026`).
- **Logins:** one login page. The Maker (`nzwane`) lands on `/home`; the Checker (`dvisser`) lands on `/checker/home`. The Checker has no latency or browser hang.
- **SOPs covered:**
  - Switching Off Fees, with the Checker activating;
  - Split commission;
  - the Relationship Transition List (Change Primary IMED, open and closed book).
- **Developer menu (login page, bug icon):**
  - Reset data;
  - Dummy data (Excel and PDF);
  - Relationship Transition List (Excel and PDF);
  - the latency profile, and the latency and browser-hang table.
- **Dummy data** (`worklist/Split Fee Cases and Annuities Aug 2026-synthetic.xlsx` / `.pdf`): S&I tab only, four rows.
  1. 119900001001: works.
  2. 102790002001: lapsed, gives 56020.
  3. 110671307001: works.
  4. 112333103001: works.
- **DAP guide:** `docs/dap-transition-flows.md`.
- **Not tracked:** the client's own material (SOP, email, recordings, screenshots, `reference/`). See `.gitignore`.
