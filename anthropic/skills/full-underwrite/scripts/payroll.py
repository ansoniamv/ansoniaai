"""Staff the Payroll tab from the unit count and solve hourly wages so the Payroll total (L27) lands close to,
but not exactly on, the T12 Personnel total (Pro Forma G38)."""
import math

OFFICE_ROWS, MAINT_ROWS = [8, 9, 10, 11, 12], [13, 14, 15, 16, 17]
EXTRA_OFFICE, EXTRA_MAINT = [18, 19, 20], [21, 22, 23]          # spare formula rows for >5 per side
STEP = 0.06            # each Office employee after the CM earns ~6% (of the top wage) less than the one above
MAINT_RATIO = 0.90     # Maint wage = 90% of the Office wage at the same level
HOURS, WEEKS = 40, 52

def staff_count(units):
    """Units rounded to the nearest 100 (half up, min 100) / 100 = employees per side."""
    return max(1, int(math.floor(units / 100 + 0.5)))

def plan(units, t12_personnel, commissions, burden=0.15, cm_bonus=0.10):
    """commissions = Payroll I24 + I25 (pre-burden, from a recalculated copy). Returns rows to write + check."""
    n = staff_count(units)
    office = [('Office', 'Community Manager' if i == 0 else 'Asst. Community Manager' if i == 1 else 'Leasing Agent', 1 - STEP * i)
              for i in range(n)]
    maint = [('Maint', 'Lead Tech' if i == 0 else 'Service Tech', MAINT_RATIO * (1 - STEP * i)) for i in range(n)]
    # total = (1+burden) * (hours*weeks*(sum w) + cm_bonus*hours*weeks*w_cm + commissions)
    hw = HOURS * WEEKS
    weight = sum(f for *_, f in office + maint) + cm_bonus * office[0][2]
    top = (t12_personnel / (1 + burden) - commissions) / (hw * weight)
    def total(wages):
        return (1 + burden) * (hw * sum(wages) + cm_bonus * hw * wages[0] + commissions)
    ow = [round(top * f * 4) / 4 for *_, f in office]                 # nearest $0.25
    wages = ow + maint_wages(ow)
    if abs(total(wages) - t12_personnel) < 100:                       # "close to but not exactly"
        ow[0] -= 0.25
        wages = ow + maint_wages(ow)
    rows_o = (OFFICE_ROWS + EXTRA_OFFICE)[:n]; rows_m = (MAINT_ROWS + EXTRA_MAINT)[:n]
    if n > len(OFFICE_ROWS + EXTRA_OFFICE):
        raise ValueError(f'{n} per side exceeds the {len(OFFICE_ROWS + EXTRA_OFFICE)} payroll rows available')
    out = []
    for (typ, title, _), w, r in zip(office + maint, wages, rows_o + rows_m):
        out.append((r, typ, title, w))
    return n, out, total(wages)

def maint_wages(office_wages):
    """Maint wage at each level = 90% of the Office wage at that level, rounded to $0.25. If that is >= its
    Office counterpart or equals ANY Office wage, drop $0.25 at a time until it isn't."""
    out = []
    for w in office_wages:
        m = round(w * MAINT_RATIO * 4) / 4
        while m >= w or any(abs(m - o) < 1e-9 for o in office_wages):
            m -= 0.25
        out.append(m)
    return out

def check(rows):
    """QC on plan() rows [(row, 'Office'|'Maint', title, wage)]: Office wage > Maint wage at each level,
    and no Maint wage equals any Office wage. Returns a list of issue strings (empty = pass)."""
    o = [w for _, t, _, w in rows if t == 'Office']; m = [w for _, t, _, w in rows if t == 'Maint']
    issues = []
    if len(o) != len(m): issues.append(f'{len(o)} Office vs {len(m)} Maint')
    for i, (a, b) in enumerate(zip(o, m)):
        if not a > b: issues.append(f'level {i + 1}: Office ${a:.2f} not above Maint ${b:.2f}')
    for i, b in enumerate(m):
        if any(abs(b - a) < 1e-9 for a in o): issues.append(f'Maint level {i + 1} ${b:.2f} equals an Office wage')
    return issues

def check_sheet(ws):
    """Same QC read from a recalculated Payroll sheet (openpyxl, data_only): C type, D title, E wage, rows 8-23."""
    rows = []
    for r in OFFICE_ROWS + MAINT_ROWS + EXTRA_OFFICE + EXTRA_MAINT:
        t, w = ws[f'C{r}'].value, ws[f'E{r}'].value
        if t in ('Office', 'Maint') and isinstance(w, (int, float)): rows.append((r, t, ws[f'D{r}'].value, float(w)))
    rows.sort(key=lambda x: (OFFICE_ROWS + EXTRA_OFFICE + MAINT_ROWS + EXTRA_MAINT).index(x[0]))
    return check(rows)

def write(sheet, n, rows):
    """sheet = xlsx_xml Sheet('Payroll'). Clears every staff row (8-23) then writes the staffed ones."""
    used = {r for r, *_ in rows}
    for r in OFFICE_ROWS + MAINT_ROWS + EXTRA_OFFICE + EXTRA_MAINT:
        if r in used: continue
        for c in 'CDEF': sheet.set(f'{c}{r}', None)
    for r, typ, title, w in rows:
        sheet.set(f'C{r}', typ); sheet.set(f'D{r}', title); sheet.set(f'E{r}', w); sheet.set(f'F{r}', HOURS)
