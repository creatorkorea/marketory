"""Read-only image inspection and document/token validation; writes manifests."""
from pathlib import Path
import hashlib,json,re
from urllib.parse import unquote
from PIL import Image
from build_tokens import read_tokens,artifacts,ROOT

def luminance(h):
    rgb=[int(h[i:i+2],16)/255 for i in (1,3,5)]
    vals=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    return sum(x*y for x,y in zip(vals,[.2126,.7152,.0722]))

def contrast(a,b):
    lo,hi=sorted([luminance(a),luminance(b)])
    return (hi+.05)/(lo+.05)

data=read_tokens();c=data['colors'];checks=[]
pairs=[('text','background',4.5),('text-secondary','background',4.5),('text','surface',4.5),('text-secondary','surface',4.5),('on-primary','primary',4.5),('on-primary','primary-hover',4.5),('on-primary','primary-pressed',4.5),('on-primary','danger',4.5),('primary','selected',4.5),('disabled-text','disabled',4.5),('control-border','surface',3),('control-border','background',3),('focus','surface',3),('focus','background',3)]
pairs += [(x,x+'-bg',4.5) for x in ['success','warning','danger','info','neutral']]
pairs += [('text',x,4.5) for x in c if x.startswith('tag-')]
for a,b,minimum in pairs:
    ratio=contrast(c[a],c[b]);checks.append({'foreground':a,'background':b,'ratio':round(ratio,2),'minimum':minimum,'passed':ratio>=minimum})
assert all(x['passed'] for x in checks),[x for x in checks if not x['passed']]
for name,content in artifacts(data).items():assert (ROOT/name).read_text(encoding='utf-8')==content,name
font=ROOT/'assets/fonts/PretendardVariable.woff2';assert font.read_bytes()[:4]==b'wOF2'
assert 'SIL OPEN FONT LICENSE' in (ROOT/'assets/fonts/OFL.txt').read_text(encoding='utf-8').upper()
assets=[]
for f in sorted((ROOT/'assets').rglob('*')):
    if not f.is_file():continue
    item={'path':f.relative_to(ROOT).as_posix(),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}
    if f.suffix=='.png':
        with Image.open(f) as im:
            item.update(width=im.width,height=im.height,mode=im.mode)
            if 'brand' in f.parts:
                assert 'A' in im.getbands(),'Brand missing alpha'
                alpha=im.getchannel('A');hist=alpha.histogram();item['transparent_fraction']=round(hist[0]/(im.width*im.height),4)
                item['alpha_extrema']=alpha.getextrema();assert hist[0]>0 and sum(hist[1:])>0
                item['usage']='transparent brand PNG; pair with live Pretendard text'
            else:item['usage']='reference board only; not runtime controls'
    assets.append(item)
docs=[ROOT.parent/'DESIGN.md',ROOT.parent/'UX-CONTRACT.md',ROOT/'README.md',ROOT/'COMPONENTS.md',ROOT/'generation-briefs.md']
links=[]
for doc in docs:
    for link in re.findall(r'\]\(([^)]+)\)',doc.read_text(encoding='utf-8')):
        if '://' in link or link.startswith('#'):continue
        dest=(doc.parent/unquote(link.split('#')[0])).resolve();assert dest.exists(),(doc,link)
        links.append(link)
for url in re.findall(r'(?:href|src)="([^"]+)"',(ROOT/'preview.html').read_text(encoding='utf-8')):
    if url.startswith('#'):continue
    assert (ROOT/url).exists(),url
assert len(list((ROOT/'assets/boards').glob('*.png')))==3
assert all(f'C{n:02}' in (ROOT/'COMPONENTS.md').read_text(encoding='utf-8') for n in range(1,35))
css=(ROOT/'foundation.css').read_text(encoding='utf-8')
assert all(f'--color-{name}' in css for name in c),'Unmapped color token'
lint_path=ROOT/'design-lint.json'
lint=json.loads(lint_path.read_text(encoding='utf-8-sig')) if lint_path.exists() else None
if lint:
    assert lint['summary']['errors']==0
    assert all(x['rule']=='orphaned-tokens' for x in lint['findings'] if x['severity']=='warning')
browser_path=ROOT/'browser-qa.json'
browser=json.loads(browser_path.read_text(encoding='utf-8')) if browser_path.exists() else None
(ROOT/'asset-manifest.json').write_text(json.dumps({'version':'1.0','created':'2026-10-08','image_method':'built-in Image Gen','assets':assets},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'verification.json').write_text(json.dumps({'token_drift':False,'contrast_pairs':checks,'asset_count':len(assets),'markdown_local_links_checked':len(links),'components_documented':34,'font_signature':'wOF2','font_license_present':True,'design_lint':lint['summary'] if lint else None,'lint_warning_explanation':'The designmd linter only tracks frontmatter component references. All 29 colors are consumed by foundation.css; checked separately.','browser_visual_qa':browser,'app_integration_tested':False},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'assets':len(assets),'contrast_pairs_passed':len(checks),'local_links':len(links),'components':34},ensure_ascii=False))
