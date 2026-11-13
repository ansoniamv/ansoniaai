"""Make a LibreOffice-friendly QC copy: LO 24.2 has no XLOOKUP, so rewrite simple 3-argument
_xlfn.XLOOKUP(a,b,c) as INDEX(c,MATCH(a,b,0)) in every sheet. Only the QC copy changes;
the delivered file keeps its XLOOKUPs. Usage: lo_compat.py in.xlsx out.xlsx"""
import sys, re, zipfile
PAT = re.compile(r"_xlfn\.XLOOKUP\(([^(),]+),([^(),]+),([^(),]+)\)")
src, dst = sys.argv[1:3]
zi = zipfile.ZipFile(src)
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zo:
    n = 0
    for info in zi.infolist():
        data = zi.read(info.filename)
        if info.filename.startswith('xl/worksheets/sheet') and info.filename.endswith('.xml'):
            s = data.decode('utf-8'); s, k = PAT.subn(r'INDEX(\3,MATCH(\1,\2,0))', s); n += k; data = s.encode('utf-8')
        zo.writestr(info, data)
print('rewrote', n, 'XLOOKUPs')
