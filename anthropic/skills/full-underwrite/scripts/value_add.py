"""Value-Add tab, Hard Levers rows 9-15: write the OM's pitched value-add items.

Multi Yr M54 adds SUMIF('Value-Add'!Q8:Q15,"Other Income",L8:L15) to Year 1 Other Residential Income,
so every item must sit in rows 9-15 with Line Item (Q) = "Other Income". Never insert rows.
Row 8 (Unit Renovations) is driven by Rent Analysis and is left alone.

items = [dict(name, count, revenue, cost, penetration, freq='Monthly', note, kind=None)]
  kind (optional) pins a template row: 'wd','reserved_parking','covered_parking','tech','amenity','valet','pest'.
"""
import re

ROWS = {9: 'wd', 10: 'reserved_parking', 11: 'covered_parking', 12: 'tech', 13: 'amenity', 14: 'valet', 15: 'pest'}
KEYS = [  # (kind, regex on the OM item name)
    ('wd', r'washer|dryer|w/d'),
    ('reserved_parking', r'reserved'),
    ('covered_parking', r'covered|carport'),
    ('tech', r'tech|smart|wifi|wi-fi|internet'),
    ('amenity', r'amenity'),
    ('valet', r'valet|doorstep'),
    ('pest', r'pest'),
]

def kind_of(name):
    t = name.lower()
    for k, rx in KEYS:
        if re.search(rx, t): return k
    return None

def assign(items):
    """-> ({row: item}, [items left over]). Template rows whose lever matches stay put; other items take the
    unused rows from the bottom up (15, 14, ...). More than 7 items: the 7 largest by annual income are kept."""
    for it in items:
        it.setdefault('freq', 'Monthly'); it.setdefault('kind', kind_of(it['name']))
        mult = 12 if it['freq'] == 'Monthly' else 1
        it['annual'] = it['count'] * it['revenue'] * mult * it['penetration']
    items = sorted(items, key=lambda i: -i['annual'])
    keep, extra = items[:7], items[7:]
    out, free = {}, []
    by_kind = {v: k for k, v in ROWS.items()}
    rest = []
    for it in keep:
        r = by_kind.get(it['kind'])
        if r and r not in out: out[r] = it
        else: rest.append(it)
    free = [r for r in sorted(ROWS, reverse=True) if r not in out]
    for it, r in zip(rest, free): out[r] = it
    return out, extra

def write(wb, items):
    """Writes F (label, only when the row is repurposed), G count, H revenue, I cost, J frequency, K penetration,
    Q 'Other Income', R note. Returns the row map and leftovers for the report."""
    sh = wb.sheet('Value-Add')
    rows, extra = assign(items)
    for r, it in rows.items():
        if it['kind'] != ROWS[r]:
            sh.set('F%d' % r, it['name'])
        sh.set('G%d' % r, it['count'])
        sh.set('H%d' % r, it['revenue'])
        sh.set('I%d' % r, it['cost'])
        sh.set('J%d' % r, it['freq'])
        sh.set('K%d' % r, it['penetration'])
        sh.set('Q%d' % r, 'Other Income')
        sh.set('R%d' % r, it.get('note', ''))
        if r == 15:                       # template M15 = I15*Units*12 (pest monthly cost); use the per-count cost like rows 9-14
            sh.set('M15', '=I15*G15')
    return rows, extra
