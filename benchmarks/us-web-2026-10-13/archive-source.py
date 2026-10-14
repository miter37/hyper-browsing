from pathlib import Path
import json, hashlib, zipfile

base=Path(__file__).resolve().parent
root=base.parent.parent
v=json.loads((base/'versions.json').read_text(encoding='utf-8'))
manifest={}
with zipfile.ZipFile(base/'source-snapshot.zip','w',zipfile.ZIP_DEFLATED) as z:
 for name,expected in v['sourceHashes'].items():
  data=(root/name).read_bytes()
  actual=hashlib.sha256(data).hexdigest()
  if actual!=expected:raise RuntimeError('Product changed: '+name)
  z.writestr('hyper-browsing/'+name,data);manifest['hyper-browsing/'+name]=actual
 for name in ['docs/COMMANDS.md','docs/EXECUTION.md','docs/BROWSER.md','package-lock.json','bin/webctl.cmd','LICENSE']:
  p=root/name
  if p.exists():
   data=p.read_bytes();z.writestr('hyper-browsing/'+name,data);manifest['hyper-browsing/'+name]=hashlib.sha256(data).hexdigest()
 package=Path('D:/APPs/browser-use/.venv/Lib/site-packages/browser_harness')
 for name,expected in v['browserUseHashes'].items():
  source=(package.parent/'browser_use'/name) if name=='cli.py' else package/name
  archive=('browser-use/' if name=='cli.py' else 'browser-harness/')+name
  data=source.read_bytes();actual=hashlib.sha256(data).hexdigest()
  if actual!=expected:raise RuntimeError('CLI changed: '+name)
  z.writestr(archive,data);manifest[archive]=actual
 for dist,folder in [('browser_use-0.13.11.dist-info','browser-use'),('browser_harness-0.1.13.dist-info','browser-harness')]:
  licenses=package.parent/dist/'licenses'
  if licenses.exists():
   for p in licenses.rglob('*'):
    if p.is_file():
     name=folder+'/licenses/'+p.relative_to(licenses).as_posix();data=p.read_bytes()
     z.writestr(name,data);manifest[name]=hashlib.sha256(data).hexdigest()
 z.writestr('SHA256.json',json.dumps(manifest,indent=2))
(base/'source-verification.json').write_text(json.dumps({'verifiedAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'frozenProductFiles':len(v['sourceHashes']),'frozenCLIFiles':len(v['browserUseHashes']),'mismatches':[],'archiveFiles':len(manifest)},indent=2),encoding='utf-8')
print(json.dumps({'verifiedProductFiles':len(v['sourceHashes']),'verifiedCLIFiles':len(v['browserUseHashes']),'archiveFiles':len(manifest)}))
