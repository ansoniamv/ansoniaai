"""Staff the Payroll tab from the unit count and solve hourly wages so the Payroll total (L27) lands close to,
but not exactly on, the T12 Personnel total (Pro Forma G37)."""
import math

OFFICE_ROWS, MAINT_ROWS = [8, 9, 10, 11, 12], [13, 14, 15, 16, 17]
EXTRA_OFFICE, EXTRA_MAINT = [18, 19, 20], [21, 22, 23]          # spare formula rows for >5 per side
STEP = 0.06            # each employee after the top one earns ~6% (of the top wage) less than the one above
HOURS, WEEKS = 40, 52

def staff_count(units):
    """Units rounded to the nearest 100 (half up, min 100) / 100 = employees per side."""
    return max(1, int(math.floor(units / 100 + 0.5)))

def plan(units, t12_personnel, commissions, burden=0.15, cm_bonus=0.10):
    """commissions = Payroll I24 + I25 (pre-burden, from a recalculated copy). Returns rows to write + check."""
    n = staff_count(units)
    office = [('Office', 'Community Manager' if i == 0 else 'Asst. Community Manager' if i == 1 else 'Leasing Agent', 1 - STEP * i)
              for i in range(n)]
    maint = [('Maint', 'Lead Tech' if i == 0 else 'Service Tech', 1 - STEP * i) for i in range(n)]
    # total = (1+burden) * (hours*weeks*(sum w) + cm_bonus*hours*weeks*w_cm + commissions)
    hw = HOURS * WEEKS
    weight = sum(f for *_, f in office + maint) + cm_bonus * office[0][2]
    top = (t12_personnel / (1 + burden) - commissions) / (hw * weight)
    def total(wages):
        return (1 + burden) * (hw * sum(wages) + cm_bonus * hw * wages[0] + commissions)
    wages = [round(top * f * 4) / 4 for *_, f in office + maint]      # nearest $0.25
    if abs(total(wages) - t12_personnel) < 100:                       # "close to but not exactly"
        wages[0] -= 0.25
    rows_o = (OFFICE_ROWS + EXTRA_OFFICE)[:n]; rows_m = (MAINT_ROWS + EXTRA_MAINT)[:n]
    if n > len(OFFICE_ROWS + EXTRA_OFFICE):
        raise ValueError(f'{n} per side exceeds the {len(OFFICE_ROWS + EXTRA_OFFICE)} payroll rows available')
    out = []
    for (typ, title, _), w, r in zip(office + maint, wages, rows_o + rows_m):
        out.append((r, typ, title, w))
    return n, out, total(wages)

def write(sheet, n, rows):
    """sheet = xlsx_xml Sheet('Payroll'). Clears every staff row (8-23) then writes the staffed ones."""
    used = {r for r, *_ in rows}
    for r in OFFICE_ROWS + MAINT_ROWS + EXTRA_OFFICE + EXTRA_MAINT:
        if r in used: continue
        for c in 'CDEF': sheet.set(f'{c}{r}', None)
    for r, typ, title, w in rows:
        sheet.set(f'C{r}', typ); sheet.set(f'D{r}', title); sheet.set(f'E{r}', w); sheet.set(f'F{r}', HOURS)
