"""Write LibreOffice results into the cached <v> of formula cells so the file displays correctly before Excel recalculates.
Usage: inject_cache.py out.xlsx qc.xlsx final.xlsx "Sheet1|Sheet2" <Overview D14 value>"""
import sys, datetime as dt, warnings, openpyxl
from lxml import etree
from xlsx_xml import Workbook, Q, serial
warnings.filterwarnings('ignore')
src, qc, out = sys.argv[1:4]
SHEETS = sys.argv[4].split('|')
vals = openpyxl.load_workbook(qc, data_only=True)
wb = Workbook(src)
OVR = {('Overview', 'D14'): float(sys.argv[5])} if len(sys.argv) > 5 else {}
n = 0
for name in SHEETS:
    sh = wb.sheet(name); lv = vals[name]
    for c in sh.root.iter(Q('c')):
        if c.find(Q('f')) is None: continue
        v = OVR.get((name, c.get('r')), lv[c.get('r')].value)
        if isinstance(v, str) and v.startswith('#'): continue
        if v is None: v = ''
        old = c.find(Q('v'))
        if old is not None: c.remove(old)
        for ch in c.findall(Q('is')): c.remove(ch)
        ve = etree.SubElement(c, Q('v'))
        if isinstance(v, bool): c.set('t', 'b'); ve.text = '1' if v else '0'
        elif isinstance(v, (int, float)): c.attrib.pop('t', None); ve.text = repr(float(v))
        elif isinstance(v, (dt.datetime, dt.date)): c.attrib.pop('t', None); ve.text = repr(float(serial(v)))
        else: c.set('t', 'str'); ve.text = str(v)
        n += 1
wb.save(out)
print('cached', n)
