"""Commercial space: Commercial Analysis tab + commercial rows on Pro Forma / Multi Yr (layout per 731 S Plymouth).

- expand_shared(wb): turn every shared formula into a plain formula (needed before rows are inserted).
- insert_rows(wb, sheet, at, n, style_row, max_col=None): workbook-wide row insert (formulas in every sheet, defined
  names, charts, drawings, VML/comments, merges, CF/DV, autofilter) - what Excel does on Insert. max_col limits it to
  columns A..max_col (Excel "shift cells down"), so side tables / data tables to the right stay put.
- build_sheet(path, tenants, yr1, vac=0.10): one-sheet xlsx 'Commercial Analysis': tenant blocks, Total,
  Commercial Vacancy Factor (10%) and "Total less Commercial Vacancy Factor".
- add_commercial(wb, tenants, yr1): copies the tab in before Value-Add, inserts 2 rows on Pro Forma (A:U only;
  28 Commercial = the tab's net total, 29 CAM) and Multi Yr (58 / 59), and rewires EGI. Run it LAST (after payroll /
  broker column / value-add), then recalc: every Pro Forma row >= 28 moves down 2 (EGI 29->31, Personnel 38->40,
  Total Expenses 53->55, NOI 56->58, Reserves 59->61, Net NOI 61->63) and Multi Yr rows >= 58 move down 2.
tenants = [dict(name, sf, psf, growth=[10 rates for years 2-11] or 0.03, rents=None, cycle='Oct 1 (10/1)', expiry=date|str)]
  rents (optional): annual rent by year from the lease's rent schedule (up to 11 values) -> hardcoded blue, PSF and
  growth derived from them (as Plymouth does); years past the list grow at `growth`.
"""
import re, copy, posixpath, datetime as dt
from lxml import etree
from xlsx_xml import Q, col2n, n2col, split

TOK = re.compile(r"(\"[^\"]*\")|"                                        # string literal
                 r"((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?"       # optional sheet prefix
                 r"(?<![A-Za-z0-9_.$])"
                 r"(?:(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])"      # cell
                 r"|(\$?)([A-Z]{1,3}):(\$?)([A-Z]{1,3})(?![A-Za-z0-9_(]))")  # column range

def _sheet_of(prefix):
    if not prefix: return None
    s = prefix[:-1]
    return s[1:-1].replace("''", "'") if s.startswith("'") else s

def _walk(text, fn):
    """fn(sheet, kind, parts) -> replacement string or None."""
    out, pos = [], 0
    for m in TOK.finditer(text):
        if m.group(1):                                  # string literal, leave
            continue
        sheet = _sheet_of(m.group(2))
        if m.group(4):
            rep = fn(sheet, 'cell', (m.group(3), m.group(4), m.group(5), int(m.group(6))))
        else:
            rep = fn(sheet, 'cols', (m.group(7), m.group(8), m.group(9), m.group(10)))
        if rep is None: continue
        out.append(text[pos:m.start()]); out.append((m.group(2) or '') + rep); pos = m.end()
    out.append(text[pos:]); return ''.join(out)

def shift_rows_text(text, here, target, at, n, max_col=None):
    def fn(sheet, kind, p):
        if kind != 'cell': return None
        if (sheet or here) != target: return None
        d1, c, d2, r = p
        if r < at or (max_col and col2n(c) > max_col): return None
        return f'{d1}{c}{d2}{r + n}'
    return _walk(text, fn)

def offset_text(text, dr, dc):
    """shared-formula child: move relative refs by (dr, dc)."""
    def fn(sheet, kind, p):
        if kind == 'cell':
            d1, c, d2, r = p
            c2 = c if d1 else n2col(col2n(c) + dc); r2 = r if d2 else r + dr
            return f'{d1}{c2}{d2}{r2}'
        d1, a, d2, b = p
        return f'{d1}{a if d1 else n2col(col2n(a) + dc)}:{d2}{b if d2 else n2col(col2n(b) + dc)}'
    return _walk(text, fn)

