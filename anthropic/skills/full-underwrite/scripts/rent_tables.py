"""Rent Analysis: build the floorplan rent tables (full rent roll + one sorted block per floorplan) and
acquire market rents (AA = AVERAGE over a contiguous sample of each plan's sorted live effective rents, chosen so
FPS AE = AA - Recent-20 average stays under $55). Merged from Chase's build-floorplan-rent-tables /
acquire-market-rents(-sorted) skills."""
import copy, re, statistics, math
from lxml import etree
from xlsx_xml import Q, col2n, n2col

FIRST = 47          # first data row of the full rent roll and the floorplan blocks (headers on row 46)
LAST = 470          # bottom of the ranges the Unit Summary AVERAGEIF/MAXIFS formulas read
BLUE = 'FF0000FF'

def _font_style(wb, base_s, rgb):
    """cellXfs index = base_s with its font recolored to rgb."""
    if not hasattr(wb, '_st'):
        wb._st = etree.fromstring(wb.files['xl/styles.xml']); wb._stcache = {}
    st = wb._st; key = ('fc', str(base_s), rgb)
    if key in wb._stcache: return wb._stcache[key]
    xfs = st.find(Q('cellXfs')); nx = copy.deepcopy(xfs[int(base_s or 0)])
    fonts = st.find(Q('fonts')); nf = copy.deepcopy(fonts[int(nx.get('fontId', '0'))])
    for c in nf.findall(Q('color')): nf.remove(c)
    c = etree.Element(Q('color')); c.set('rgb', rgb)
    sz = nf.find(Q('sz'))
    (sz.addnext(c) if sz is not None else nf.insert(0, c))
    fonts.append(nf); fonts.set('count', str(len(fonts)))
    nx.set('fontId', str(len(fonts) - 1)); nx.set('applyFont', '1')
    xfs.append(nx); xfs.set('count', str(len(xfs)))
    wb._stcache[key] = len(xfs) - 1
    wb.files['xl/styles.xml'] = etree.tostring(st, xml_declaration=True, encoding='UTF-8', standalone=True)
    return wb._stcache[key]

def _text(wb, c):
    """Displayed text of a cell element (shared, inline or plain)."""
    if c.get('t') == 's':
        if not hasattr(wb, '_sst'):
            sst = etree.fromstring(wb.files['xl/sharedStrings.xml'])
            wb._sst = [''.join(si.itertext()) for si in sst.findall(Q('si'))]
        return wb._sst[int(c.find(Q('v')).text)]
    return ''.join(c.itertext())

def blocks(wb, ra):
    """[(unit_col, plan_col, rent_col)] from the row-46 headers, left to right, starting at column L."""
    out = []
    row = ra.rows.get(46)
    for c in row.findall(Q('c')):
        col = re.match(r'[A-Z]+', c.get('r')).group(0)
        t = _text(wb, c).strip().lower()
        if t == 'unit' and col2n(col) >= col2n('L'):
            out.append((col, n2col(col2n(col) + 1), n2col(col2n(col) + 2)))
    return out

def pick_window(vals, target, tol=55, min_frac=0.4, min_n=3):
    """vals: live rents ascending. Largest contiguous slice whose mean is within tol of target (FPS U, the
    Recent-20 in-place average); ties -> mean closest to target. At least min_frac of the units (min min_n).
    Returns (i, j, mean, ok); ok False = no qualifying slice gets under tol (closest min-size slice returned)."""
    n = len(vals)
    if n == 0: return None
    if target is None: return 0, n - 1, sum(vals) / n, True
    lo = min(n, max(min_n, math.ceil(n * min_frac)))
    pre = [0]
    for v in vals: pre.append(pre[-1] + v)
    best = None
    for size in range(n, lo - 1, -1):
        for i in range(0, n - size + 1):
            m = (pre[i + size] - pre[i]) / size; d = abs(m - target)
            if d < tol and (best is None or d < best[0]): best = (d, i, i + size - 1, m)
        if best: return best[1], best[2], best[3], True
    d, i = min((abs((pre[i + lo] - pre[i]) / lo - target), i) for i in range(0, n - lo + 1))
    return i, i + lo - 1, (pre[i + lo] - pre[i]) / lo, False

