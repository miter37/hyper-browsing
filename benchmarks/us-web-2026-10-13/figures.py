import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

base=Path(__file__).resolve().parent
s=json.loads((base/'summary.json').read_text(encoding='utf-8'))
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'white','savefig.facecolor':'white'})
names={'google':'Google','amazon':'Amazon','walmart':'Walmart','ebay':'eBay','bestbuy':'Best Buy','booking':'Booking.com','expedia':'Expedia','wikipedia':'Wikipedia','weather':'Weather.com','imdb':'IMDb'}
colors=['#2563eb','#0d9488']
fig,ax=plt.subplots(figsize=(10,6.5))
y=np.arange(10)
for i,m in enumerate(['bu','hb']):
 bars=ax.barh(y+(i-.5)*.32,[a[m]['strictSuccess'] for a in s['sites']],height=.3,color=colors[i],label=['A: browser-use CLI','B: hyper-browsing'][i])
 ax.bar_label(bars,padding=4,fontsize=9)
ax.set(yticks=y,yticklabels=[names[a['site']] for a in s['sites']],xlim=(0,3.3),xticks=[0,1,2,3],xlabel='Strict successes / 3 trials per site and method',title='All four checkpoints verified')
ax.set_title('All four checkpoints verified',pad=60)
ax.invert_yaxis();ax.legend(loc='upper center',bbox_to_anchor=(.5,1.13),ncol=2,frameon=False);ax.grid(axis='x',alpha=.15);ax.set_axisbelow(True)
fig.tight_layout();fig.savefig(base/'success-by-site.png',dpi=180);plt.close(fig)
p=s['successfulPairs']
fig,ax=plt.subplots(figsize=(10,6))
for i,row in enumerate(p):
 ax.plot([row['buMs']/1000,row['hbMs']/1000],[i,i],color='#cbd5e1',lw=2,zorder=1)
ax.scatter([r['buMs']/1000 for r in p],range(len(p)),color=colors[0],label='A: browser-use CLI',s=45,zorder=2)
ax.scatter([r['hbMs']/1000 for r in p],range(len(p)),color=colors[1],label='B: hyper-browsing',s=45,zorder=2)
ax.set(yticks=range(len(p)),yticklabels=[f"{names[r['site']]} R{r['repeat']}" for r in p],xlabel='Task wall time (seconds; browser preparation excluded)',title=f'Both methods succeeded: {len(p)} matched site/repeat pairs')
ax.invert_yaxis();ax.legend();ax.grid(axis='x',alpha=.15);ax.set_axisbelow(True)
fig.tight_layout();fig.savefig(base/'successful-pairs-time.png',dpi=180);plt.close(fig)