def expand_shared(wb):
    for name in wb.sheetpath:
        sh = wb.sheet(name); masters = {}
        for c in sh.root.iter(Q('c')):
            f = c.find(Q('f'))
            if f is not None and f.get('t') == 'shared' and f.get('ref') and f.text:
                masters[f.get('si')] = (c.get('r'), f.text)
        for c in sh.root.iter(Q('c')):
            f = c.find(Q('f'))
            if f is None or f.get('t') != 'shared': continue
            mr, mt = masters[f.get('si')]
            (mc, mrow), (cc, crow) = split(mr), split(c.get('r'))
            if c.get('r') != mr: f.text = offset_text(mt, crow - mrow, col2n(cc) - col2n(mc))
            for a in ('t', 'si', 'ref'): f.attrib.pop(a, None)

def _rels(wb, part):
    d, b = posixpath.split(part); rp = posixpath.join(d, '_rels', b + '.rels')
    if rp not in wb.files: return {}
    out = {}
    for r in etree.fromstring(wb.files[rp]):
        out.setdefault(r.get('Type').rsplit('/', 1)[-1], []).append(posixpath.normpath(posixpath.join(d, r.get('Target'))))
    return out

def _sq(s, at, n, max_col=None):
    def one(x):
        ps = x.split(':'); ms = [re.match(r'(\$?)([A-Z]{1,3})(\$?)(\d+)$', p) for p in ps]
        if max_col and any(m and col2n(m.group(2)) > max_col for m in ms): return x
        return ':'.join(f'{m.group(1)}{m.group(2)}{m.group(3)}{int(m.group(4)) + n if int(m.group(4)) >= at else m.group(4)}' if m else p
                        for p, m in zip(ps, ms))
    return ' '.join(one(x) for x in s.split())

