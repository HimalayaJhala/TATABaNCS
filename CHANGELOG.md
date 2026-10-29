# Changelog

Changes to the dummy BaNCS site and its test data. Add an entry at the top for every change, then commit
(`git add -A && git commit`). Run the test suites before committing; they are listed in the README.

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
