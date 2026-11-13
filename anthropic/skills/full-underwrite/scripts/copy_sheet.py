"""Copy one worksheet from another .xlsx into an xlsx_xml.Workbook, package-preserving.
Brings: cell values/formulas (shared strings -> inline), styles (remapped; theme colors -> rgb), column widths,
row heights, merges, sheet view/zoom, page setup, images (drawing + media). Drops: charts, comments, controls,
conditional formatting, tables, extLst. Formulas that point at other sheets / external books become values."""
import zipfile, re, copy, posixpath, colorsys, difflib
from lxml import etree
from xlsx_xml import Q, NS, RNS

PR = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
T_SHEET = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'
T_DRAW = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing'
T_IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

def _rels(files, part):
    d, b = posixpath.split(part); rp = posixpath.join(d, '_rels', b + '.rels')
    if rp not in files: return rp, {}
    root = etree.fromstring(files[rp])
    return rp, {r.get('Id'): (r.get('Type'), r.get('Target'), r.get('TargetMode')) for r in root}

def _resolve(part, target):
    if target.startswith('/'): return target[1:]
    return posixpath.normpath(posixpath.join(posixpath.dirname(part), target))

def _theme_rgb(files):
    """theme index -> 'RRGGBB' using Excel's order (0=lt1, 1=dk1, 2=lt2, 3=dk2, 4-9 accents, 10 hlink, 11 folHlink)."""
    th = [n for n in files if n.startswith('xl/theme/theme')]
    if not th: return {}
    root = etree.fromstring(files[sorted(th)[0]])
    cs = root.find('.//{%s}clrScheme' % A)
    get = {}
    for el in cs:
        tag = el.tag.split('}')[1]; c = el[0]
        get[tag] = c.get('lastClr') or c.get('val')
    order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
    return {i: get.get(k, '000000') for i, k in enumerate(order)}

