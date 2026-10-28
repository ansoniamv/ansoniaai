"""Package-preserving cell writer for .xlsx: edits sheet XML only, so images, VML, controls and extensions survive."""
import zipfile, re, copy, datetime as dt
from lxml import etree

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
Q = lambda t: '{%s}%s' % (NS, t)

def col2n(c):
    n = 0
    for ch in c: n = n * 26 + ord(ch) - 64
    return n

def n2col(n):
    s = ''
    while n: n, r = divmod(n - 1, 26); s = chr(65 + r) + s
    return s

def split(ref):
    m = re.match(r'([A-Z]+)(\d+)$', ref); return m.group(1), int(m.group(2))

EXCEL_EPOCH = dt.datetime(1899, 12, 30)
def serial(d):
    if isinstance(d, dt.date) and not isinstance(d, dt.datetime): d = dt.datetime(d.year, d.month, d.day)
    return (d - EXCEL_EPOCH).days + (d - EXCEL_EPOCH).seconds / 86400

class Workbook:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.files = {n: self.z.read(n) for n in self.z.namelist()}
        wb = etree.fromstring(self.files['xl/workbook.xml'])
        rels = etree.fromstring(self.files['xl/_rels/workbook.xml.rels'])
        rmap = {r.get('Id'): r.get('Target') for r in rels}
        self.sheetpath = {}
        for s in wb.iter(Q('sheet')):
            t = rmap[s.get('{%s}id' % RNS)]
            self.sheetpath[s.get('name')] = t[1:] if t.startswith('/xl/') else 'xl/' + t.lstrip('/').replace('xl/', '')
        self.trees = {}

    def sheet(self, name):
        if name not in self.trees:
            self.trees[name] = Sheet(etree.fromstring(self.files[self.sheetpath[name]]))
        return self.trees[name]

    def save(self, out):
        for name, sh in self.trees.items():
            self.files[self.sheetpath[name]] = etree.tostring(sh.root, xml_declaration=True, encoding='UTF-8', standalone=True)
        self.files.pop('xl/calcChain.xml', None)
        ct = self.files['[Content_Types].xml'].decode()
        self.files['[Content_Types].xml'] = re.sub(r'<Override[^>]*calcChain[^>]*/>', '', ct).encode()
        rl = self.files['xl/_rels/workbook.xml.rels'].decode()
        self.files['xl/_rels/workbook.xml.rels'] = re.sub(r'<Relationship[^>]*calcChain[^>]*/>', '', rl).encode()
        wbx = self.files['xl/workbook.xml'].decode()
        if 'fullCalcOnLoad' not in wbx:
            wbx = re.sub(r'<calcPr ', '<calcPr fullCalcOnLoad="1" ', wbx, count=1)
        self.files['xl/workbook.xml'] = wbx.encode()
        with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zo:
            for n in self.z.namelist():
                if n in self.files: zo.writestr(self.z.getinfo(n), self.files[n])
            for n in self.files:                      # parts added during the build (e.g. copy_sheet)
                if n not in self.z.namelist(): zo.writestr(n, self.files[n])

class Sheet:
    def __init__(self, root):
        self.root = root
        self.data = root.find(Q('sheetData'))
        self.rows = {int(r.get('r')): r for r in self.data.findall(Q('row'))}

    def _row(self, r):
        if r in self.rows: return self.rows[r]
        el = etree.Element(Q('row')); el.set('r', str(r))
        later = [k for k in self.rows if k > r]
        if later: self.rows[min(later)].addprevious(el)
        else: self.data.append(el)
        self.rows[r] = el; return el

    def cell(self, ref, create=True):
        c, r = split(ref)
        row = self._row(r) if create else self.rows.get(r)
        if row is None: return None
        for el in row.findall(Q('c')):
            if el.get('r') == ref: return el
        if not create: return None
        el = etree.Element(Q('c')); el.set('r', ref); n = col2n(c)
        for other in row.findall(Q('c')):
            if col2n(split(other.get('r'))[0]) > n:
                other.addprevious(el); break
        else:
            row.append(el)
        return el

    @staticmethod
    def _wipe(el):
        for ch in list(el): el.remove(ch)
        if 't' in el.attrib: del el.attrib['t']

    def clear(self, rng):
        a, b = rng.split(':'); ca, ra = split(a); cb, rb = split(b); c1, c2 = col2n(ca), col2n(cb)
        for r in range(ra, rb + 1):
            row = self.rows.get(r)
            if row is None: continue
            for el in row.findall(Q('c')):
                if c1 <= col2n(split(el.get('r'))[0]) <= c2: self._wipe(el)

    def set(self, ref, value, style_from=None):
        """value: number, date, str, or '=formula'. None/'' clears. Keeps the cell's style."""
        el = self.cell(ref); self._wipe(el)
        if style_from is not None and el.get('s') is None:
            src = self.cell(style_from, create=False)
            if src is not None and src.get('s'): el.set('s', src.get('s'))
        if value is None or value == '': return
        if isinstance(value, (dt.date, dt.datetime)): value = serial(value)
        if isinstance(value, bool):
            el.set('t', 'b'); v = etree.SubElement(el, Q('v')); v.text = '1' if value else '0'
        elif isinstance(value, (int, float)):
            v = etree.SubElement(el, Q('v')); v.text = repr(float(value)) if isinstance(value, float) else str(value)
        elif isinstance(value, str) and value.startswith('='):
            f = etree.SubElement(el, Q('f')); f.text = value[1:]
        else:
            el.set('t', 'inlineStr'); is_ = etree.SubElement(el, Q('is')); t = etree.SubElement(is_, Q('t')); t.text = str(value)
            if t.text != t.text.strip(): t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')

