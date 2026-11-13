"""Flag T12 month outliers (bold). A month value on a coded line is an outlier when it is far from that line's
typical month: |x - median| >= max(75% of |median|, 3 x MAD) and >= $1,500 (materiality), OR a sign flip vs
the median on a line whose median is >= $1,000. Lines whose median is 0 (lumpy/annual items) flag any month
>= $5,000 or >= 3x the line mean absolute month (and >= $1,500)."""
import statistics
MONTHS = 'FGHIJKLMNOPQ'

def find(rows):
    """rows: {row: [12 month values]} for coded lines. Returns {row: [month cols]}."""
    out = {}
    for r, vals in rows.items():
        v = [x or 0 for x in vals]
        if not any(v): continue
        med = statistics.median(v)
        mad = statistics.median([abs(x - med) for x in v])
        hits = []
        for c, x in zip(MONTHS, v):
            d = abs(x - med)
            if abs(med) < 1:
                mean_abs = sum(abs(y) for y in v) / 12
                if abs(x) >= 5000 or (abs(x) > 0 and abs(x) >= 3 * mean_abs and abs(x) >= 1500): hits.append(c)
            elif (d >= max(0.75 * abs(med), 3 * mad) and d >= 1500) or (abs(med) >= 1000 and x * med < 0):
                hits.append(c)
        if hits: out[r] = hits
    return out

def bold(wb, sheet, flags):
    from xlsx_xml import make_style
    for r, cols in flags.items():
        for c in cols:
            el = sheet.cell(f'{c}{r}'); el.set('s', str(make_style(wb, el.get('s'), bold=True)))
