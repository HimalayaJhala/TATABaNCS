# DAP flows: Relationship Transition List (PUF and CUF), open and closed book

These are the flows for moving a policy from one adviser to another, as shown from 38:00 in the 4 August 2026 recording. Each flow lists:
- the pages to put it on, with the URL rule, breadcrumb and screen id;
- the element to anchor each step to;
- what to check, and where to branch.

The agent (Seek) follows them as instructions. The test cases come from the rows of the synthetic list.

- **Test data:** `worklist/Relationship Transition List Aug 2026-synthetic.xlsx`, also under *Developer tools → Relationship Transition List → Download Excel*. Upload it to Google Sheets as-is. Tab `pufs and cufs` is the input; tab `Expected (test key)` is the answer key.
- **Before each test run:** *Developer tools → Reset data*, so every case is back to its start state.

## 1. The two BaNCS

| | Open book | Closed book |
| --- | --- | --- |
| URL | `http://online.bancs.omapps.net:4002/IIMS/` (or `localhost:4002`) | `http://online.bancscb.omapps.net:4003/IIMS/` (or `localhost:4003`) |
| Login | `nzwane` (Maker), `dvisser` (Checker) from the same user list; any password. The Checker lands on `/checker/home` | `nzwane`; password **`Closed@2026`** |
| Latency and induced client latency | Maker only. The Checker's steps run at once | Apply (the Maker activates) |
| System Name (header) | `BaNCS_V11.0.3.4.72_071.ear` | `BaNCS_V11.0.3.3.16_019.ear` |
| Search title | Quote/Contract Search | Quote/Contract/Voucher Search |
| Contract numbers | `102790001001` (12 digits) | `13394001/LSD/1`: one per benefit |
| Nothing found | `No records found.` | `No Result Found` |
| Who activates | A Checker (`dvisser`). The Maker gets `71035` | The same user who submitted |

- **Hosts:** run `./scripts/setup-hosts.sh` once to map both host names. Add both domains to the Whatfix account.
- **Telling the books apart:** a flow can use the host, or `#search-title`, or the System Name in the header. In the open book the Checker's home is `/checker/home` (the Maker's is `/home`); every other page has the same URL for both, so use `#user-role` (`SYS-ADMIN` Maker, `PREM-ADM` Checker).
- **URL rules:** `*` must span slashes, because closed-book contract numbers sit inside the path: `/policy/13394001/LSD/1/requestor-advisor-info`.

## 2. Pages: where to apply, with breadcrumbs

Every screen has `<body data-screen="…">` and a `#screen-<name>` block, so a flow can target a page without the URL.

| Page | URL rule (both books) | Breadcrumb (`#breadcrumb`) | `data-screen` |
| --- | --- | --- | --- |
| Login | `*/login` | none | `login` |
| Closed book, not logged in | any closed-book page | none (HTTP 401 page) | `error-401` |
| Home | Maker `*/home`; Checker `*/checker/home` | none | `home` |
| Quote/Contract (Voucher) Search | `*/policy-servicing/search` | none (title `#search-title`) | `search` |
| Search results | `*/policy-servicing/results` | none | `search` |
| Policy Action Details | `*/policy/*` (path ends at the contract number; may have `?ctx=policy`) | `Home > Policy Servicing > Policy Action Details` | `policy` |
| Endorsement Initiation (modal over Policy Action Details) | `*/policy/*/endorse` | `Home > Policy Servicing > Policy Action Details` | `policy` (modal `#endorse-modal`) |
| Error 56000 (transaction in progress) | `*/policy/*/error/already-exist` | `Home > Policy Servicing > Policy Action Details` | `error-already-exist` |
| Requestor Advisor Info | `*/policy/*/requestor-advisor-info` | `Home > Policy Servicing > Requestor Advisor Info` | `requestor-advisor-info` |
| Requestor Advisor Info, Basic Information dialog | `*/policy/*/requestor-advisor-info` or `*/requestor-advisor-info/add` | `Home > Policy Servicing > Requestor Advisor Info` | `requestor-advisor-info` (modal `#adviser-add-modal`) |
| Acceptance | `*/policy/*/acceptance` | `Home > Policy Servicing > Acceptance` | `acceptance` |
| Acceptance dialog | `*/policy/*/acceptance/1` | `Home > Policy Servicing > Acceptance` | `acceptance` |
| Endr Quote Summary | `*/policy/*/quote-summary` | `Home > Policy Servicing > Endr Quote Summary` | `quote-summary` |
| Endr Quote Submission | `*/policy/*/quote-submission` | `Home > New Business > Application Data Capture > Endr Quote Submission` | `quote-submission` |
| Endorsement Quotes | `*/policy/*/endorsement-quotes` | `Home > Policy Servicing > Endorsement Quotes` | `endorsement-quotes` |
| Adviser Info | `*/policy/*/section/adviser-info` | `Home > Policy Servicing > Adviser Info` | `section` |