def insert_rows(wb, target, at, n, style_row, max_col=None):
    """Insert n rows before `at` on `target`. max_col (1-based) limits the insert to columns A..max_col
    (Excel 'shift cells down'): cells/refs right of it stay put (side tables, data tables)."""
    inside = lambda col: not max_col or col2n(col) <= max_col
    for name in wb.sheetpath:
        sh = wb.sheet(name)
        for f in sh.root.iter(Q('f')):
            if f.text: f.text = shift_rows_text(f.text, name, target, at, n, max_col)
            if f.get('ref') and name == target: f.set('ref', _sq(f.get('ref'), at, n, max_col))
        for el in sh.root.iter(Q('formula'), '{http://schemas.microsoft.com/office/excel/2006/main}f'):
            if el.text: el.text = shift_rows_text(el.text, name, target, at, n, max_col)
    sh = wb.sheet(target); root = sh.root
    tmpl = {re.match(r'[A-Z]+', c.get('r')).group(0): c.get('s') for c in (sh.rows[style_row] if style_row in sh.rows else [])}   # read before anything moves
    moving = []
    for r in sorted(sh.rows):
        if r < at: continue
        for c in list(sh.rows[r].findall(Q('c'))):
            col = re.match(r'[A-Z]+', c.get('r')).group(0)
            if inside(col): sh.rows[r].remove(c); moving.append((r, col, c))
    if not max_col:                                      # whole rows: move row elements (keeps heights)
        for row in sorted(sh.data.findall(Q('row')), key=lambda e: -int(e.get('r'))):
            if int(row.get('r')) >= at: row.set('r', str(int(row.get('r')) + n))
        sh.rows = {int(e.get('r')): e for e in sh.data.findall(Q('row'))}
    def put(r, col, c):
        row = sh._row(r); c.set('r', f'{col}{r}'); k = col2n(col)
        for o in row.findall(Q('c')):
            if col2n(re.match(r'[A-Z]+', o.get('r')).group(0)) > k: o.addprevious(c); return
        row.append(c)
    for r, col, c in sorted(moving, key=lambda x: (x[0], col2n(x[1]))): put(r + n, col, c)
    for k in range(n):
        for col, s in tmpl.items():
            if not inside(col): continue
            c = etree.Element(Q('c'))
            if s: c.set('s', s)
            put(at + k, col, c)
    for tag, attr in (('mergeCell', 'ref'), ('autoFilter', 'ref'), ('selection', 'sqref'), ('selection', 'activeCell'),
                      ('pane', 'topLeftCell'), ('conditionalFormatting', 'sqref'), ('dataValidation', 'sqref'), ('hyperlink', 'ref')):
        for el in root.iter(Q(tag)):
            if el.get(attr): el.set(attr, _sq(el.get(attr), at, n, max_col))
    for el in root.iter('{http://schemas.microsoft.com/office/excel/2006/main}sqref'):
        if el.text: el.text = _sq(el.text, at, n, max_col)
    if not max_col:
        for b in root.iter(Q('brk')):
            if int(b.get('id')) >= at: b.set('id', str(int(b.get('id')) + n))
    wx = wb.files['xl/workbook.xml'].decode()
    wx = re.sub(r'(<definedName[^>]*>)([^<]*)(</definedName>)',
                lambda m: m.group(1) + shift_rows_text(m.group(2), None, target, at, n, max_col) + m.group(3), wx)
    wb.files['xl/workbook.xml'] = wx.encode()
    for p in [p for p in wb.files if re.match(r'xl/charts/chart\d+\.xml$', p)]:
        x = wb.files[p].decode()
        x = re.sub(r'(<(?:c|c15):f>)([^<]+)(</(?:c|c15):f>)', lambda m: m.group(1) + shift_rows_text(m.group(2), None, target, at, n, max_col) + m.group(3), x)
        wb.files[p] = x.encode()
    rels = _rels(wb, wb.sheetpath[target])
    for p in rels.get('drawing', []):
        x = wb.files[p].decode()
        def frm(m):
            col = int(re.search(r'<xdr:col>(\d+)', m.group(0)).group(1))
            if max_col and col + 1 > max_col: return m.group(0)
            return re.sub(r'(<xdr:row>)(\d+)(</xdr:row>)', lambda q: q.group(1) + str(int(q.group(2)) + n if int(q.group(2)) + 1 >= at else int(q.group(2))) + q.group(3), m.group(0))
        x = re.sub(r'<xdr:(?:from|to)>.*?</xdr:(?:from|to)>', frm, x, flags=re.S)
        wb.files[p] = x.encode()
    for p in rels.get('vmlDrawing', []):
        x = wb.files[p].decode('utf-8', 'ignore')
        def anc(m):
            v = [int(s) for s in m.group(2).replace('\r', '').replace('\n', '').split(',')]
            if max_col and v[0] + 1 > max_col: return m.group(0)
            for i in (2, 6):
                if v[i] + 1 >= at: v[i] += n
            return m.group(1) + ', '.join(map(str, v))
        x = re.sub(r'(<x:Anchor>\s*)([\d,\s]+)', anc, x)
        def rc(m):
            row, col = int(m.group(2)), int(m.group(4))
            if (max_col and col + 1 > max_col) or row + 1 < at: return m.group(0)
            return m.group(1) + str(row + n) + m.group(3) + m.group(4)
        x = re.sub(r'(<x:Row>)(\d+)(</x:Row>\s*<x:Column>)(\d+)', rc, x)
        wb.files[p] = x.encode()
    for p in rels.get('comments', []) + rels.get('threadedComment', []):
        x = wb.files[p].decode()
        x = re.sub(r'ref="([A-Z]+\d+)"', lambda m: 'ref="%s"' % _sq(m.group(1), at, n, max_col), x)
        wb.files[p] = x.encode()

