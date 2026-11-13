---
name: full-underwrite
description: "Ansonia full-deal underwriting, platform run: builds a new copy of the 00. Pro Forma template from a deal's rent roll, T12 and OM (plus an optional HelloData comps export), filling the T12, unit, rent, affordability, value-add, tax, payroll, comps, broker, debt, Q&A and (when there is commercial space) Commercial Analysis tabs, and writes the model and a QC report to the session outputs."
---

# Full Underwrite (platform run)

This is the Ansonia platform's version of the desktop full-underwrite skill. The underwriting rules are in
`UNDERWRITE.md` next to this file, copied verbatim from the desktop skill. Follow them exactly, except where this file
says otherwise. Where the two disagree, this file wins.

Nobody is watching the run, and nobody can answer a question while it runs. Never stop to ask. Wherever
UNDERWRITE.md says to ask Chase, use `run.json` if it answers the question. If it doesn't, make the call, keep going,
and put the decision on the QC review list with the reason for it.

## Inputs

Everything is mounted read-only under `/mnt/session/uploads/`:

| File | What it is |
|---|---|
| `run.json` | The run's brief: deal name, address, unit count and other deal-record facts, the file list below with each file's original name, and the options the user chose (`renovation_level`, `notes`). Read it first. |
| `rent_roll.<ext>` | Raw rent roll |
| `t12.<ext>` | Raw T12 |
| `om.pdf` | The OM, when there is one. With no OM, follow UNDERWRITE.md's "No OM" rule (workflow step 1): listing pages, the county tax office, comps you pick, a blank Broker column. |
| `comps.<ext>` | HelloData comps export, when the user attached one |
| `template.xlsx` | `00. Pro Forma - Template`. Never write to it; build a new copy. |
| `novogradac.xlsx` | The Novogradac affordability workbook (the newest year on SharePoint), when the platform found one |

The platform already chose the newest T12 and the rent roll closest to it, so use the files you are given. If
`run.json` lists a file that isn't mounted, treat it as missing.

`run.json.options.renovation_level` answers the renovation question: `classic`, `partial`, `full`, `mixed` (read the
mix from the OM and rent roll) or `unknown`. With `unknown`, read it from the OM. If the OM doesn't say, treat every
unit as classic and flag it. `run.json.options.notes` is free text from the user; apply it as a correction from Chase.

## Outputs

Write exactly these to `/mnt/session/outputs/`:

1. `00. Pro Forma - <Property> vCURRENT.xlsx`: the model, with `<Property>` from `run.json.deal.property_name`.
2. `qc.md`: the QC report from UNDERWRITE.md section D, in the same short form: the tie-outs as a table, then the
   review list. Add a "Could not do" section for every step you skipped or ran on a fallback, and a "Suggested skill
   updates" section in place of the learning loop (proposed Appendix A lines or rule changes; the platform does not
   change the skill on its own).
3. `result.json`: `{"model_file": "<file name>", "complete": true|false, "skipped": ["<step>", ...]}`. Set
   `complete` to false when any step in the Workflow was skipped. A partial model is still worth delivering.

Write `result.json` last; the platform treats the run as finished when it appears. If the run fails outright, still
write `qc.md` and `result.json` (with `"model_file": null`) saying what went wrong.

## Progress

At the start of each major step, send one short line beginning `PROGRESS:` (for example
`PROGRESS: Coding the T12 (212 lines)`). The deal page shows the latest one. Keep other messages to a minimum.

## Setup

The skill's Python is already written: it is in `scripts/` next to this file. Copy `scripts/` to a working folder
(e.g. `/workspace/uw/`) and run everything from there, in place of the "write the appendix code to disk" step. The
coding exceptions are also in `scripts/exceptions.txt`, for `classifier.load_exceptions()`.

1. `pip install lxml openpyxl` (skip what is already installed).
2. Recalculation needs LibreOffice with its Python bridge (`soffice` and the `uno` module). Check with
   `soffice --version` and `python3 -c "import uno"`. If either is missing, try
   `apt-get install -y libreoffice-calc python3-uno` (with `sudo` if needed). Note the result in `qc.md` under
   "Environment".
3. If LibreOffice can't be installed, run without it:
   - Skip `lo_compat.py`, `recalc.py` and `inject_cache.py`. The file keeps `fullCalcOnLoad`, so Excel calculates it
     when it is opened; say in `qc.md` that it must be opened in Excel (and out of Protected View) before the numbers
     show.
   - Compute the numbers the later steps need from the inputs directly instead of from `qc.xlsx`: the T12 Personnel
     total (sum of the coded Personnel lines) for the payroll solve, the commission inputs from the template's
     Payroll rows, the recent-lease averages for the FPS checks, and the comps' rent values for sorting.
   - Run the QC tie-outs on those computed values, and mark each one "computed, not recalculated".

## What changes from the desktop skill

- **Files:** there is no SharePoint, OneDrive or M365 connector. Use only the files under `/mnt/session/uploads/`.
  The Novogradac workbook is `novogradac.xlsx`; when it is missing, skip the affordability tab (C.7) and the
  Affordability table (C.17), and say so. Never use the `sheet_from_text()` text fallback: there is no connector.
- **Web research** (C.10 amenities, C.12 rent comps, C.14 Treasury) works as written, with the web tools in this
  session. There are no subagents: research the comps one after another, and keep it to what the tables need.
- **HelloData comps:** when `comps.<ext>` is present, take the rent-comp floor plans for C.12 (sq ft and asking rent
  by plan) from the export instead of the web, and use the web only for comps or plans the export lacks. Name the
  source of each row in `qc.md`. Still fill the C.10 amenity table from the OM's comps and the web.
- **Reno level, unit codes and other questions for Chase:** follow the rule at the top of this file. Never ask.
- **Learning loop:** don't edit the skill. Put proposals under "Suggested skill updates" in `qc.md`.
- **Delivery:** write to `/mnt/session/outputs/`, not to a deal folder.

## Cost

The session has a hard spend cap, and the run stops when it reaches it. Work in this order so a capped run still
leaves something useful: T12, rent roll (units, floor plans, FPS), Overview, Tax, Broker column, Treasury, S&U
transfer tax (Illinois only), Payroll, Rent Analysis, affordability tab and the Affordability table (C.7, C.17),
Value-Add (C.16), Q&As (C.18), AP Comps (C.10 and C.12), then commercial (C.19) last, because it inserts rows on
Pro Forma and Multi Yr. Save the model after each tab, so the latest save is always a usable file, and update
`qc.md` as you go. If the run stops before C.19 on a deal with commercial space, `qc.md` must say the commercial rows
are missing.
