"""Freeze reusable source/context/example inputs for optional annotation harness tools."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

import pyarrow.parquet as pq

from harness_examples import extract_examples

REPO = Path(__file__).resolve().parents[1]
TOOL_FILES = ('annotation-harness.py', 'harness_examples.py', 'harness_inspection.py',
              'harness_render.py', 'annotation-queries.py', 'annotation-facts.py')


def read(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(campaign, section_file, feedback_dir, out, mode='annotation', source_groups=None):
    campaign, section_file, feedback_dir, out = map(Path, (campaign, section_file, feedback_dir, out))
    sources = {c['source']['sha256']: c for c in read(campaign / 'admin/source-map.json')}
    groups = source_groups or {sha: f"mapset:{c['source'].get('beatmapSetId', sha)}" for sha, c in sources.items()}
    raw = read(section_file)
    sections = raw['sections'] if 'sections' in raw else raw['cases']
    sections = [{'sectionId': c.get('caseId', c.get('sectionId', f'section-{i + 1:03d}')),
                 'sourceSha256': c['sourceSha256'], 'scope': c['scope'],
                 'reviewContext': c.get('reviewContext', c['scope'])} for i, c in enumerate(sections)]
    if len({s['sectionId'] for s in sections}) != len(sections):
        raise ValueError('Section handles must be unique within the job. Supply unique caseId values for source-local section IDs.')
    out.mkdir(parents=True, exist_ok=False)
    excluded_sources = sorted({c['sourceSha256'] for c in sections}) if mode == 'evaluation' else []
    excluded_groups = sorted({groups[sha] for sha in excluded_sources})
    feedback_paths = sorted(feedback_dir.glob('*.json'))
    examples = extract_examples([read(p) for p in feedback_paths], groups)
    # Held-out labels never enter the worker bundle, including other difficulties in its group.
    examples = [e for e in examples if e['sourceSha256'] in sources
                and e['sourceSha256'] not in excluded_sources and e['groupId'] not in excluded_groups]
    for example in examples:
        source = sources[example['sourceSha256']]['source']
        example.update({k: source[k] for k in ('title', 'difficulty') if k in source})
    save(out / 'examples.json', examples)
    chart_refs = {}
    for sha in sorted({c['sourceSha256'] for c in sections} | {e['sourceSha256'] for e in examples}):
        original = sources[sha]
        source_path = Path(original['sourcePath'])
        if digest(source_path) != sha:
            raise ValueError(f'Source bytes changed: {source_path}')
        parquet = campaign / 'agent/charts' / f'{sha}.parquet'
        table = pq.ParquetFile(parquet).read()
        meta = json.loads(table.schema.metadata[b'beatmap_lens'])
        if meta['source']['sha256'] != sha:
            raise ValueError('Parquet source binding differs.')
        notes = [{'sourceLine': n['source_line'], 'column': n['column'], 'kind': n['kind'],
                  'startMs': n['start_ms'], 'endMs': n['end_ms']} for n in table.to_pylist()]
        path = f'charts/{sha}.json'
        save(out / path, {'source': original['source'], 'range': meta['range'],
                          'timingPoints': meta['timingPoints'], 'notes': notes})
        chart_refs[sha] = {'path': path, 'source': original['source'], 'groupId': groups[sha],
                           'sourceBytesVerified': True, 'parquetSha256': digest(parquet)}
    for name in TOOL_FILES:
        (out / 'tools').mkdir(exist_ok=True)
        shutil.copyfile(REPO / 'scripts' / name, out / 'tools' / name)
    files = {str(p.relative_to(out)): digest(p) for p in sorted(out.rglob('*')) if p.is_file()}
    manifest = {'kind': 'beatmap-lens-annotation-harness-v1', 'mode': mode,
                'foundationSha256': read(campaign / 'controller/config.json')['foundationSha256'],
                'sections': sections, 'charts': chart_refs, 'files': files,
                'excludedSources': excluded_sources, 'excludedGroups': excluded_groups,
                'provenance': {'sectionInputSha256': digest(section_file),
                               'sourceMapSha256': digest(campaign / 'admin/source-map.json'),
                               'feedbackFiles': {p.name: digest(p) for p in feedback_paths},
                               'grouping': 'provided-song-groups' if source_groups else 'mapset',
                               'preparerSha256': digest(Path(__file__))},
                'limits': ['Read-only snapshot, not live canonical decisions.',
                           'Player-action perspective and structural queries do not assign semantic labels.',
                           'Example ordering is deterministic label balance/keyword filtering, not relevance ranking.']}
    save(out / 'manifest.json', manifest)
    return {'output': str(out.resolve()), 'sections': len(sections), 'examples': len(examples),
            'charts': len(chart_refs), 'manifestSha256': digest(out / 'manifest.json')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--campaign', type=Path, required=True)
    parser.add_argument('--sections', type=Path, required=True, help='JSON with sections or cases containing sourceSha256, scope and reviewContext.')
    parser.add_argument('--feedback-dir', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--mode', choices=['annotation', 'evaluation'], default='annotation')
    parser.add_argument('--song-groups', type=Path, help='Complete source SHA to curated song ID mapping.')
    args = parser.parse_args()
    print(json.dumps(prepare(args.campaign, args.sections, args.feedback_dir, args.out, args.mode,
                             read(args.song_groups) if args.song_groups else None)))


if __name__ == '__main__':
    main()