# ------------------------------------------------------------------ the Commercial Analysis tab
def build_sheet(path, tenants, yr1, vac=0.10):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Commercial Analysis'
    ws.sheet_view.showGridLines = False; ws.sheet_properties.tabColor = '92D050'
    for c, w in {'A': 1.71, 'B': 8.71, 'C': 31.57, 'D': 10.71, 'P': 1.71, 'Q': 17.29, 'R': 15.71}.items(): ws.column_dimensions[c].width = w
    for i in range(5, 16): ws.column_dimensions[n2col(i)].width = 15.71
    NAVY = PatternFill('solid', fgColor='FF002752'); W = Font(bold=True, color='FFFFFFFF'); B = Font(bold=True)
    BLUE = Font(color='FF0000FF'); thin = Side(style='thin')
    USD = '"$"#,##0_);[Red]\\("$"#,##0\\)'; USD2 = '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)'
    ctr = Alignment(horizontal='center')
    ws['C2'] = '=+_Property'; ws['C2'].font = Font(bold=True, size=14)
    ws['C3'] = 'Commercial Analysis'; ws['C3'].font = Font(bold=True, size=10)
    for c in range(3, 16): ws.cell(3, c).border = Border(bottom=thin)
    ws['C6'] = f'Assuming Yr1 Begins 1/1/{str(yr1)[-2:]}'; ws['C6'].font = B
    for c in range(3, 19):
        if c == 16: continue
        for r in (7, 8): ws.cell(r, c).fill = NAVY; ws.cell(r, c).font = W
    ws['E7'] = yr1; ws['E8'] = 1; ws['C8'] = 'Tenant'; ws['Q7'] = 'Lease Cycle'; ws['R7'] = 'Lease Expiry'
    for i in range(6, 16):
        L, P = n2col(i), n2col(i - 1); ws[f'{L}7'] = f'=+{P}7+1'; ws[f'{L}8'] = f'=+{P}8+1'
    for i in range(5, 16):
        ws.cell(7, i).alignment = ctr; ws.cell(8, i).alignment = ctr; ws.cell(8, i).number_format = '"Year "\\ 0'
    for c in ('Q7', 'R7'): ws[c].alignment = ctr
    r = 10; rent_rows = []
    for t in tenants:
        ws.cell(r, 3, t['name']).font = B
        ws.cell(r + 1, 3, 'PSF'); ws.cell(r + 2, 3, 'Growth')
        ws.cell(r + 1, 4, t['sf']).font = BLUE; ws.cell(r + 1, 4).number_format = '#,##0" sf"'; ws.cell(r + 1, 4).alignment = ctr
        g = t.get('growth', 0.03); g = g if isinstance(g, list) else [g] * 10
        rents = t.get('rents') or []
        ws.cell(r + 2, 5, 'N/A')
        for i in range(5, 16):
            L, P = n2col(i), n2col(i - 1); k = i - 5
            if k < len(rents):                                   # lease rent schedule: hardcoded rent, derived PSF / growth
                ws[f'{L}{r}'] = rents[k]; ws[f'{L}{r}'].font = BLUE
                ws[f'{L}{r + 1}'] = f'=+{L}{r}/$D${r + 1}'
                if i > 5: ws[f'{L}{r + 2}'] = f'=+({L}{r + 1}-{P}{r + 1})/{P}{r + 1}'
            else:                                                # PSF x SF, grown at the growth rate
                ws[f'{L}{r}'] = f'=+$D{r + 1}*{L}{r + 1}'
                if i == 5: ws[f'{L}{r + 1}'] = t['psf']; ws[f'{L}{r + 1}'].font = BLUE
                else:
                    ws[f'{L}{r + 1}'] = f'=+{P}{r + 1}*(1+{L}{r + 2})'
                    ws[f'{L}{r + 2}'] = g[k - 1]; ws[f'{L}{r + 2}'].font = BLUE
            ws[f'{L}{r}'].number_format = USD; ws[f'{L}{r}'].alignment = ctr
            ws[f'{L}{r + 1}'].number_format = USD2; ws[f'{L}{r + 1}'].alignment = ctr
            ws[f'{L}{r + 2}'].number_format = '0.00%'; ws[f'{L}{r + 2}'].alignment = ctr
        ws.cell(r, 17, t.get('cycle', '')); ws.cell(r, 18, t.get('expiry', ''))
        if isinstance(t.get('expiry'), (dt.date, dt.datetime)): ws.cell(r, 18).number_format = 'mm-dd-yy'
        rent_rows.append(r); r += 4
    tot = r; vrow = tot + 2; net = tot + 4
    ws.cell(tot, 3, 'Total').font = B
    ws.cell(tot, 4, '=+' + '+'.join(f'D{x + 1}' for x in rent_rows)); ws.cell(tot, 4).number_format = '#,##0" sf"'
    ws.cell(vrow, 3, 'Commercial Vacancy Factor')
    ws.cell(vrow, 4, vac).font = BLUE; ws.cell(vrow, 4).number_format = '0%'; ws.cell(vrow, 4).alignment = ctr
    ws.cell(net, 3, 'Total less Commercial Vacancy Factor').font = B
    for i in range(4, 16):
        L = n2col(i)
        if i >= 5:
            ws[f'{L}{tot}'] = '=+' + '+'.join(f'{L}{x}' for x in rent_rows)
            ws[f'{L}{vrow}'] = f'=+{L}{tot}*-$D${vrow}'; ws[f'{L}{vrow}'].number_format = USD; ws[f'{L}{vrow}'].alignment = ctr
            ws[f'{L}{net}'] = f'=+{L}{tot}+{L}{vrow}'; ws[f'{L}{net}'].number_format = USD
        for rr in (tot, net):
            ws[f'{L}{rr}'].font = B; ws[f'{L}{rr}'].alignment = ctr; ws[f'{L}{rr}'].border = Border(top=thin)
        if i >= 5: ws[f'{L}{tot}'].number_format = USD
    wb.save(path)
    return net

