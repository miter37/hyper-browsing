from pathlib import Path
import base64, html, json, re, zipfile

base=Path(__file__).resolve().parent
md=(base/'report.ko.md').read_text(encoding='utf-8')
rows=json.loads((base/'results-live.json').read_text(encoding='utf-8'))

def inline(s):
 s=html.escape(s)
 s=re.sub(r'\*\*(.+?)\*\*',r'<strong>\1</strong>',s)
 s=re.sub(r'`(.+?)`',r'<code>\1</code>',s)
 s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<a href="\2">\1</a>',s)
 return s

parts=[];lines=md.splitlines();i=0
while i<len(lines):
 line=lines[i]
 if not line.strip(): i+=1;continue
 if line.startswith('#'):
  level=len(line)-len(line.lstrip('#'));parts.append(f'<h{level}>{inline(line[level:].strip())}</h{level}>');i+=1;continue
 if line.startswith('| '):
  group=[]
  while i<len(lines) and lines[i].startswith('| '):group.append(lines[i]);i+=1
  cells=lambda l:[c.strip() for c in l.strip().strip('|').split('|')]
  parts.append('<div class="table-wrap"><table><thead><tr>'+''.join('<th scope="col">'+inline(c)+'</th>' for c in cells(group[0]))+'</tr></thead><tbody>')
  for row in group[2:]:parts.append('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in cells(row))+'</tr>')
  parts.append('</tbody></table></div>');continue
 if line.startswith('!['):
  m=re.match(r'!\[([^\]]*)\]\(([^)]+)\)',line);data=base64.b64encode((base/m[2]).read_bytes()).decode();parts.append(f'<figure><img alt="{html.escape(m[1])}" src="data:image/png;base64,{data}"></figure>');i+=1;continue
 if line.startswith('- '):
  parts.append('<ul>')
  while i<len(lines) and lines[i].startswith('- '):parts.append('<li>'+inline(lines[i][2:])+'</li>');i+=1
  parts.append('</ul>');continue
 para=[]
 while i<len(lines) and lines[i].strip():para.append(lines[i]);i+=1
 parts.append('<p>'+inline(' '.join(para))+'</p>')

parts.append('<h2>60개 시행 상세 지표</h2><p>사이트·방법·상태로 필터링할 수 있습니다. 비도구 시간은 순수 사고 시간이 아닙니다.</p><label for="filter">시행 검색</label><input id="filter" type="search" placeholder="예: amazon, hb, blocked"><div class="table-wrap"><table id="trials"><thead><tr>')
headers=['시행','상태','점수','과업 초','브라우저 명령','전체 도구 호출','에이전트 초','비도구 초','추론 토큰','headed 전환']
parts.append(''.join('<th scope="col">'+h+'</th>' for h in headers)+'</tr></thead><tbody>')
for r in rows:
 fields=[r['id'],r['status'],str(r['checkpointScore'])+'/4',f"{r['taskWallMs']/1000:.1f}",r['browserCommandCount'],r['agentToolCalls'],f"{r['agentWallMs']/1000:.1f}",f"{r['nonToolMs']/1000:.1f}",r.get('tokenUsage',{}).get('reasoning_output_tokens','NA'),r['headedSwitches']]
 parts.append('<tr>'+''.join('<td>'+html.escape(str(v))+'</td>' for v in fields)+'</tr>')
parts.append('</tbody></table></div>')
css='''body{margin:0;background:#f1f5f9;color:#172033;font:16px/1.8 "Malgun Gothic",sans-serif}main{max-width:1100px;margin:36px auto;padding:48px;background:white;border-radius:16px;box-shadow:0 4px 30px #0f172a0c}h1{font-size:34px;line-height:1.3;color:#0f172a;border-bottom:4px solid #0d9488;padding-bottom:24px}h2{font-size:23px;margin-top:48px;color:#0f172a}p{margin:16px 0}a{color:#1d4ed8}code{background:#f1f5f9;padding:2px 5px;border-radius:4px}.table-wrap{overflow:auto;margin:20px 0}table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.6}th{background:#0f172a;color:white;text-align:left;white-space:nowrap;padding:12px}td{border-bottom:1px solid #e2e8f0;padding:11px;vertical-align:top}tr:nth-child(even){background:#f8fafc}figure{margin:28px 0}img{width:100%;height:auto}input{padding:10px 14px;border:1px solid #94a3b8;border-radius:6px;margin-left:12px;min-width:260px}#trials td{white-space:nowrap}strong{color:#0f172a}@media(max-width:700px){main{margin:0;padding:20px;border-radius:0}h1{font-size:27px}}@media print{body{background:white;font-size:11px}main{margin:0;padding:0;box-shadow:none;max-width:none}h2{break-after:avoid;margin-top:25px}table{font-size:9px}thead{display:table-header-group}tr,figure{break-inside:avoid}.table-wrap{overflow:visible}input,label{display:none}img{max-height:500px;object-fit:contain}}'''
doc='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>미국 비SNS 사이트 브라우징 비교 · 60회</title><style>'+css+'</style><main>'+''.join(parts)+'</main><script>document.getElementById("filter").addEventListener("input",e=>{const q=e.target.value.toLowerCase();for(const r of document.querySelectorAll("#trials tbody tr"))r.hidden=!r.textContent.toLowerCase().includes(q)});</script></html>'
(base/'report.html').write_text(doc,encoding='utf-8')
files=['README.ko.md','report.html','report.ko.md','results.csv','summary.json','evidence.json','protocol.md','scenarios.json','agent-guide.md','browser-use-skill.txt','versions.json','invalid-trials.json','improvement-candidates.ko.md','success-by-site.png','successful-pairs-time.png','source-snapshot.zip','source-verification.json','verification.json','control.mjs','collect.mjs','analyze.mjs','report.mjs','figures.py','publish.py','archive-source.py','verify.mjs']
with zipfile.ZipFile(base/'public-report.zip','w',zipfile.ZIP_DEFLATED) as z:
 for f in files:z.write(base/f,f)
print(json.dumps({'reportHTMLBytes':len(doc.encode()),'packageFiles':len(files)},ensure_ascii=False))