- **Policy header band**, on every policy page: `#hdr-product-name`, `#hdr-quotation-number`, `#hdr-status`, `#hdr-policy-number`, `#hdr-sub-status`.
- **Messages:** errors are in `#error-message`, in the form `<code>*****: <text>`. The 56000 explanation is in `#error-hint`. Dialog errors are in `#modal-error-message`.
- **Left menu items:** `#nav-<item>`, for example `#nav-requestor-advisor-info`, `#nav-acceptance`, `#nav-endr-quote-summary`, `#nav-endr-quote-submission`, `#nav-endorsement-quotes`.

## 3. The flows

The list row gives: **IMED_CODE_FROM**, **IMED_CODE_TO**, **NEW ADVISOR PARTY CODE**, **POLICY NUMBERS**. The flows write back to **STATUS** (`Moved`, `Lapsed`, `IMED mismatch`, `Diarised`, `Not found`) and **COMMENTS**.

### Flow A: Find the policy (start here for every row)

| # | Page | Element | Action / check |
| --- | --- | --- | --- |
| A1 | Login (open book) | `#login-user`, `#login-password`, `#btn-login` | Log in as the Maker |
| A2 | Home → Search | `#topnav-policy-servicing` | Open Quote/Contract Search |
| A3 | Search | `#contract-no`, `#btn-search` | Enter POLICY NUMBERS, then Search |
| A4 | Search results | `#search-results`, rows `[id^="result-row-"]` | **One row:** the policy is in the open book; go to Flow C. **`#no-results`:** go to Flow B |

### Flow B: Closed book

| # | Page | Element | Action / check |
| --- | --- | --- | --- |
| B1 | Closed-book login (`…bancscb…:4003/login`) | `#login-user`, `#login-password`, `#btn-login` | Password `Closed@2026`. **`#error-message` = `Invalid username/password; logon denied`:** wrong password, stop. **`data-screen="error-401"`:** not logged in, go to the login page |
| B2 | Quote/Contract/Voucher Search | `#contract-no`, `#btn-search` | Enter POLICY NUMBERS **followed by `%`**, for example `13394001%` |
| B3 | Results | rows `[id^="result-row-"]` | **`#no-results` = `No Result Found`:** STATUS `Not found`, stop. **Otherwise:** each row is one benefit (`…/LSD/1`, `…/LSD/2`). Run Flow C, then Flow D, for **each** row |

### Flow C: Pre-checks (do not change anything yet)

| # | Page | Element | Action / check |
| --- | --- | --- | --- |
| C1 | Results | `[id="result-status-<contract>"]` | **`LAPSED`:** STATUS `Lapsed`, stop for this benefit. Endorse/Alter would give `56020` anyway |
| C2 | Results | `[id="result-link-<contract>"]` | Open the policy (Policy Action Details) |
| C3 | Policy Action Details | `#nav-requestor-advisor-info` | Open Requestor Advisor Info |
| C4 | Requestor Advisor Info | `#requestor-advisors` rows `#rai-row-<n>`. Sales Code is in `.rai-sales-code` or `data-sales-code`. Front End View `YES` marks the primary | **Primary adviser's sales code ≠ IMED_CODE_FROM:** STATUS `IMED mismatch`, with the code found in COMMENTS; stop. **Otherwise:** go to Flow D |