def fill_style(wb, base_s, rgb):
    """cellXfs index = style base_s with a solid fill rgb (added to styles.xml once). Set with cell.set('s', str(idx))."""
    if not hasattr(wb, '_st'):
        wb._st = etree.fromstring(wb.files['xl/styles.xml']); wb._stcache = {}
    st = wb._st; key = (str(base_s), rgb)
    if key in wb._stcache: return wb._stcache[key]
    fills = st.find(Q('fills'))
    f = etree.SubElement(fills, Q('fill')); pf = etree.SubElement(f, Q('patternFill')); pf.set('patternType', 'solid')
    fg = etree.SubElement(pf, Q('fgColor')); fg.set('rgb', rgb); bg = etree.SubElement(pf, Q('bgColor')); bg.set('indexed', '64')
    fills.set('count', str(len(fills)))
    xfs = st.find(Q('cellXfs'))
    nx = copy.deepcopy(xfs[int(base_s or 0)]); nx.set('fillId', str(len(fills) - 1)); nx.set('applyFill', '1')
    xfs.append(nx); xfs.set('count', str(len(xfs)))
    wb._stcache[key] = len(xfs) - 1
    wb.files['xl/styles.xml'] = etree.tostring(st, xml_declaration=True, encoding='UTF-8', standalone=True)
    return wb._stcache[key]

def make_style(wb, base_s, numfmt=None, top=None, bottom=None, bold=None, halign=None):
    """cellXfs index derived from base_s with optional number format, top/bottom border style
    ('thin','medium','dashed','hair', or 'none'), bold font and horizontal alignment. Cached."""
    if not hasattr(wb, '_st'):
        wb._st = etree.fromstring(wb.files['xl/styles.xml']); wb._stcache = {}
    st = wb._st; key = ('ms', str(base_s), numfmt, top, bottom, bold, halign)
    if key in wb._stcache: return wb._stcache[key]
    import copy
    xfs = st.find(Q('cellXfs')); nx = copy.deepcopy(xfs[int(base_s or 0)])
    if numfmt is not None:
        nfs = st.find(Q('numFmts'))
        if nfs is None:
            nfs = etree.Element(Q('numFmts')); st.insert(0, nfs)
        fid = None
        for nf in nfs:
            if nf.get('formatCode') == numfmt: fid = nf.get('numFmtId')
        if fid is None:
            fid = str(max([int(n.get('numFmtId')) for n in nfs] + [200]) + 1)
            e = etree.SubElement(nfs, Q('numFmt')); e.set('numFmtId', fid); e.set('formatCode', numfmt)
            nfs.set('count', str(len(nfs)))
        nx.set('numFmtId', fid); nx.set('applyNumberFormat', '1')
    if top is not None or bottom is not None:
        borders = st.find(Q('borders'))
        nb = copy.deepcopy(borders[int(nx.get('borderId', '0'))])
        for side, val in (('top', top), ('bottom', bottom)):
            if val is None: continue
            el = nb.find(Q(side))
            if el is None:
                el = etree.SubElement(nb, Q(side))
            for ch in list(el): el.remove(ch)
            if val == 'none':
                el.attrib.pop('style', None)
            else:
                el.set('style', val); c = etree.SubElement(el, Q('color')); c.set('auto', '1')
        # keep child order left,right,top,bottom,diagonal
        order = ['left', 'right', 'top', 'bottom', 'diagonal', 'vertical', 'horizontal']
        kids = sorted(list(nb), key=lambda e: order.index(e.tag.split('}')[1]) if e.tag.split('}')[1] in order else 99)
        for k in list(nb): nb.remove(k)
        for k in kids: nb.append(k)
        borders.append(nb); borders.set('count', str(len(borders)))
        nx.set('borderId', str(len(borders) - 1)); nx.set('applyBorder', '1')
    if bold is not None:
        fonts = st.find(Q('fonts')); nf = copy.deepcopy(fonts[int(nx.get('fontId', '0'))])
        for b in nf.findall(Q('b')): nf.remove(b)
        if bold: nf.insert(0, etree.Element(Q('b')))
        fonts.append(nf); fonts.set('count', str(len(fonts)))
        nx.set('fontId', str(len(fonts) - 1)); nx.set('applyFont', '1')
    if halign is not None:
        al = nx.find(Q('alignment'))
        if al is None: al = etree.SubElement(nx, Q('alignment'))
        al.set('horizontal', halign); nx.set('applyAlignment', '1')
    xfs.append(nx); xfs.set('count', str(len(xfs)))
    wb._stcache[key] = len(xfs) - 1
    wb.files['xl/styles.xml'] = etree.tostring(st, xml_declaration=True, encoding='UTF-8', standalone=True)
    return wb._stcache[key]
