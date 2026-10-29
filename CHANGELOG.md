# Changelog

Changes to the dummy BaNCS site and its test data. Add an entry at the top for every change, then commit
(`git add -A && git commit`). Run the test suites before committing; they are listed in the README.

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
