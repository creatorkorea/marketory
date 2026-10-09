"""Check documentation integrity; this does not execute product tests."""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit
import csv
import json
import re
import unicodedata
from sync_reference_docs import ROOT, build

REPORT = ROOT / 'docs/document-check.json'


def anchors(path):
    content = path.read_text(encoding='utf-8')
    result = set(re.findall(r'<a\s+id="([^"]+)"', content))
    seen = {}
    for title in re.findall(r'^#{1,6}\s+(.+)$', content, re.M):
        slug = ''.join(c for c in title.lower() if c in '-_ ' or
                       unicodedata.category(c)[0] in 'LN').replace(' ', '-')
        count = seen.get(slug, 0)
        seen[slug] = count + 1
        result.add(slug if not count else f'{slug}-{count}')
    return result


def check_link(parent, target):
    parsed = urlsplit(target.strip('<>'))
    if parsed.scheme or parsed.netloc:
        return False
    path = (parent.parent / unquote(parsed.path)).resolve() if parsed.path else parent
    assert path.is_relative_to(ROOT), f'Outside workspace: {parent}: {target}'
    assert path.exists() or path == REPORT, f'Broken link: {parent}: {target}'
    if parsed.fragment and path.suffix == '.md':
        assert unquote(parsed.fragment) in anchors(path), f'Broken anchor: {parent}: {target}'
    return True


def main():
    generated = build()
    for path, expected in generated.items():
        assert path.exists() and path.read_text(encoding='utf-8') == expected, f'Stale: {path}'
    markdown = [ROOT / 'README.md', *sorted((ROOT / 'docs').rglob('*.md'))]
    local_links = 0
    for path in markdown:
        for target in re.findall(r'\[[^\]\n]*\]\(([^)\n]+)\)', path.read_text(encoding='utf-8')):
            local_links += check_link(path, target)
    counts = {}
    valid_ids = set()
    for filename, prefix in [('acceptance-cases.csv', 'AC'), ('e2e-cases.csv', 'E2E')]:
        path = ROOT / 'docs/qa' / filename
        with path.open(encoding='utf-8', newline='') as handle:
            rows = list(csv.DictReader(handle))
        expected = {f'{prefix}-{number:02}' for number in range(1, 45)}
        assert len(rows) == 44 and {r['id'] for r in rows} == expected
        assert all(r['baseline_status'] == 'NOT_RUN' for r in rows)
        for row in rows:
            assert row['scenario'] and row['expected_result']
            local_links += check_link(path, row['source'])
        valid_ids.update(expected)
        counts[prefix] = len(rows)
    roadmap = (ROOT / 'docs/ROADMAP.md').read_text(encoding='utf-8')
    assigned = set(re.findall(r'E2E-\d{2}', roadmap))
    assert assigned == {f'E2E-{number:02}' for number in range(1, 45)}, 'Roadmap E2E coverage incomplete'
    with (ROOT / 'docs/qa/execution-log.csv').open(encoding='utf-8', newline='') as handle:
        runs = list(csv.DictReader(handle))
    for row in runs:
        assert row['case_id'] in valid_ids
        assert row['status'] in {'PASS', 'FAIL', 'BLOCKED', 'SKIPPED'}
        assert all(row[key].strip() for key in ['run_id', 'environment', 'revision', 'executed_at', 'evidence'])
    manifest = json.loads((ROOT / 'docs/reference/manifest.json').read_text(encoding='utf-8'))
    report = {
        'checked_at': datetime.now(timezone.utc).isoformat(),
        'status': 'PASS',
        'scope': 'Documentation integrity only; product tests are not executed by this tool.',
        'markdown_files_checked': len(markdown),
        'local_links_checked': local_links,
        'current_word_sources': len(manifest['sources']),
        'source_hashes_and_generated_content_match': True,
        'case_counts': counts,
        'roadmap_e2e_coverage': len(assigned),
        'recorded_product_test_runs': len(runs),
        'generated_files_checked': len(generated),
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
