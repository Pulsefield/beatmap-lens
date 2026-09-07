"""Prepare paired fixed-evidence and optional-harness jobs; never launch workers."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unicodedata

import pyarrow.parquet as pq

from harness_examples import extract_examples, public_example

REPO = Path(__file__).resolve().parents[1]
ARMS = ('fixed-evidence', 'harness-a', 'harness-b')
NOTE_FIELDS = ('source_line', 'column', 'kind', 'start_ms', 'end_ms')


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def read(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def song_groups(sources):
    """Join known mapsets and exact normalized titles, including transitive links."""
    parents = {source: source for source in sources}

    def find(source):
        while parents[source] != source:
            parents[source] = parents[parents[source]]
            source = parents[source]
        return source

    seen = {}
    for source, chart in sorted(sources.items()):
        metadata = chart['source']
        title = ' '.join(unicodedata.normalize('NFKC', metadata.get('title', '')).casefold().split())
        keys = [('title', title)] if title else []
        mapset = metadata.get('beatmapSetId')
        if isinstance(mapset, int) and mapset > 0:
            keys.append(('mapset', mapset))
        for key in keys:
            if key in seen:
                left, right = sorted((find(source), find(seen[key])))
                parents[right] = left
            else:
                seen[key] = source
    return {source: 'song-component:' + find(source) for source in sources}


def source_cases(design, campaign, sources):
    cases = []
    for case in design['cases']:
        source = case['sourceSha256']
        parquet = campaign / 'agent/charts' / f'{source}.parquet'
        table = pq.ParquetFile(parquet).read()
        meta = json.loads(table.schema.metadata[b'beatmap_lens'])
        if meta['source']['sha256'] != source:
            raise ValueError(f'Parquet source binding differs: {source}')
        context = case['reviewContext']
        notes = table.to_pylist()
        selected = [note for note in notes if note['start_ms'] < context['endMs'] and
                    (note['end_ms'] > context['startMs'] if note['kind'] == 'long'
                     else note['start_ms'] >= context['startMs'])]
        boundary = [note for note in notes if note['kind'] == 'long' and note['end_ms'] == context['startMs']]
        cases.append({
            'caseId': case['benchmarkCaseId'], 'sectionId': case['benchmarkCaseId'],
            'sourceSha256': source, 'sourceMetadata': sources[source]['source'],
            'scope': case['scope'], 'reviewContext': context, 'parquetSha256': sha(parquet),
            'notes': [{key: note[key] for key in NOTE_FIELDS} for note in selected],
            'boundaryReleases': [{key: note[key] for key in NOTE_FIELDS} for note in boundary],
            'timingPoints': meta['timingPoints'],
        })
    return cases


def brief(cases):
    lines = ['# Selected sections', '',
             'Judge each complete target scope across all five dimensions. Context explains entry/exit; '
             'keep the target scope unchanged. Metadata identifies the difficulty and does not establish a style.', '',
             'All intervals are half-open source milliseconds; columns are zero-based. Every attack in each '
             'review context is listed. Row notation is timeMs followed by [sourceLine,column,kind,endMs] '
             'tuples; T is a normal tap and L is a long note. Entering holds retain their original head and end.', '',
             'Full-note tuples use [sourceLine,column,kind,startMs,endMs]. Notes ending exactly at the left '
             'context boundary are listed separately as release facts, not entering holds. Do not cite those '
             'endpoint-only notes in noteLines/contextLines: the unchanged reference contract requires overlap.', '',
             'brief.md is the compact initial evidence. cases.json contains the same notes in verbose scorer '
             'form and full timing-point facts; reread only a needed record, not the whole duplicate file.', '']
    for case in cases:
        source = case['sourceMetadata']
        scope, context = case['scope'], case['reviewContext']
        metadata = {key: source[key] for key in ('title', 'artist', 'difficulty', 'creator', 'keyCount',
                                               'beatmapId', 'beatmapSetId') if key in source}
        lines.extend([f"## {case['caseId']}", '', compact(metadata),
                      f"sourceSha256={case['sourceSha256']}; sectionId={case['sectionId']}",
                      f"scope=[{scope['startMs']},{scope['endMs']}); reviewContext=[{context['startMs']},{context['endMs']})"])
        points = sorted(case['timingPoints'], key=lambda p: (float(p['fields'][0]), p['sourceLine']))
        prior_tempo = next((p for p in reversed(points) if float(p['fields'][0]) <= context['startMs']
                            and float(p['fields'][1]) > 0), None)
        prior_scroll = next((p for p in reversed(points) if float(p['fields'][0]) <= context['startMs']), None)
        selected_points = {p['sourceLine']: p for p in (prior_tempo, prior_scroll) if p is not None}
        selected_points.update({p['sourceLine']: p for p in points
                                if context['startMs'] < float(p['fields'][0]) < context['endMs']})
        lines.append('Timing [sourceLine,osu timing fields]: ' + compact(
            [[p['sourceLine'], p['fields']] for p in selected_points.values()]))

        def full(note):
            return [note['source_line'], note['column'], 'L' if note['kind'] == 'long' else 'T',
                    note['start_ms'], note['end_ms']]

        for label, start in (('Entering review context', context['startMs']), ('Entering target scope', scope['startMs'])):
            lines.append(label + ': ' + compact([full(n) for n in case['notes']
                                                if n['kind'] == 'long' and n['start_ms'] < start < n['end_ms']]))
        if case['boundaryReleases']:
            lines.append('Release facts exactly at context start (endpoint-only, not citable refs): ' +
                         compact([full(n) for n in case['boundaryReleases']]))
        rows = defaultdict(list)
        for note in case['notes']:
            if context['startMs'] <= note['start_ms'] < context['endMs']:
                rows[note['start_ms']].append(note)
        lines.append('```text')
        for time, notes in sorted(rows.items()):
            lines.append(str(time) + ' ' + compact([[n['source_line'], n['column'],
                                                    'L' if n['kind'] == 'long' else 'T', n['end_ms']]
                                                   for n in sorted(notes, key=lambda n: (n['column'], n['source_line']))]))
        lines.extend(['```', ''])
    return '\n'.join(lines)


def benchmark_gold(case, feedback):
    record = next((e for e in extract_examples([feedback], {})
                   if e['provenance'].get('decisionId') == case['decisionId']
                   and e['provenance'].get('handoffId') == case['handoffId']
                   and e['provenance'].get('claimId') == case['claimId']), None)
    if record is None or any(record[key] != case[key] for key in ('sourceSha256', 'scope', 'reviewContext')):
        raise ValueError(f"Benchmark scope is not the referenced final human judgment: {case['benchmarkCaseId']}")
    if record['tagId'] != case['goldTagId'] or record['assessment'] != case['goldAssessment']:
        raise ValueError(f"Benchmark gold differs from the final human judgment: {case['benchmarkCaseId']}")
    value = public_example(record)
    return {'caseId': case['benchmarkCaseId'], 'cohort': case['cohort'], **value,
            'gold': {value['tagId']: value['assessment']}, 'feedbackSha256': case['feedbackSha256']}


def prepare(design_path, root, campaign, python):
    design_path, root, campaign = map(lambda p: Path(p).resolve(), (design_path, root, campaign))
    design, config = read(design_path), read(campaign / 'controller/config.json')
    sources = {c['source']['sha256']: c for c in read(campaign / 'admin/source-map.json')}
    groups = song_groups(sources)
    target_sources = {c['sourceSha256'] for c in design['cases']}
    target_groups = {groups[source] for source in target_sources}
    excluded = {source for source, group in groups.items() if group in target_groups}
    required_exclusions = set(design['retrievalExclusion']['excludedSourceSha256'])
    if not required_exclusions <= excluded:
        raise ValueError('Song grouping does not cover every design exclusion.')
    feedback_dir = Path(design['selectionSnapshot']['feedbackDirectory'])
    gold = []
    for case in design['cases']:
        if sha(feedback_dir / (case['sourceSha256'] + '.json')) != case['feedbackSha256']:
            raise ValueError(f"Design feedback snapshot changed: {case['benchmarkCaseId']}")
        gold.append(benchmark_gold(case, read(feedback_dir / (case['sourceSha256'] + '.json'))))
    foundation_path = campaign / config['workerCommonPath'] / 'foundation.json'
    original_foundation = read(foundation_path)
    if original_foundation['foundationSha256'] != config['foundationSha256']:
        raise ValueError('Campaign Foundation pin differs from the worker definitions.')
    foundation = {key: value for key, value in original_foundation.items() if key != 'calibrationExamples'}
    foundation['viewProvenance'] = {'originalFileSha256': sha(foundation_path),
                                   'omitted': 'calibrationExamples; identical definitions-only view in all arms'}
    cases = source_cases(design, campaign, sources)
    initial_brief = brief(cases)
    skill_root = REPO / 'skills/mania-pattern-judgment'
    skill_files = {str(path.relative_to(skill_root)): path.read_bytes()
                   for path in sorted(skill_root.rglob('*')) if path.is_file() and path.suffix in ('.md', '.yaml', '.yml')}
    root.mkdir(parents=True, exist_ok=False)
    save(root / 'design.json', design)
    save(root / 'gold.json', {'cases': gold})
    save(root / 'source-groups.json', groups)
    save(root / 'sections.json', {'sections': [{key: c[key] for key in
                                              ('sectionId', 'sourceSha256', 'scope', 'reviewContext')} for c in cases]})
    harness_preparer = module('prepare-annotation-harness')
    bundle = root / 'evaluation-bundle'
    bundle_result = harness_preparer.prepare(campaign, root / 'sections.json', feedback_dir,
                                             bundle, 'evaluation', groups)
    library = read(bundle / 'examples.json')
    if any(e['sourceSha256'] in excluded or e['groupId'] in target_groups for e in library):
        raise ValueError('An excluded human example entered the evaluation bundle.')
    bench = module('run-section-benchmark')
    common_prompt = '''Start with brief.md, then read skill/SKILL.md, skill/references/judgment-guide.md and foundation.json. The brief contains complete original review-context rows, entering holds and neutral metadata for every assigned case. cases.json preserves the same source notes in verbose scorer form; do not load the whole duplicate file. Judge every complete selected scope across all five dimensions independently. Keep the original scope and reviewContext unchanged for this paired experiment. Metadata and another dimension's label do not establish a judgment. Source columns are zero-based and ranges are half-open milliseconds.
This experimental workflow and response-schema.json override generic skill delivery workflows: no task fetching, campaign restart, canonical submission, global skill access, or extra reference ledger is required or allowed. The frozen skill deliberately contains Markdown/YAML only; unavailable calibration JSON references must not be recovered elsewhere. Do not inspect parent directories, sibling jobs, admin/gold/design files, feedback stores, repositories, or network sources. Do not spawn agents or edit inputs.
Return exactly one case per input caseId and one judgment for each of jack-organization, stream-organization, trill-organization, tech, and ln-coordination. Use presence present/absent/unresolved; salience supporting/prominent only for present, null otherwise. Each rationale is an array of 2–4 brief bullet strings without bullet prefixes, at most 80 words total. Cite exact supplied noteLines/contextLines. Endpoint-only releases at the left context boundary are facts, not entering holds or overlapping citable references. Do not invent missing labels or use uncertainty as supporting salience. Write only the schema-shaped final answer; the controller captures and scores it independently. Outputs remain unsealed experimental machine proposals.
'''
    harness_prompt = '''Read ROLE.md for optional inspection guidance, subject to the experimental workflow and output contract above. The supplied lens MCP server is the only extra source/example access. It provides chart_context, inspect_section, section_perspective, query_structure, find_human_examples, get_human_example and render_section. Use the caseId as section_id. Invoke a tool only when missing evidence, an unclear organization, another perspective, or a useful human strength comparison could change your judgment; there is no mandatory tool sequence or minimum call count. Start from existing evidence and reuse it. Example search defaults to three brief contrasting cards; expand only useful examples and do not enumerate the library. Native image views are optional. Tools can inspect wider source context when needed, but keep final reference arrays within the original scope/reviewContext for this comparison. Never read the raw harness bundle or tool-trace files to bypass progressive retrieval or exclusions.
'''
    fixed_prompt = '''This is the fixed-evidence arm. Use only the supplied section brief, exact local notes, frozen Markdown skill and Foundation. No harness or additional human-example access is available. Do not recover absent tools, raw example libraries or external feedback. Resolve the judgment from the supplied complete context; retain a specific semantic uncertainty if it actually remains.
'''
    for arm in ARMS:
        job = root / 'runs' / arm
        bench.prepare_job(job, cases, skill_files, foundation, config)
        (job / 'brief.md').write_text(initial_brief)
        uses_harness = arm != 'fixed-evidence'
        (job / 'prompt.txt').write_text(common_prompt + (harness_prompt if uses_harness else fixed_prompt))
        (job / 'AGENTS.md').write_text(
            'Use only this job\'s frozen inputs and write only its outputs. Follow prompt.txt and response-schema.json '
            'for this experiment; they override generic skill delivery workflows. Do not inspect sibling jobs, '
            'parent repositories, global skills, admin/gold/design files, feedback stores, or network sources. '
            'Do not spawn agents or submit canonical changes. ' +
            ('Additional source and human-example access is permitted only through the lens MCP tools. '
             'Do not read raw bundle files or trace logs.\n' if uses_harness else
             'No additional example or harness access is allowed.\n'))
        if uses_harness:
            (job / 'ROLE.md').write_bytes((REPO / 'docs/agent-roles/harness-labeler.md').read_bytes())
        save(job / 'skill-provenance.json', {
            'name': 'mania-pattern-judgment', 'version': 'prepared-harness-benchmark',
            'files': {name: hashlib.sha256(content).hexdigest() for name, content in skill_files.items()},
            'calibrationJsonOmitted': True,
        })
        run = read(job / 'run.json')
        run['arm'] = arm
        if uses_harness:
            run['harness'] = {'bundle': str(bundle), 'manifestSha256': sha(bundle / 'manifest.json'),
                              'python': str(Path(python).absolute())}
        run['inputHashes'] = {str(path.relative_to(job)): sha(path) for path in sorted(job.rglob('*'))
                              if path.is_file() and path.name != 'run.json'}
        save(job / 'run.json', run)
    preparation = {
        'kind': 'paired-optional-harness-preparation-v1', 'createdAt': datetime.now(timezone.utc).isoformat(),
        'designSha256': sha(root / 'design.json'), 'goldSha256': sha(root / 'gold.json'),
        'caseCount': len(cases), 'dimensionsPerCase': len(bench.TAGS), 'arms': list(ARMS),
        'cohorts': design['cohorts'], 'classification': design['classification'],
        'briefSha256': sha(root / 'runs/fixed-evidence/brief.md'), 'briefCharacters': len(initial_brief),
        'foundationFileSha256': sha(foundation_path), 'foundationSha256': config['foundationSha256'],
        'campaignConfigSha256': sha(campaign / 'controller/config.json'), 'requestedModel': config['models']['labeler'],
        'requestedReasoningEffort': config['reasoningEfforts']['labeler'],
        'grouping': 'Connected components of valid mapsets or exact NFKC/casefold/whitespace-normalized titles.',
        'requiredExcludedSources': sorted(required_exclusions), 'effectiveExcludedSources': sorted(excluded),
        'groupingSha256': sha(root / 'source-groups.json'), 'harness': bundle_result,
        'preparerSha256': sha(__file__),
        'boundary': 'Gold/admin files outside job directories; target labels physically excluded from retrieval. '
                    'Worker filesystem boundary is instructed, not an OS read-isolation guarantee.',
        'limits': design['limitations'],
    }
    save(root / 'preparation.json', preparation)
    return {'root': str(root), 'cases': len(cases), 'arms': list(ARMS), 'examples': len(library),
            'excludedSources': len(excluded), 'briefCharacters': len(initial_brief), 'status': 'prepared-not-launched'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--design', type=Path, default=REPO / '.local/harness-evaluation-design-20260907.json')
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--campaign', type=Path, default=REPO / '.local/corpus-500-v2')
    parser.add_argument('--python', default=sys.executable, help='Python executable with the harness dependencies.')
    args = parser.parse_args()
    print(json.dumps(prepare(args.design, args.root, args.campaign, args.python)))


if __name__ == '__main__':
    main()