### Flow D: Change Primary IMED (the move)

| # | Page | Element | Action / check |
| --- | --- | --- | --- |
| D1 | Requestor Advisor Info | `#btn-back`, or `#nav-policy-action-details` | Back to Policy Action Details |
| D2 | Policy Action Details | `#btn-endorse-alter` | Click Endorse/Alter |
| D3 | **Branch:** Error 56000 (`data-screen="error-already-exist"`) | `#error-message` starts `56000`; `#error-hint` says `…only takes effect on DD/MM/YYYY…` | STATUS `Diarised`, with the date from the hint in COMMENTS; stop |
| D4 | **Branch:** policy page with `#error-message` starting `56020` | | STATUS `Lapsed`, stop |
| D5 | Endorsement Initiation (`#endorse-modal`) | `#endorsement-types-available` → select **Change Primary IMED** → `#btn-move-right` → `#btn-save` | Opens the quote. The header now shows DRAFT ENDORSEMENT QUOTE / Sub-Endorsement Started |
| D6 | Policy Action Details (quote open) | `#nav-requestor-advisor-info` | Open Requestor Advisor Info |
| D7 | Requestor Advisor Info | `#btn-add` | Opens the Basic Information dialog. If disabled, no Change Primary IMED quote is open: go back to D2 |
| D8 | Basic Information (`#adviser-add-modal`) | `#sales-code` | Type IMED_CODE_TO |
| D9 | Basic Information | `#btn-party-lookup` (blue button beside Advisor Party Code) | Fills `#advisor-party-code`. Check it equals NEW ADVISOR PARTY CODE; or type the list's value straight into `#advisor-party-code` |
| D10 | Basic Information | `#sales-code-type` = `0`; `#distribution-channel` (pre-filled from the lookup); `#primary-flag` = `Yes`; `#advisor-to-be-replaced` = the IMED_CODE_FROM adviser (its option text contains the sales code) | Fill these in |
| D11 | Basic Information | `#btn-adviser-save` | **`#modal-error-message`:** see the error table below. **Otherwise:** row `#rai-row-new` shows `NEW (replaces <from>)` and the old row shows `To be replaced` |
| D12 | Acceptance | `#nav-acceptance` → `#acceptance-serial-1` → `#application-accepted` = `Yes`, `#acceptance-date` = today (`DD/MM/YYYY`) → `#btn-save` | |
| D13 | Endr Quote Summary | `#nav-endr-quote-summary`, then in order `#btn-create-refresh-layer` → `#btn-calculate-premium` → `#btn-end-sub-endorsement` → `#btn-lock-ebq` → `#btn-finalise-endorsement` | Each click reloads the page (the loader may show for a while). After Finalise, `#hdr-status` = FINAL ENDORSEMENT QUOTE. **`30412`:** D11 was not saved |
| D14 | Endr Quote Submission | `#nav-endr-quote-submission`; `#admin-requirements-outstanding` blank; `#underwriting-requirements-outstanding` blank; `#all-admin-requirements-received` = `Accepted`; `#reinsurance-verified` = `Yes`; `#legal-verification` = `Approved` if blank → `#btn-save` → `#btn-submit` | Sub Status becomes `Endorsement Submitted` |
| D15 | **Closed book:** Endr Quote Submission | `#btn-activate` | Same user. Sub Status becomes `Approved Endorsed Quote` |
| D16 | **Open book:** hand over to Flow E | | The Maker's Activate gives `71035` |
| D17 | Requestor Advisor Info | `#nav-requestor-advisor-info` | Primary row now shows IMED_CODE_TO. STATUS `Moved` (for a closed-book policy, one benefit per line in COMMENTS) |

### Flow E: Checker activation (open book only)