def build(wb, units, plans, beds_sf, recent20=None, tol=55):
    """units: [(unit_id:str, plan:str, ner:float, status:str)] in Units-tab order.
    plans: plan names in Rent Analysis C10.. order.  beds_sf: {plan: (beds, sf)} for estimates.
    recent20: {plan: FPS U (Recent-20 in-place average)} -> AA averages the pick_window() sample; None = all live rents.
    Returns a report dict."""
    from xlsx_xml import make_style
    ra = wb.sheet('Rent Analysis')
    txt = lambda s: str(make_style(wb, s, numfmt='@'))
    # ---- full rent roll (C:E)
    ra.clear(f'C{FIRST}:E{LAST}')
    for i, (u, *_rest) in enumerate(units):
        r = FIRST + i
        ra.set(f'C{r}', str(u), style_from=f'C{FIRST}'); el = ra.cell(f'C{r}'); el.set('s', txt(el.get('s')))
        ra.set(f'D{r}', f'=+_xlfn.XLOOKUP(C{r},Units!$D:$D,Units!$E:$E)', style_from=f'D{FIRST}')
        ra.set(f'E{r}', f'=+_xlfn.XLOOKUP(C{r},Units!$D:$D,Units!$P:$P)', style_from=f'E{FIRST}')
    bl = blocks(wb, ra)
    if len(plans) > len(bl): raise ValueError(f'{len(plans)} plans but only {len(bl)} rent blocks')
    rep = {'filled': [], 'estimates': [], 'outliers': [], 'nonrev_with_rent': [], 'sample': [], 'ae_over': []}
    avg = {}
    by_plan = {p: [x for x in units if x[1] == p] for p in plans}
    for i, p in enumerate(plans):
        uc, pc, rc = bl[i]
        ra.clear(f'{uc}{FIRST}:{rc}{LAST}')
        live = lambda x: x[3] != 'Non-Revenue' and (x[2] or 0) > 0
        # vacant / zero-rent and Non-Revenue units on top (excluded), then ascending NER, ties by unit
        rows = sorted(by_plan[p], key=lambda x: (live(x), x[2] or 0, str(x[0])))
        for j, (u, _, ner, st) in enumerate(rows):
            r = FIRST + j
            ra.set(f'{uc}{r}', str(u), style_from=f'{uc}{FIRST}'); el = ra.cell(f'{uc}{r}'); el.set('s', txt(el.get('s')))
            ra.set(f'{pc}{r}', f'=+_xlfn.XLOOKUP({uc}{r},Units!$D:$D,Units!$E:$E)', style_from=f'{pc}{FIRST}')
            ra.set(f'{rc}{r}', f'=+_xlfn.XLOOKUP({uc}{r},Units!$D:$D,Units!$P:$P)', style_from=f'{rc}{FIRST}')
            if st == 'Non-Revenue' and (ner or 0) > 0: rep['nonrev_with_rent'].append((p, u, ner))
        nz = [(FIRST + j, x[2]) for j, x in enumerate(rows) if live(x)]
        tgt = f'AA{10 + i}'
        if nz:
            vals = [v for _, v in nz]; med = statistics.median(vals)
            t = (recent20 or {}).get(p)
            i0, i1, m, ok = pick_window(vals, t, tol)
            f = f'=AVERAGE({rc}{nz[i0][0]}:{rc}{nz[i1][0]})'
            ra.set(tgt, f); avg[p] = m
            for (r, v), x in zip(nz, [x for x in rows if live(x)]):
                if v < 0.8 * med or v > 1.2 * med: rep['outliers'].append((p, x[0], round(v, 2), round(med)))
            rep['filled'].append((p, tgt, f, i1 - i0 + 1, len(nz)))
            if t is not None:
                rep['sample'].append((p, i1 - i0 + 1, len(nz), round(statistics.mean(vals) - t), round(m - t),
                                      vals[:i0], vals[i1 + 1:]))
                if not ok: rep['ae_over'].append((p, round(m - t)))
        else:
            rep['estimates'].append([p, tgt])
    # ---- plans with no rented units: estimate from same-bed neighbors by sf, hardcoded blue
    for e in rep['estimates']:
        p, tgt = e; b, sf = beds_sf[p]
        same = sorted([(beds_sf[q][1], avg[q], q) for q in avg if beds_sf[q][0] == b])
        lo = [x for x in same if x[0] <= sf]; hi = [x for x in same if x[0] >= sf]
        if lo and hi: v = (lo[-1][1] + hi[0][1]) / 2; why = f'between {lo[-1][2]} (${lo[-1][1]:,.0f}) and {hi[0][2]} (${hi[0][1]:,.0f})'
        elif same: n = lo[-1] if lo else hi[0]; v = n[1]; why = f'nearest same-bed plan {n[2]} (${n[1]:,.0f})'
        else: v = statistics.mean(avg.values()); why = 'property average (no same-bed plans with rent)'
        v = round(v)
        ra.set(tgt, v); el = ra.cell(tgt); el.set('s', str(_font_style(wb, el.get('s'), BLUE)))
        e += [v, 'Hardcoded estimate: no units with rent; ' + why]
    return rep
