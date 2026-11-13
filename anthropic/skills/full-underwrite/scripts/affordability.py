"""Rent Analysis affordability (AP:AY) + bathrooms (V) from the county Novogradac tab.

- find_rent_limits(): the 'Bedrooms (People)' table -> {'60%': {bed: ref}, '80%': {...}, ...}
- find_ua_schedules(): every HUD-52667 style block ('0 BR | 1 BR | ...' header) -> lines with category + fuel
- pick_schedule() / select_lines(): the block for the building type and the tenant-paid lines for the property's fuels
- build_ua_table(): writes a 'Tenant-Paid Utility Allowance' table (formulas into the schedule) to the right of the tab
- wire_rent_analysis(): Rent Analysis V (baths), AS (80% gross) and AU (utility allowance) per plan row
"""
import re
from lxml import etree
from xlsx_xml import Q, col2n, n2col, split, make_style

# ---------------------------------------------------------------- read cell values from an xlsx_xml sheet
def _sst(wb):
    if not hasattr(wb, '_sstl'):
        wb._sstl = []
        x = wb.files.get('xl/sharedStrings.xml')
        if x:
            for si in etree.fromstring(x).findall(Q('si')):
                wb._sstl.append(''.join(t.text or '' for t in si.iter(Q('t'))))
    return wb._sstl

def values(wb, tab):
    """{(row, col): value} for every non-empty cell (cached value for formulas)."""
    sh = wb.sheet(tab); out = {}
    for c in sh.root.iter(Q('c')):
        t = c.get('t'); v = c.find(Q('v'))
        if t == 'inlineStr':
            val = ''.join(x.text or '' for x in c.iter(Q('t')))
        elif v is None or v.text is None:
            continue
        elif t == 's':
            val = _sst(wb)[int(v.text)]
        elif t in ('str', 'e'):
            val = v.text
        elif t == 'b':
            val = v.text == '1'
        else:
            try: val = float(v.text)
            except ValueError: val = v.text
        if val in ('', None): continue
        col, row = split(c.get('r')); out[(row, col2n(col))] = val
    return out

def _txt(v): return re.sub(r'\s+', ' ', str(v)).strip().lower() if isinstance(v, str) else ''
def _num(v): return isinstance(v, (int, float)) and not isinstance(v, bool)
def _money(v):
    """number, or a number stored as text like '$19.00' (some pasted schedules), else None"""
    if _num(v): return float(v)
    m = re.fullmatch(r'\$?\s*(\d+(?:\.\d+)?)', v.strip()) if isinstance(v, str) else None
    return float(m.group(1)) if m else None
def ref(r, c): return '%s%d' % (n2col(c), r)

def _bed(label):
    t = _txt(label)
    if t.startswith(('efficiency', 'studio', '0 b', '0br')): return 0
    m = re.match(r'(\d)\s*-?\s*(bed|br|bd)', t)
    return int(m.group(1)) if m else None

# ---------------------------------------------------------------- rent limits
def find_rent_limits(vals):
    """First 'Bedrooms (People)' table. Returns ({'60%': {bed: ref}, '80%': {...}}, header ref) or ({}, None)."""
    for (r, c), v in sorted(vals.items()):
        if not _txt(v).startswith('bedrooms (people)'): continue
        cols = {}
        for cc in range(c + 1, c + 10):
            hv = vals.get((r, cc)); h = _txt(hv)
            if _num(hv) and 0 < hv <= 2: h = '%d%%' % round(hv * 100)   # text-fallback sheets store "80%" as 0.8
            if re.fullmatch(r'\d{2,3}%', h): cols[h] = cc
        out = {k: {} for k in cols}
        rr = r + 1
        while True:
            b = _bed(vals.get((rr, c)))
            if b is None: break
            for k, cc in cols.items():
                if _num(vals.get((rr, cc))): out[k][b] = ref(rr, cc)
            rr += 1
        if out.get('80%') or out.get('60%'):
            return out, ref(r, c)
    return {}, None

