"""AP Comps rent-comp tables + scatter charts (Studio / 1BR / 2BR / 3BR+), package-preserving.

Template layout (AP Comps): each table = title row, header row, data rows, scatter chart to the right (cols K:AJ).
  Studio: title 25, header 26, data 27-50 (rows grouped/hidden by default), chart4
  1 BR  : title 54, header 55, data 56-95, chart5 (per-point labels -> C cells)
  2 BR  : title 97, header 98, data 99-140, chart3 (labels via datalabels range G)
Columns: C name, D sq ft, E avg asking rent, F =IFERROR(E/D,""), G =C&" "&TEXT(F,"- $0.00").
"""
import re, copy, math
from lxml import etree
from xlsx_xml import Q, col2n, n2col

SHEET = 'AP Comps'
SUBJ_FILL = (869, 870, 871, 872)     # highlighted (light blue) C, D, E, F/G styles in the template
PLAIN = (275, 276, 277, 278)         # plain bordered data-row styles
BLACK, BLUE = 'FF000000', 'FF0000FF'
REF = re.compile(r"((?:'[^']+'|[A-Za-z_][A-Za-z0-9_\.]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])")

# ---------------------------------------------------------------- helpers
def _font(wb, s, rgb):
    from rent_tables import _font_style
    return _font_style(wb, s, rgb)

def _shift_formula(f, at, n, this=SHEET):
    """Shift A1 refs (in-sheet or 'AP Comps'!-qualified) with row >= at by n."""
    def rep(m):
        pre, d1, col, d2, row = m.groups()
        if pre and pre.strip("!'") != this: return m.group(0)
        if '"' in (pre or ''): return m.group(0)
        r = int(row)
        return f"{pre or ''}{d1}{col}{d2}{r + n if r >= at else r}"
    # don't touch text inside string literals
    parts = re.split(r'("[^"]*")', f)
    return ''.join(p if p.startswith('"') else REF.sub(rep, p) for p in parts)

def _shift_sqref(s, at, n):
    def one(ref):
        out = []
        for part in ref.split(':'):
            m = re.match(r'(\$?[A-Z]{1,3}\$?)(\d+)$', part)
            if not m: out.append(part); continue
            r = int(m.group(2)); out.append(f"{m.group(1)}{r + n if r >= at else r}")
        return ':'.join(out)
    return ' '.join(one(x) for x in s.split())

def drawing_part(wb):
    sp = wb.sheetpath[SHEET]; rels = sp.replace('worksheets/', 'worksheets/_rels/') + '.rels'
    t = re.search(r'Target="\.\./drawings/(drawing\d+\.xml)"', wb.files[rels].decode())
    return 'xl/drawings/' + t.group(1)

def chart_parts(wb):
    dp = drawing_part(wb); rels = dp.replace('drawings/', 'drawings/_rels/') + '.rels'
    rmap = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="\.\./charts/(chart\d+\.xml)"', wb.files[rels].decode()))
    rmap.update({k: v for v, k in re.findall(r'Target="\.\./charts/(chart\d+\.xml)"[^>]*Id="(rId\d+)"', wb.files[rels].decode())})
    return dp, {k: 'xl/charts/' + v for k, v in rmap.items()}

