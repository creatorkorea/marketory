"""Generate searchable reference copies from the current Word specifications.

Word sources stay authoritative and are never modified. No product code is built.
Requires python-docx. Run --check to detect stale generated artifacts.
"""
from pathlib import Path
import argparse,csv,hashlib,io,json,re
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.ns import qn

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'문서_보완본_v1.3'
NAMES=['00-common-contract','01-product','02-workflow','03-features','04-data-model','05-development','06-screens']

def cell_text(value):
    return value.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('|','&#124;').replace('\n','<br>')

def render(path,dest,d):
    rel=path.relative_to(ROOT).as_posix()
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    out=[f'# {path.stem}', '', '> 자동 생성한 검색용 참조본입니다. 이 파일을 직접 수정하지 마세요.',
         f'> 원본: [{path.name}](../../{rel})',f'> 원본 SHA-256: `{digest}`',
         '> 문단과 표의 내용을 원래 순서대로 옮겼습니다. Word 페이지 배치·도형·서식의 복제본은 아닙니다.',
         '> 변경하려면 Word 원본을 수정한 뒤 `docs/tools/sync_reference_docs.py`를 다시 실행하세요.', '']
    table_count=0
    for child in d.element.body.iterchildren():
        if child.tag==qn('w:p'):
            pp=Paragraph(child,d);text=pp.text.strip()
            if not text:continue
            if pp.style.name.startswith('Heading'):
                level=re.search(r'\d+',pp.style.name)
                n=min((int(level.group()) if level else 1)+1,6)
                out.append('#'*n+' '+text)
            elif pp.style.name=='Title':out.append('## '+text)
            elif 'Bullet' in pp.style.name:out.append('- '+text)
            else:out.append(text)
            out.append('')
        elif child.tag==qn('w:tbl'):
            t=Table(child,d);table_count+=1
            rows=[[cell_text(c.text) for c in row.cells] for row in t.rows]
            if not rows:continue
            n=max(map(len,rows));rows=[r+['']*(n-len(r)) for r in rows]
            out.extend([f'<a id="table-{table_count:02}"></a>',f'**표 {table_count:02}**',''])
            out.append('| '+' | '.join(rows[0])+' |')
            out.append('| '+' | '.join(['---']*n)+' |')
            out.extend('| '+' | '.join(r)+' |' for r in rows[1:]);out.append('')
    return '\n'.join(out)+'\n',digest,table_count

def cases(d,prefix,ref):
    rows=[]
    for ti,t in enumerate(d.tables,1):
        for r in t.rows:
            vals=[c.text for c in r.cells]
            if re.fullmatch(prefix+r'-\d{2}',vals[0]):
                assert len(vals)==3,vals
                rows.append([*vals,f'../reference/{ref}.md#table-{ti:02}','NOT_RUN'])
    assert sorted(r[0] for r in rows)==[f'{prefix}-{n:02}' for n in range(1,45)]
    buf=io.StringIO(newline='');writer=csv.writer(buf,lineterminator='\n')
    writer.writerow(['id','scenario','expected_result','source','baseline_status']);writer.writerows(rows)
    return buf.getvalue()

def build():
    sources=sorted(SOURCE.glob('*.docx'));assert len(sources)==7
    outputs={};manifest=[];docs={}
    before={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    for path,slug in zip(sources,NAMES):
        assert path.name[:2]==slug[:2]
        d=Document(path);docs[slug]=d
        dest=ROOT/'docs/reference'/f'{slug}.md'
        txt,digest,count=render(path,dest,d);outputs[dest]=txt
        manifest.append({'source':path.relative_to(ROOT).as_posix(),'reference':dest.relative_to(ROOT).as_posix(),'sha256':digest,'tables':count})
    outputs[ROOT/'docs/qa/acceptance-cases.csv']=cases(docs['03-features'],'AC','03-features')
    outputs[ROOT/'docs/qa/e2e-cases.csv']=cases(docs['05-development'],'E2E','05-development')
    outputs[ROOT/'docs/reference/manifest.json']=json.dumps({'spec_version':'1.3','sources':manifest,'acceptance_cases':44,'e2e_cases':44,'note':'NOT_RUN is a generated baseline; actual runs go in docs/qa/execution-log.csv.'},ensure_ascii=False,indent=2)+'\n'
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in before.items())
    return outputs

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    outputs=build()
    for path,content in outputs.items():
        if args.check:assert path.exists() and path.read_text(encoding='utf-8')==content,f'Stale: {path}'
        else:path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content,encoding='utf-8',newline='')
    print(json.dumps({'generated_files':len(outputs),'mode':'check' if args.check else 'generate','sources_unchanged':True,'AC':44,'E2E':44}))