# ---------------------------------------------------------------- utility allowance schedules
CATS = [  # (key, test on a row's own label text) - order matters
    ('wh',     lambda t: 'water heat' in t),
    ('heat',   lambda t: 'heating' in t or t.startswith('heat')),
    ('cook',   lambda t: 'cooking' in t),
    ('oe',     lambda t: 'other electric' in t),
    ('ac',     lambda t: 'air cond' in t or 'cooling' == t),
    ('base',   lambda t: 'base charge' in t or ('charge' in t and ('gas' in t or 'electric' in t))),
    ('sewer',  lambda t: t.startswith('sewer')),
    ('trash',  lambda t: 'trash' in t or 'garbage' in t),
    ('water',  lambda t: t.startswith('water')),
    ('range',  lambda t: 'range' in t or 'microwave' in t),
    ('fridge', lambda t: 'refrig' in t),
    ('other',  lambda t: t.startswith('other')),
]
FUELED = ('heat', 'cook', 'wh', 'base')

def _cat(t):
    for k, f in CATS:
        if f(t): return k
    return None

def _fuel(t):
    if 'heat pump' in t: return 'heat_pump'
    if 'bottle' in t or 'propane' in t: return 'propane'
    if 'natural gas' in t or re.search(r'\bgas\b', t): return 'gas'
    if 'electric' in t: return 'electric'          # includes 'Oil/Electric' (Dallas layout)
    if 'oil' in t: return 'oil'
    if 'coal' in t: return 'other'
    return None

def find_ua_schedules(vals):
    grid = vals
    hdrs = []
    for (r, c), v in grid.items():
        if re.fullmatch(r'0 ?br', _txt(v)) and any(re.fullmatch(r'1 ?br', _txt(grid.get((r, c + k)))) for k in (1, 2, 3)):
            hdrs.append((r, c))
    hdrs.sort()
    out = []
    for i, (hr, c0) in enumerate(hdrs):
        bedcols = {}
        for cc in range(c0, c0 + 16):
            m = re.fullmatch(r'(\d) ?br', _txt(grid.get((hr, cc))))
            if m: bedcols[int(m.group(1))] = cc
        unit_type = ''
        for rr in range(max(1, hr - 5), hr + 1):
            for (r2, c2), v in grid.items():
                if r2 == rr and 'unit type' in _txt(v):
                    unit_type = re.sub(r'(?i).*unit type[:\s]*', '', str(v)).replace('\n', ' ').strip()
                    unit_type = re.split(r'\s{2,}|date', unit_type, flags=re.I)[0].strip()
        stop = hdrs[i + 1][0] if i + 1 < len(hdrs) else hr + 60
        lines, cat, blanks = [], None, 0
        for rr in range(hr + 1, stop):
            texts = [(cc, grid[(rr, cc)]) for cc in range(max(1, c0 - 8), c0) if isinstance(grid.get((rr, cc)), str)]
            own = _txt(' '.join(str(v) for _, v in texts))
            if 'actual family' in own or own.startswith('total'): break
            nums = {b: ref(rr, cc) for b, cc in bedcols.items() if _money(grid.get((rr, cc))) is not None}
            text_vals = {b: _money(grid.get((rr, cc))) for b, cc in bedcols.items() if isinstance(grid.get((rr, cc)), str) and _money(grid.get((rr, cc))) is not None}
            if not texts and not nums:
                blanks += 1
                if blanks >= 3: break
                continue
            blanks = 0
            k = _cat(own)
            if k: cat = k
            if not nums: continue
            if not texts and not k and cat is None: continue
            line_cat = k or cat
            fuel = _fuel(own) if line_cat in FUELED else None
            if line_cat == 'water' and 'sewer' in own: line_cat = 'water_sewer'
            label = ' '.join(str(v).strip() for _, v in texts) or line_cat
            lines.append({'row': rr, 'cat': line_cat, 'fuel': fuel, 'label': re.sub(r'\s+', ' ', label), 'refs': nums, 'text_vals': text_vals})
        out.append({'header_row': hr, 'first_bed_col': c0, 'bedcols': bedcols, 'unit_type': unit_type, 'lines': lines})
    return [s for s in out if s['lines']]

def pick_schedule(scheds, building, energy_efficient=False):
    """building: 'garden' (walk-up apartments), 'elevator' (mid/high-rise) or 'townhome'.
    energy_efficient: ENERGY STAR / green-certified property -> prefer an 'Energy Efficient' / 'Green' schedule."""
    if not scheds: return None
    def score(s):
        u = s['unit_type'].lower()
        green = any(k in u for k in ('energy', 'green'))
        if green != bool(energy_efficient): return -1
        if building == 'elevator': return 3 if 'elev' in u else 0
        if building == 'townhome': return 3 if ('row' in u or 'town' in u) else 0
        if 'elev' in u: return 0
        if any(k in u for k in ('larger apartment', '5+', 'walk')): return 3
        if any(k in u for k in ('apartment', 'multi-family', 'multifamily', 'apartments')): return 2
        return 1 if not u else 0
    return max(scheds, key=lambda s: (score(s), -s['header_row']))