# ---------------------------------------------------------------- insert rows
def insert_rows(wb, at, n):
    """Insert n blank rows before row `at` on AP Comps; shift everything at/below (cells, formulas, merges,
    autofilter, drawing anchors, chart refs, defined names). New rows copy row at-1's cell styles."""
    sh = wb.sheet(SHEET); root = sh.root
    for row in sorted(sh.data.findall(Q('row')), key=lambda r: -int(r.get('r'))):
        r = int(row.get('r'))
        if r >= at:
            row.set('r', str(r + n))
            for c in row.findall(Q('c')):
                col = re.match(r'[A-Z]+', c.get('r')).group(0); c.set('r', f'{col}{r + n}')
    for f in root.iter(Q('f')):
        if f.text: f.text = _shift_formula(f.text, at, n)
        if f.get('ref'): f.set('ref', _shift_sqref(f.get('ref'), at, n))
    for tag, attr in (('mergeCell', 'ref'), ('autoFilter', 'ref'), ('dimension', 'ref'), ('selection', 'sqref'),
                      ('conditionalFormatting', 'sqref'), ('dataValidation', 'sqref')):
        for el in root.iter(Q(tag)):
            if el.get(attr): el.set(attr, _shift_sqref(el.get(attr), at, n))
    # new rows (styles from row at-1)
    tmpl = sh.rows.get(at - 1)
    sh.rows = {int(r.get('r')): r for r in sh.data.findall(Q('row'))}
    for k in range(n):
        r = at + k; new = copy.deepcopy(tmpl); new.set('r', str(r))
        for c in new.findall(Q('c')):
            col = re.match(r'[A-Z]+', c.get('r')).group(0); c.set('r', f'{col}{r}')
            for ch in list(c): c.remove(ch)
            c.attrib.pop('t', None)
        later = [x for x in sh.rows if x > r]
        sh.rows[min(later)].addprevious(new) if later else sh.data.append(new)
        sh.rows[r] = new
    # drawing anchors (0-based rows)
    dp, charts = chart_parts(wb)
    d = wb.files[dp].decode()
    def anch(m):
        v = int(m.group(2)); return f"{m.group(1)}{v + n if v + 1 >= at else v}{m.group(3)}"
    d = re.sub(r'(<xdr:row>)(\d+)(</xdr:row>)', anch, d); wb.files[dp] = d.encode()
    for cp in charts.values():
        x = wb.files[cp].decode()
        x = re.sub(r'(<(?:c|c15):f>)([^<]+)(</(?:c|c15):f>)', lambda m: m.group(1) + _shift_formula(m.group(2), at, n) + m.group(3), x)
        wb.files[cp] = x.encode()
    wx = wb.files['xl/workbook.xml'].decode()
    wx = re.sub(r"(<definedName[^>]*>)([^<]*'AP Comps'![^<]*)(</definedName>)",
                lambda m: m.group(1) + _shift_formula(m.group(2), at, n) + m.group(3), wx)
    wb.files['xl/workbook.xml'] = wx.encode()

# ---------------------------------------------------------------- tables
def find_tables(wb):
    """{key: (title_row, header_row, first, last)}; key 'Studio' or beds (int). Titles are C-column labels
    (STUDIO / 1 BEDROOM / 2 BEDROOM ...); the data range (first..last) comes from the table's chart x-values."""
    from rent_tables import _text
    sh = wb.sheet(SHEET); out = {}
    for r, row in sorted(sh.rows.items()):
        c = next((c for c in row.findall(Q('c')) if c.get('r') == f'C{r}'), None)
        if c is None: continue
        t = _text(wb, c).strip().upper()
        m = re.match(r'^(STUDIO|(\d+) BEDROOM)', t)
        if not m: continue
        key = 'Studio' if m.group(1) == 'STUDIO' else int(m.group(2))
        cp = chart_for_table(wb, r + 1)
        last = r + 41
        if cp:
            mm = re.search(r"<c:xVal><c:numRef><c:f>'AP Comps'!\$D\$%d:\$D\$(\d+)" % (r + 2), wb.files[cp].decode())
            last = int(mm.group(1))
        out[key] = (r, r + 1, r + 2, last)
    return out

def chart_for_table(wb, header_row):
    """Chart part whose x-values start at D(header_row+1)."""
    dp, charts = chart_parts(wb)
    for rid, cp in charts.items():
        x = wb.files[cp].decode()
        if re.search(r"<c:xVal><c:numRef><c:f>'AP Comps'!\$D\$%d:" % (header_row + 1), x): return cp
    return None

def _set_row(sh, wb, r, name, sf, rent, subject):
    st = SUBJ_FILL if subject else PLAIN
    col = BLACK if subject else BLUE
    cells = [('C', name, st[0]), ('D', sf, st[1]), ('E', rent, st[2]),
             ('F', f'=IFERROR(E{r}/D{r},"")', st[3]), ('G', f'=C{r}&" "&TEXT(F{r},"- $0.00")', st[3])]
    for c, v, s in cells:
        sh.set(f'{c}{r}', v); el = sh.cell(f'{c}{r}')
        el.set('s', str(_font(wb, s, col if c in 'CDE' else BLACK)))

def _clear_row(sh, wb, r, last):
    st = PLAIN
    for c, s in zip('CDEFG', (st[0], st[1], st[2], st[3], st[3])):
        sh.set(f'{c}{r}', None); sh.cell(f'{c}{r}').set('s', str(s))

