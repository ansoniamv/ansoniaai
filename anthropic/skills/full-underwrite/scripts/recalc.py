import subprocess, time, sys, os, uno
from com.sun.star.beans import PropertyValue
src, dst = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
p = subprocess.Popen(['soffice', '--headless', '--invisible', '--norestore',
                      '--accept=socket,host=localhost,port=2002;urp;'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ctx = None
for _ in range(60):
    try:
        local = uno.getComponentContext()
        res = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        ctx = res.resolve('uno:socket,host=localhost,port=2002;urp;StarOffice.ComponentContext'); break
    except Exception: time.sleep(1)
desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
def pv(n, v): x = PropertyValue(); x.Name = n; x.Value = v; return x
doc = desktop.loadComponentFromURL('file://' + src, '_blank', 0, (pv('Hidden', True),))
doc.calculateAll(); doc.calculateAll()
doc.storeToURL('file://' + dst, (pv('FilterName', 'Calc MS Excel 2007 XML'),))
doc.close(True)
try: desktop.terminate()
except Exception: pass
p.wait(timeout=60)
print('ok')