def select_lines(sched, util):
    """util: heat / cooking / water_heat in {'electric','heat_pump','gas','propane', None=owner-paid};
    electric, water, sewer, trash: True if the resident pays (direct or RUBS).
    Returns (lines, issues). Range/refrigerator (owner-supplied) and 'Other' rows are never included."""
    L, issues = sched['lines'], []
    def pick(cat, fuel):
        if not fuel: return None
        c = [l for l in L if l['cat'] == cat]
        for want in ([fuel, 'electric'] if fuel == 'heat_pump' else [fuel]):
            hit = [l for l in c if l['fuel'] == want]
            if hit:
                if want != fuel: issues.append('%s: no heat-pump row, used electric' % cat)
                return hit[0]
        issues.append('%s: no %s row in the schedule' % (cat, fuel)); return None
    out = []
    for cat, key in (('heat', 'heat'), ('cook', 'cooking'), ('wh', 'water_heat')):
        l = pick(cat, util.get(key))
        if l: out.append(l)
    if util.get('electric', True):
        out += [l for l in L if l['cat'] in ('oe', 'ac')]
        out += [l for l in L if l['cat'] == 'base' and l['fuel'] == 'electric']
    if 'gas' in (util.get('heat'), util.get('cooking'), util.get('water_heat')):
        out += [l for l in L if l['cat'] == 'base' and l['fuel'] == 'gas']
    for cat in ('water', 'sewer', 'trash'):
        if util.get(cat): out += [l for l in L if l['cat'] == cat]
    if util.get('water') or util.get('sewer'):
        out += [l for l in L if l['cat'] == 'water_sewer']
    seen, res = set(), []
    for l in sorted(out, key=lambda l: l['row']):
        if l['row'] not in seen: seen.add(l['row']); res.append(l)
    return res, issues

NAMES = {'heat': 'Heating', 'cook': 'Cooking', 'wh': 'Water Heating', 'oe': 'Other Electric', 'ac': 'Air Conditioning',
         'base': 'Base Charge', 'water': 'Water', 'sewer': 'Sewer', 'trash': 'Trash Collection', 'water_sewer': 'Water & Sewer'}
FUELN = {'electric': 'Electric', 'heat_pump': 'Electric Heat Pump', 'gas': 'Natural Gas', 'propane': 'Bottle Gas', 'oil': 'Fuel Oil'}

def _blue(wb, base):
    """style = base with a blue (#0000FF) font, for hardcoded inputs"""
    import copy
    if not hasattr(wb, '_st'):
        make_style(wb, base)
    st = wb._st; key = ('blue', base)
    if key in wb._stcache: return wb._stcache[key]
    xfs = st.find(Q('cellXfs')); fonts = st.find(Q('fonts'))
    nx = copy.deepcopy(xfs[int(base)]); nf = copy.deepcopy(fonts[int(nx.get('fontId', '0'))])
    for c in nf.findall(Q('color')): nf.remove(c)
    col = etree.Element(Q('color')); col.set('rgb', 'FF0000FF')
    kids = list(nf); idx = next((i for i, k in enumerate(kids) if k.tag in (Q('sz'),)), len(kids))
    nf.insert(idx + 1 if idx < len(kids) else len(kids), col)
    fonts.append(nf); fonts.set('count', str(len(fonts)))
    nx.set('fontId', str(len(fonts) - 1)); nx.set('applyFont', '1')
    xfs.append(nx); xfs.set('count', str(len(xfs)))
    wb._stcache[key] = len(xfs) - 1
    wb.files['xl/styles.xml'] = etree.tostring(st, xml_declaration=True, encoding='UTF-8', standalone=True)
    return wb._stcache[key]

def _max_col(wb, tab):
    m = 0
    for c in wb.sheet(tab).root.iter(Q('c')):
        if c.find(Q('v')) is not None or c.find(Q('f')) is not None or c.find(Q('is')) is not None:
            m = max(m, col2n(split(c.get('r'))[0]))
    return m

