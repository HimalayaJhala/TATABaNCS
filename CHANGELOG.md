# Changelog

Changes to the dummy BaNCS site and its test data. Add an entry at the top for every change, then commit
(`git add -A && git commit`). Run the test suites before committing; they are listed in the README.

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