| # | Page | Element | Action / check |
| --- | --- | --- | --- |
| E1 | Login | `#login-user` = `dvisser`, `#btn-login` | Log in as the Checker: lands on `*/checker/home`. The Checker gets no loading waits or hangs |
| E2 | Search → result | `#contract-no`, `#btn-search`, `[id="result-link-<contract>"]` | Open the policy |
| E3 | Endorsement Quotes | `#nav-endorsement-quotes` → the serial link `#endr-serial-<n>` on the *Change Primary IMED* row (`#endr-row-<n> .endr-type`) | Opens the quote |
| E4 | Endr Quote Submission | `#nav-endr-quote-submission` → `#btn-activate` | Sub Status becomes `Approved Endorsed Quote` |

### Errors the agent can meet in the Basic Information dialog

| Code | Meaning | What to do |
| --- | --- | --- |
| `56401` | Add or Delete outside a Change Primary IMED quote | Go back to D2 |
| `56402` / `56403` | Party code missing / unknown | Use the lookup (D9) or the list's NEW ADVISOR PARTY CODE |
| `56404` / `56405` | Sales code missing / not that party's | Re-check IMED_CODE_TO |
| `56406` / `56407` / `56408` | Sales Code Type / Distribution Channel / Primary Flag missing | Fill it in |
| `56409` | New adviser already on the policy | STATUS `Moved` (already done) |
| `56410` | Advisor to be Replaced missing | Pick the IMED_CODE_FROM adviser |
| `56411` | Primary Flag doesn't match the adviser being replaced | Primary adviser → `Yes` |
| `56412` | Delete with no NEW row ticked | Tick `#rai-check-new`, or don't delete |

## 4. Test cases (one per row of `pufs and cufs`)

Run each case from a fresh *Reset data*. FROM is `610901` (KHANYISILE MOKOENA); TO is `620455` (PRAVEEN NAIDOO, `BNCSMD-100120455`).

| # | POLICY NUMBERS | Flows | Expected path | Expected STATUS | Check in BaNCS afterwards |
| --- | --- | --- | --- | --- | --- |
| 1 | `102790001001` | A → C → D → E | Open book, active, primary `610901` | Moved | Open book, Requestor Advisor Info: `620455`, Front End View YES |
| 2 | `102790002001` | A → C1 | Open book, result Status `LAPSED` | Lapsed | Nothing changed. Endorse/Alter would give `56020` |
| 3 | `102790003001` | A → C | Open book, Requestor Advisor Info shows `633310` | IMED mismatch (COMMENTS: found 633310) | Nothing changed |
| 4 | `13394001` | A (not found) → B → C → D for `13394001/LSD/1` **and** `13394001/LSD/2` | Two benefits; LSD/1 has three advisers (610901 60%, 600122 20%, 633310 20%) | Moved (2 benefits) | LSD/1: `620455`, `600122`, `633310`, shares unchanged. LSD/2: `620455`. Same user activated both |
| 5 | `13394002` | A → B → C → D3 | `13394002/LSD/1`, Endorse/Alter gives `56000`; hint says it takes effect on `01/11/2026` | Diarised (COMMENTS: 01/11/2026) | Nothing changed |
| 6 | `13394003` | A → B → C1 | `13394003/LSD/1`, Status `LAPSED` | Lapsed | Nothing changed |
| 7 | `15263901` | A → B → C → D | `15263901/LSFE/1` (GL Final Expenses), one adviser | Moved | `620455` |
| 8 | `15269999` | A → B3 | Not in either book: `No records found.` then `No Result Found` | Not found | — |

**Negative tests for the dialog** (any active row, for example row 1 before saving D11):
- Save without Advisor to be Replaced gives `56410`.
- Party code `BNCSMD-100133310` with sales code `620455` gives `56405`.
- Primary Flag `No` while replacing the primary gives `56411`.
- Finalise before D11 gives `30412`.
- Open-book Activate by the Maker gives `71035`.

**Closed-book access tests:**
- Open `http://online.bancscb.omapps.net:4003/policy-servicing/search` without logging in: you get 401.
- Log in with any password other than `Closed@2026`: you get `Invalid username/password; logon denied`.

The same cases run automatically with `npm run test:transition`. That is the reference for what each page shows at each step.