def _axis(wb, cp, xs, ys):
    """Fit the scatter's axis min/max to the data (x by 50 sf, y by $100)."""
    if not xs or not ys: return
    x0 = math.floor((min(xs) - 25) / 50) * 50; x1 = math.ceil((max(xs) + 25) / 50) * 50
    y0 = math.floor((min(ys) - 50) / 100) * 100; y1 = math.ceil((max(ys) + 50) / 100) * 100
    s = wb.files[cp].decode(); scal = list(re.finditer(r'<c:scaling>.*?</c:scaling>', s))
    vals = [(x0, x1), (y0, y1)]
    for m, (lo, hi) in sorted(zip(scal[:2], vals), key=lambda t: -t[0].start()):
        new = f'<c:scaling><c:orientation val="minMax"/><c:max val="{hi}"/><c:min val="{lo}"/></c:scaling>'
        s = s[:m.start()] + new + s[m.end():]
    wb.files[cp] = s.encode()

def _relabel(wb, cp, first, last):
    """Charts with per-point labels (c:dLbl with <c:tx><c:strRef>): one label per row first..last, pointing at C."""
    s = wb.files[cp].decode()
    if "<c:dLbl><c:idx" not in s or "<c:strRef><c:f>'AP Comps'!$C$" not in s: return
    dl = re.findall(r'<c:dLbl>.*?</c:dLbl>', s, re.S)
    lab = [d for d in dl if "'AP Comps'!$C$" in d]
    if not lab: return
    tmpl = lab[-1]; out = []
    for i, r in enumerate(range(first, last + 1)):
        d = re.sub(r'<c:idx val="\d+"/>', f'<c:idx val="{i}"/>', tmpl, count=1)
        d = re.sub(r"'AP Comps'!\$C\$\d+", f"'AP Comps'!$C${r}", d)
        d = re.sub(r'<c16:uniqueId val="\{[0-9A-F]{8}', lambda m: '<c16:uniqueId val="{%08X' % (0x100 + i), d)
        out.append(d)
    a = s.find(lab[0]); b = s.rfind(lab[-1]) + len(lab[-1])
    s = s[:a] + ''.join(out) + s[b:]
    wb.files[cp] = s.encode()

def fill(wb, by_bed, studio_present):
    """by_bed: {key ('Studio' or int beds): [(name, sf, rent, subject, sf_formula, rent_formula)]}.
    Rows are sorted by rent descending (as prior models). Subject rows write the Rent Analysis formulas."""
    sh = wb.sheet(SHEET); report = {}
    # extra 3BR+ tables are cloned below the last table (see add_table); grow tables that are too small
    for key in sorted(by_bed, key=lambda k: -1 if k == 'Studio' else k, reverse=True):   # bottom-up so shifts don't move pending tables
        tabs = find_tables(wb)
        if key not in tabs: continue
        t, h, first, last = tabs[key]
        need = len(by_bed[key]) - (last - first + 1)
        if need > 0:
            insert_rows(wb, last, need); sh = wb.sheet(SHEET)
    tabs = find_tables(wb)
    for key, rows in by_bed.items():
        t, h, first, last = tabs[key]
        cp = chart_for_table(wb, h)
        rows = sorted(rows, key=lambda x: -(x[2] or 0))
        for i in range(first, last + 1): _clear_row(sh, wb, i, last)
        for i, (name, sf, rent, subj, ff, rf) in enumerate(rows):
            _set_row(sh, wb, first + i, name, ff if (subj and ff) else sf, rf if (subj and rf) else rent, subj)
        if cp:
            s = wb.files[cp].decode()
            s = re.sub(r"('AP Comps'!\$[DEG]\$)%d(:\$[DEG]\$)(\d+)" % first, lambda m: f"{m.group(1)}{first}{m.group(2)}{last}", s)
            s = re.sub(r'(<(?:c:numCache|c15:dlblRangeCache)>(?:<c:formatCode>[^<]*</c:formatCode>)?)<c:ptCount val="\d+"/>',
                       lambda m: m.group(1) + f'<c:ptCount val="{last - first + 1}"/>', s)
            wb.files[cp] = s.encode()
            _relabel(wb, cp, first, last)
            _axis(wb, cp, [x[1] for x in rows if x[1]], [x[2] for x in rows if x[2]])
        report[key] = (first, first + len(rows) - 1, len(rows), cp)
    # studio group: show it only if the property has studios
    tabs = find_tables(wb)
    if 'Studio' in tabs:
        t, h, first, last = tabs['Studio']
        for r in range(h, last + 1):
            row = sh.rows.get(r)
            if row is None: continue
            if studio_present: row.attrib.pop('hidden', None)
            else: row.set('hidden', '1')
        nxt = sh.rows.get(last + 1)
        if nxt is not None:
            if studio_present: nxt.attrib.pop('collapsed', None)
            else: nxt.set('collapsed', '1')
    return report