def _tint(rgb, tint):
    r, g, b = (int(rgb[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = l * (1 + tint) if tint < 0 else l * (1 - tint) + tint
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return '%02X%02X%02X' % tuple(round(x * 255) for x in (r, g, b))

def _fix_colors(el, theme):
    for c in el.iter():
        if not isinstance(c.tag, str): continue
        if c.get('theme') is not None and c.tag.split('}')[1] in ('color', 'fgColor', 'bgColor'):
            base = theme.get(int(c.get('theme')), '000000'); t = float(c.get('tint', '0'))
            for k in ('theme', 'tint'): c.attrib.pop(k, None)
            c.set('rgb', 'FF' + (_tint(base, t) if t else base))

class _StyleMap:
    def __init__(self, sfiles, dwb):
        self.ss = etree.fromstring(sfiles['xl/styles.xml'])
        if not hasattr(dwb, '_st'):
            dwb._st = etree.fromstring(dwb.files['xl/styles.xml']); dwb._stcache = {}
        self.dwb = dwb; self.ds = dwb._st; self.theme = _theme_rgb(sfiles); self.map = {}
        self.snf = {n.get('numFmtId'): n.get('formatCode') for n in (self.ss.find(Q('numFmts')) if self.ss.find(Q('numFmts')) is not None else [])}

    def _add(self, coll, el):
        lst = self.ds.find(Q(coll)); el = copy.deepcopy(el); _fix_colors(el, self.theme)
        key = etree.tostring(el)
        for i, e in enumerate(lst):
            if etree.tostring(e) == key: return i
        lst.append(el); lst.set('count', str(len(lst))); return len(lst) - 1

    def _numfmt(self, fid):
        if int(fid) < 164: return fid                      # built-in
        code = self.snf.get(fid)
        if code is None: return '0'
        nfs = self.ds.find(Q('numFmts'))
        if nfs is None: nfs = etree.Element(Q('numFmts')); self.ds.insert(0, nfs)
        for nf in nfs:
            if nf.get('formatCode') == code: return nf.get('numFmtId')
        nid = str(max([int(n.get('numFmtId')) for n in nfs] + [200]) + 1)
        e = etree.SubElement(nfs, Q('numFmt')); e.set('numFmtId', nid); e.set('formatCode', code)
        nfs.set('count', str(len(nfs))); return nid

    def __call__(self, s):
        s = str(s or 0)
        if s in self.map: return self.map[s]
        xf = copy.deepcopy(self.ss.find(Q('cellXfs'))[int(s)])
        xf.set('numFmtId', self._numfmt(xf.get('numFmtId', '0')))
        for attr, coll in (('fontId', 'fonts'), ('fillId', 'fills'), ('borderId', 'borders')):
            src = self.ss.find(Q(coll))[int(xf.get(attr, '0'))]
            xf.set(attr, str(self._add(coll, src)))
        xf.set('xfId', '0')
        xfs = self.ds.find(Q('cellXfs')); xfs.append(xf); xfs.set('count', str(len(xfs)))
        self.map[s] = str(len(xfs) - 1); return self.map[s]

    def flush(self):
        self.dwb.files['xl/styles.xml'] = etree.tostring(self.ds, xml_declaration=True, encoding='UTF-8', standalone=True)

def copy_sheet(src_path, src_name, wb, new_name, before=None):
    """Copy sheet `src_name` of src_path into wb (xlsx_xml.Workbook) as `new_name`, inserted before sheet `before`."""
    z = zipfile.ZipFile(src_path); sf = {n: z.read(n) for n in z.namelist()}
    swb = etree.fromstring(sf['xl/workbook.xml']); _, wrels = _rels(sf, 'xl/workbook.xml')
    sheet_el = [s for s in swb.iter(Q('sheet')) if s.get('name') == src_name][0]
    spart = _resolve('xl/workbook.xml', wrels[sheet_el.get('{%s}id' % RNS)][1])
    root = etree.fromstring(sf[spart]); _, srels = _rels(sf, spart)
    sst = []
    if 'xl/sharedStrings.xml' in sf:
        sst = list(etree.fromstring(sf['xl/sharedStrings.xml']).findall(Q('si')))
    sm = _StyleMap(sf, wb)
    # ---- cells
    for c in root.iter(Q('c')):
        if c.get('s') is not None: c.set('s', sm(c.get('s')))
        f = c.find(Q('f'))
        if f is not None and f.text and ('!' in f.text or '[' in f.text):   # cross-sheet / external -> value
            c.remove(f)
        if c.get('t') == 's':
            v = c.find(Q('v')); si = copy.deepcopy(sst[int(v.text)]); c.remove(v)
            si.tag = Q('is'); c.set('t', 'inlineStr')
            for r in si.findall(Q('rPh')) + si.findall(Q('phoneticPr')): si.remove(r)
            for rpr in si.iter(Q('rPr')): _fix_colors(rpr, sm.theme)
            c.append(si)
    for r in root.iter(Q('row')):
        if r.get('s') is not None: r.set('s', sm(r.get('s')))
    for col in root.iter(Q('col')):
        if col.get('style') is not None: col.set('style', sm(col.get('style')))
    # ---- drop parts we don't carry
    for tag in ('conditionalFormatting', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls',
                'tableParts', 'extLst', 'sheetProtection', 'printOptions', 'headerFooter', 'rowBreaks', 'colBreaks'):
        for el in root.findall(Q(tag)): root.remove(el)
    for hl in root.findall(Q('hyperlinks')): root.remove(hl)
    for sv in root.iter(Q('sheetView')): sv.attrib.pop('tabSelected', None)
    sp = root.find(Q('sheetPr'))
    if sp is not None:
        for tc in sp.findall(Q('tabColor')): _fix_colors(tc, sm.theme)
        sp.attrib.pop('codeName', None)
    ps = root.find(Q('pageSetup'))
    if ps is not None: ps.attrib.pop('{%s}id' % RNS, None)
    # ---- new part names
    n = 1
    while f'xl/worksheets/sheet{n}.xml' in wb.files: n += 1
    dpart = f'xl/worksheets/sheet{n}.xml'
    ct = etree.fromstring(wb.files['[Content_Types].xml'])
    def ct_override(part, ctype):
        o = etree.SubElement(ct, '{%s}Override' % CT); o.set('PartName', '/' + part); o.set('ContentType', ctype)
    def ct_default(ext, ctype):
        if not any(d.get('Extension', '').lower() == ext for d in ct.findall('{%s}Default' % CT)):
            d = etree.Element('{%s}Default' % CT); d.set('Extension', ext); d.set('ContentType', ctype); ct.insert(0, d)
    sheet_rels = []
    # ---- images (drawing + media); charts/shapes without pictures are dropped
    dr = root.find(Q('drawing'))
    if dr is not None:
        root.remove(dr)
        typ, tgt, _ = srels[dr.get('{%s}id' % RNS)]
        dsrc = _resolve(spart, tgt); droot = etree.fromstring(sf[dsrc]); _, drels = _rels(sf, dsrc)
        k = 1
        while f'xl/drawings/drawing{k}.xml' in wb.files: k += 1
        ddst = f'xl/drawings/drawing{k}.xml'; new_drels = []
        for anchor in list(droot):
            pics = anchor.findall('.//{%s}pic' % XDR)
            if not pics: droot.remove(anchor); continue
            for blip in anchor.iter('{%s}blip' % A):
                rid = blip.get('{%s}embed' % RNS)
                if rid not in drels: continue
                msrc = _resolve(dsrc, drels[rid][1]); ext = msrc.rsplit('.', 1)[-1].lower()
                m = 1
                while f'xl/media/image{m}.{ext}' in wb.files: m += 1
                mdst = f'xl/media/image{m}.{ext}'; wb.files[mdst] = sf[msrc]
                nid = f'rId{len(new_drels) + 1}'; new_drels.append((nid, T_IMG, '../media/' + mdst.split('/')[-1]))
                blip.set('{%s}embed' % RNS, nid)
                ct_default(ext, {'png': 'image/png', 'jpeg': 'image/jpeg', 'jpg': 'image/jpeg', 'gif': 'image/gif',
                                 'emf': 'image/x-emf', 'wmf': 'image/x-wmf'}.get(ext, 'image/' + ext))
            for el in anchor.iter('{%s}hlinkClick' % A): el.getparent().remove(el)
        if len(droot):
            wb.files[ddst] = etree.tostring(droot, xml_declaration=True, encoding='UTF-8', standalone=True)
            rr = etree.Element('{%s}Relationships' % PR)
            for i, t, g in new_drels:
                e = etree.SubElement(rr, '{%s}Relationship' % PR); e.set('Id', i); e.set('Type', t); e.set('Target', g)
            wb.files[f'xl/drawings/_rels/drawing{k}.xml.rels'] = etree.tostring(rr, xml_declaration=True, encoding='UTF-8', standalone=True)
            ct_override(ddst, 'application/vnd.openxmlformats-officedocument.drawing+xml')
            sheet_rels.append(('rId1', T_DRAW, f'../drawings/drawing{k}.xml'))
            d = etree.Element(Q('drawing')); d.set('{%s}id' % RNS, 'rId1')
            # schema order: drawing goes before legacyDrawing/picture/oleObjects/.../extLst; after pageSetup/headerFooter/breaks
            after = None
            for tag in ('pageSetup', 'pageMargins', 'printOptions', 'hyperlinks', 'dataValidations', 'mergeCells',
                        'phoneticPr', 'sheetData'):
                after = root.find(Q(tag))
                if after is not None: break
            after.addnext(d)
    wb.files[dpart] = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    if sheet_rels:
        rr = etree.Element('{%s}Relationships' % PR)
        for i, t, g in sheet_rels:
            e = etree.SubElement(rr, '{%s}Relationship' % PR); e.set('Id', i); e.set('Type', t); e.set('Target', g)
        wb.files[f'xl/worksheets/_rels/sheet{n}.xml.rels'] = etree.tostring(rr, xml_declaration=True, encoding='UTF-8', standalone=True)
    ct_override(dpart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')
    wb.files['[Content_Types].xml'] = etree.tostring(ct, xml_declaration=True, encoding='UTF-8', standalone=True)
    # ---- workbook rels + sheet list (+ shift sheet-local defined names / active tab)
    rels = etree.fromstring(wb.files['xl/_rels/workbook.xml.rels'])
    ids = {r.get('Id') for r in rels}; j = 1
    while f'rId{j}' in ids: j += 1
    e = etree.SubElement(rels, '{%s}Relationship' % PR); e.set('Id', f'rId{j}'); e.set('Type', T_SHEET)
    e.set('Target', f'worksheets/sheet{n}.xml')
    wb.files['xl/_rels/workbook.xml.rels'] = etree.tostring(rels, xml_declaration=True, encoding='UTF-8', standalone=True)
    wx = etree.fromstring(wb.files['xl/workbook.xml']); sheets = wx.find(Q('sheets')); lst = list(sheets)
    pos = len(lst)
    if before is not None:
        pos = [i for i, s in enumerate(lst) if s.get('name') == before][0]
    ns = etree.Element(Q('sheet')); ns.set('name', new_name)
    ns.set('sheetId', str(max(int(s.get('sheetId')) for s in lst) + 1)); ns.set('{%s}id' % RNS, f'rId{j}')
    sheets.insert(pos, ns)
    for dn in wx.iter(Q('definedName')):
        if dn.get('localSheetId') is not None and int(dn.get('localSheetId')) >= pos:
            dn.set('localSheetId', str(int(dn.get('localSheetId')) + 1))
    for bv in wx.iter(Q('workbookView')):
        for a in ('activeTab', 'firstSheet'):
            if bv.get(a) is not None and int(bv.get(a)) >= pos: bv.set(a, str(int(bv.get(a)) + 1))
    wb.files['xl/workbook.xml'] = etree.tostring(wx, xml_declaration=True, encoding='UTF-8', standalone=True)
    wb.sheetpath[new_name] = dpart
    sm.flush()
    return dpart


# ---------------- Novogradac county sheet selection ----------------
ALIASES = {'columbus metro': 'franklin', 'greensboro': 'guilford', 'plano': 'collin', 'elgin': 'kane'}
STATES = {'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI',
          'MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
          'VT','VA','WA','WV','WI','WY'}

def _sheet_county_year(name):
    t = name.lower()
    for k, v in ALIASES.items():
        if k in t and v not in t: t = v + ' ' + t
    county = re.split(r'\s+(county|conuty|cnty|co\.?)\b|\s+-\s+|,|\s+\d', t)[0].strip()
    yrs = [int(y) for y in re.findall(r'20(\d\d)', name)] or [int(y) for y in re.findall(r'(?<!\d)(\d\d)\s*$', name)]
    year = 2000 + max(yrs) if yrs else 0
    st = [w for w in re.findall(r'\b([A-Z]{2})\b', name) if w in STATES]
    return county, year, (st[0] if st else None)

def pick_novogradac_sheet(sheets, county, state):
    """sheets: [(name, hidden_bool)] in workbook order. county e.g. 'Tarrant' or 'Tarrant County'; state 'TX'.
    Returns (sheet_name, note) or (None, note). Newest year wins; visible beats hidden; 'OLD' sheets lose ties."""
    want = re.sub(r'\s+(county|parish)$', '', county.strip().lower())
    cands = []
    for name, hidden in sheets:
        c, y, st = _sheet_county_year(name)
        if c != want and difflib.SequenceMatcher(None, c, want).ratio() < 0.85: continue   # tolerate typos
        if st and state and st != state.upper(): continue
        cands.append((y, not hidden, 'old' not in name.lower(), name, st))
    if not cands:
        return None, f'No sheet for {county} County, {state} in the Novogradac workbook.'
    cands.sort(reverse=True); y, vis, _, name, st = cands[0]
    notes = []
    if y == 0: notes.append('no year in the sheet name')
    elif y < 2026: notes.append(f'newest {county} sheet is {y}, not 2026')
    if not vis: notes.append('picked sheet is hidden in the source workbook')
    return name, '; '.join(notes)

# ---------------- Fallback: rebuild a sheet from the M365 connector's text dump ----------------
def sheet_from_text(text, out_path, title):
    """text = one '## Sheet:' section of read_resource output (values tab-separated, then 'Formulas:').
    Builds a one-sheet xlsx (values + formulas + basic $/% formats, no original formatting) for copy_sheet()."""
    import openpyxl
    from openpyxl.utils import get_column_letter, column_index_from_string
    lines = text.splitlines()
    hdr = [l for l in lines if l.startswith('## Sheet:')][0]
    m = re.search(r'\(([A-Z]+)(\d+):', hdr); c0, r0 = column_index_from_string(m.group(1)), int(m.group(2))
    body = lines[lines.index(hdr) + 1:]
    fpos = body.index('Formulas:') if 'Formulas:' in body else len(body)
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = title[:31]; r = r0
    for l in body[:fpos]:
        em = re.match(r'\[(\d+) empty rows?\]$', l.strip())
        if em: r += int(em.group(1)); continue
        for j, v in enumerate(l.split('\t')):
            v = v.strip()
            if v == '': continue
            cell = ws.cell(r, c0 + j); num = v.replace('$', '').replace(',', '')
            try:
                if v.endswith('%'): cell.value = float(num[:-1]) / 100; cell.number_format = '0%'
                else:
                    cell.value = float(num) if '.' in num else int(num)
                    if '$' in v: cell.number_format = '$#,##0'
            except ValueError:
                cell.value = v
        r += 1
    for l in body[fpos + 1:]:
        fm = re.match(r'([A-Z]+\d+): (=.*)$', l.strip())
        if fm: ws[fm.group(1)] = fm.group(2)
    for j in range(1, ws.max_column + 1): ws.column_dimensions[get_column_letter(j)].width = 12
    wb.save(out_path); return ws.title
