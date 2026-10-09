"""Generate deterministic design assets from DESIGN.md. No image manipulation."""
from pathlib import Path
import argparse,json,re
import yaml

ROOT=Path(__file__).resolve().parents[1]
DESIGN=ROOT.parent/'DESIGN.md'

def read_tokens():
    text=DESIGN.read_text(encoding='utf-8')
    data=yaml.safe_load(text.split('---',2)[1])
    for name,value in data['colors'].items():
        assert re.fullmatch(r'#[0-9A-Fa-f]{6}',value),(name,value)
    assert all(isinstance(v,dict) and v.get('fontFamily') for v in data['typography'].values())
    return data

def artifacts(data):
    lines=['/* Generated from DESIGN.md. Do not edit directly. */',':root {']
    for group,prefix in [('colors','color'),('spacing','space'),('rounded','radius')]:
        for name,value in data[group].items():
            lines.append(f'  --{prefix}-{name.lower()}: {value};')
    for name,value in data['typography'].items():
        lines.append(f'  --font-{name}: {value["fontFamily"]};')
        for key in ('fontSize','lineHeight'):
            if key in value: lines.append(f'  --font-{name}-{key.lower()}: {value[key]};')
    for name,values in data['components'].items():
        for key,value in values.items():
            css_key=re.sub(r'(?<!^)(?=[A-Z])','-',key).lower()
            lines.append(f'  --component-{name}-{css_key}: {value};')
    lines.append('}\n')
    return {'tokens.css':'\n'.join(lines),'tokens.json':json.dumps(data,ensure_ascii=False,indent=2)+'\n'}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    for name,content in artifacts(read_tokens()).items():
        path=ROOT/name
        if args.check: assert path.read_text(encoding='utf-8')==content, f'Drift: {name}'
        else: path.write_text(content,encoding='utf-8')
    print('Token check passed' if args.check else 'Generated tokens.css and tokens.json')