PF_AT, MY_AT, N = 28, 58, 2
LINES = ['Commercial', 'CAM']

def add_commercial(wb, tenants, yr1, tmp='/tmp/commercial_tab.xlsx', before='Value-Add', vac=0.10, growth=0.03):
    """Returns the row map. Pro Forma O28 = the tab's 'Total less Commercial Vacancy Factor' (Year 1)."""
    from copy_sheet import copy_sheet
    net = build_sheet(tmp, tenants, yr1, vac)
    copy_sheet(tmp, 'Commercial Analysis', wb, 'Commercial Analysis', before=before)
    expand_shared(wb)
    insert_rows(wb, 'Pro Forma', PF_AT, N, style_row=24, max_col=col2n('U'))
    insert_rows(wb, 'Multi Yr', MY_AT, N, style_row=54)
    P = wb.sheet('Pro Forma'); egi = PF_AT + N + 1                          # 31
    last = PF_AT + N - 1                                                    # 29 (CAM)
    sumif = lambda sh, col, r: (f"=IF(SUMIF('{sh}'!$D:$D,'Pro Forma'!$C{r},'{sh}'!{col}:{col})=0,0,"
                                f"SUMIF('{sh}'!$D:$D,'Pro Forma'!$C{r},'{sh}'!{col}:{col}))")
    rows = {}
    for k, lab in enumerate(LINES):
        r = PF_AT + k; rows[lab] = r
        P.set(f'C{r}', lab); P.set(f'D{r}', f'=+G{r}/Units')
        P.set(f'E{r}', sumif('T12 PRIOR (2)', 'AC', r)); P.set(f'F{r}', sumif('T12 PRIOR', 'AC', r))
        P.set(f'G{r}', sumif('T12', 'AC', r)); P.set(f'H{r}', sumif('T12', 'T', r)); P.set(f'N{r}', growth)
        P.set(f'Q{r}', f'=IF(O{r}="","",O{r}/Units)'); P.set(f'R{r}', f'=IF(O{r}="","",O{r}/Units/12)')
        P.set(f'S{r}', f'=IF(O{r}="","",O{r}/Overview!$D$14)'); P.set(f'T{r}', f'=IF(O{r}="","",O{r}/$O${egi})')
    rc, rcam = rows['Commercial'], rows['CAM']
    P.set(f'O{rc}', f"=+'Commercial Analysis'!E{net}")
    P.set(f'O{rcam}', f'=G{rcam}*(1+N{rcam})')
    for c in 'EFGHIJKO':
        P.set(f'{c}{egi}', f'=+SUM({c}23:{c}{last},{c}20)')
    P.set('W22', f'=SUM(G23:G{last})')                                      # side table: T12 other inc. incl. commercial
    M = wb.sheet('Multi Yr'); off = MY_AT - PF_AT                           # 30
    m_egi = egi + off; years = [n2col(i) for i in range(col2n('L'), col2n('V') + 1)]
    mc, mcam = rc + off, rcam + off
    for r in (mc, mcam):
        M.set(f'E{r}', f"=IF('Pro Forma'!C{r - off}=\"\",\"\",'Pro Forma'!C{r - off})")
    M.set(f'L{mcam}', f"=IFERROR(VLOOKUP(E{mcam},'Pro Forma'!$C$13:$O${62 + N},$L$37,FALSE),\"\")")
    for i, c in enumerate(years):
        M.set(f'{c}{mc}', f"=+'Commercial Analysis'!{n2col(col2n('E') + i)}{net}")   # L = Year 1 ... V = Year 11
        if i:
            M.set(f'{c}{mcam}', f'={years[i - 1]}{mcam}*(1+VLOOKUP($L$6,$E$10:$V$12,{c}$8,FALSE))')
            M.set(f'{c}{m_egi}', f'=+SUM({c}53:{c}{mcam},{c}50)')
    return dict(tab_net_row=net, pf_rows=rows, pf_egi=egi, my_rows={'Commercial': mc, 'CAM': mcam}, my_egi=m_egi)