def _col_width(wb, tab, col, width):
    root = wb.sheet(tab).root
    cols = root.find(Q('cols'))
    if cols is None:
        cols = etree.Element(Q('cols')); root.find(Q('sheetData')).addprevious(cols)
    for e in cols.findall(Q('col')):
        if int(e.get('min')) <= col <= int(e.get('max')):
            if e.get('min') == e.get('max') == str(col):
                e.set('width', str(width)); e.set('customWidth', '1')
            return
    e = etree.SubElement(cols, Q('col')); e.set('min', str(col)); e.set('max', str(col))
    e.set('width', str(width)); e.set('customWidth', '1')
    kids = sorted(cols.findall(Q('col')), key=lambda x: int(x.get('min')))
    for k in kids: cols.remove(k)
    for k in kids: cols.append(k)

def build_ua_table(wb, tab, sched, lines, beds, basis):
    """Write the tenant-paid UA table to the right of the tab's used range, top row = schedule header row - 1.
    beds = sorted bedroom counts the subject has. Returns ({bed: total ref}, table range)."""
    sh = wb.sheet(tab)
    c0 = _max_col(wb, tab) + 2; r0 = max(1, sched['header_row'] - 1)
    beds = [b for b in beds if b in sched['bedcols']]
    hdr = lambda b: 'Studio' if b == 0 else '%d BR' % b
    s_title = make_style(wb, 0, bold=True)
    s_head = make_style(wb, 0, bold=True, bottom='thin', halign='center')
    s_headl = make_style(wb, 0, bold=True, bottom='thin')
    s_num = make_style(wb, 0, numfmt='$#,##0')
    s_blue = _blue(wb, s_num)
    s_tot = make_style(wb, 0, numfmt='$#,##0', bold=True, top='thin')
    s_totl = make_style(wb, 0, bold=True, top='thin')
    def put(r, c, v, s):
        sh.set(ref(r, c), v); sh.cell(ref(r, c)).set('s', str(s))
    put(r0, c0, 'Tenant-Paid Utility Allowance (%s)' % (sched['unit_type'] or 'schedule above'), s_title)
    put(r0 + 1, c0, 'Utility', s_headl)
    for j, b in enumerate(beds): put(r0 + 1, c0 + 1 + j, hdr(b), s_head)
    r = r0 + 2
    for l in lines:
        name = NAMES.get(l['cat'], l['label'])
        if l['fuel']: name += ' - ' + FUELN.get(l['fuel'], l['fuel'])
        put(r, c0, name, 0)
        for j, b in enumerate(beds):
            src = l['refs'].get(b)
            if b in l.get('text_vals', {}):          # number stored as text in the schedule: hardcode it (blue)
                put(r, c0 + 1 + j, l['text_vals'][b], s_blue)
            else:
                put(r, c0 + 1 + j, ('=+' + src) if src else 0, s_num)
        r += 1
    put(r, c0, 'Total Utility Allowance', s_totl)
    totals = {}
    for j, b in enumerate(beds):
        cl = n2col(c0 + 1 + j)
        put(r, c0 + 1 + j, '=SUM(%s%d:%s%d)' % (cl, r0 + 2, cl, r - 1), s_tot)
        totals[b] = ref(r, c0 + 1 + j)
    put(r + 1, c0, 'Basis: ' + basis, 0)
    _col_width(wb, tab, c0, 30)
    return totals, '%s:%s' % (ref(r0, c0), ref(r + 1, c0 + len(beds)))

# ---------------------------------------------------------------- Rent Analysis wiring
def qn(tab): return "'" + tab.replace("'", "''") + "'"

def wire_rent_analysis(wb, tab, plan_beds, limits, ua_totals):
    """plan_beds = bedroom count per plan in Rent Analysis C10 order. Writes V (baths), AS (80% gross), AU (UA)."""
    ra = wb.sheet('Rent Analysis'); issues = []
    q = qn(tab) if tab else None
    for i, b in enumerate(plan_beds):
        r = 10 + i
        ra.set('V%d' % r, "=+'Floor Plan Summary'!G%d" % (r - 3))
        if q and b in limits.get('80%', {}):
            ra.set('AS%d' % r, '=+%s!%s' % (q, limits['80%'][b]))
        elif q and b in limits.get('60%', {}):
            ra.set('AS%d' % r, '=+%s!%s/6*8' % (q, limits['60%'][b]))
            issues.append('row %d: no 80%% column, 80%% = 60%% limit / 6 x 8' % r)
        else:
            issues.append('row %d: no rent limit for %s bedrooms' % (r, b))
        if b in ua_totals:
            ra.set('AU%d' % r, '=+%s!%s' % (q, ua_totals[b]))
        elif ua_totals:
            issues.append('row %d: no UA column for %s bedrooms' % (r, b))
    return issues