def add_table(wb, beds):
    """Clone the 2 BEDROOM block (title..last data row + its chart) to 3 rows below the lowest table, titled
    '<beds> BEDROOM'. Returns the new table's rows."""
    sh = wb.sheet(SHEET); tabs = find_tables(wb)
    src = tabs[2]; low = max(v[3] for v in tabs.values())
    off = low + 3 - src[0]
    for r in range(src[0], src[3] + 1):
        row = sh.rows.get(r)
        if row is None: continue
        new = copy.deepcopy(row); nr = r + off; new.set('r', str(nr))
        for c in new.findall(Q('c')):
            col = re.match(r'[A-Z]+', c.get('r')).group(0); c.set('r', f'{col}{nr}')
            f = c.find(Q('f'))
            if f is not None:
                c.remove(f); v = c.find(Q('v'))
                if v is not None: c.remove(v)
                c.attrib.pop('t', None)
        later = [x for x in sh.rows if x > nr]
        sh.rows[min(later)].addprevious(new) if later else sh.data.append(new)
        sh.rows[nr] = new
    sh.set(f'C{src[0] + off}', f'{beds} BEDROOM')
    # chart clone
    dp, charts = chart_parts(wb); cp = chart_for_table(wb, src[1])
    k = 1
    while f'xl/charts/chart{k}.xml' in wb.files: k += 1
    ncp = f'xl/charts/chart{k}.xml'
    x = wb.files[cp].decode()
    x = re.sub(r'(<(?:c|c15):f>)([^<]+)(</(?:c|c15):f>)', lambda m: m.group(1) + _shift_formula(m.group(2), 1, off) + m.group(3), x)
    x = x.replace('2 Bedroom', f'{beds} Bedroom')
    wb.files[ncp] = x.encode()
    crels = cp.replace('charts/', 'charts/_rels/') + '.rels'
    if crels in wb.files: wb.files[ncp.replace('charts/', 'charts/_rels/') + '.rels'] = wb.files[crels]
    ct = wb.files['[Content_Types].xml'].decode()
    ct = ct.replace('</Types>', f'<Override PartName="/{ncp}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>')
    wb.files['[Content_Types].xml'] = ct.encode()
    drels = dp.replace('drawings/', 'drawings/_rels/') + '.rels'
    rx = wb.files[drels].decode(); j = 1
    while f'Id="rId{j}"' in rx: j += 1
    rx = rx.replace('</Relationships>', f'<Relationship Id="rId{j}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart{k}.xml"/></Relationships>')
    wb.files[drels] = rx.encode()
    d = wb.files[dp].decode()
    rid = [r for r, p in charts.items() if p == cp][0]
    anchors = re.findall(r'<xdr:twoCellAnchor.*?</xdr:twoCellAnchor>', d, re.S)
    a = [a for a in anchors if f'r:id="{rid}"' in a][0]
    na = re.sub(r'(<xdr:row>)(\d+)(</xdr:row>)', lambda m: f"{m.group(1)}{int(m.group(2)) + off}{m.group(3)}", a)
    na = na.replace(f'r:id="{rid}"', f'r:id="rId{j}"')
    na = re.sub(r'<xdr:cNvPr id="(\d+)"', lambda m: f'<xdr:cNvPr id="{1000 + k}"', na)
    d = d.replace('</xdr:wsDr>', na + '</xdr:wsDr>'); wb.files[dp] = d.encode()
    wx = wb.files['xl/workbook.xml'].decode()
    wx = re.sub(r"('AP Comps'!\$B\$2:\$AQ\$)(\d+)", lambda m: m.group(1) + str(max(int(m.group(2)), src[3] + off)), wx)
    wb.files['xl/workbook.xml'] = wx.encode()
    return find_tables(wb)[beds]
