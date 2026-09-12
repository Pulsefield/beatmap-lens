"""Frozen, source-bound annotation microbenchmark; no canonical annotation writes."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import uuid

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from annotation_runtime import REPO, TAGS, read, save, sha, run_job, response_schema, check_section_limit
PRICING = {'source': 'https://developers.openai.com/api/docs/models/gpt-6-astra',
           'checkedOn': '2026-09-07', 'inputPerMillion': 10, 'cachedInputPerMillion': 1,
           'cacheWritePerMillion': 12.5, 'outputPerMillion': 50,
           'basis': 'Standard API-equivalent estimate, not actual Codex subscription billing; requests below 272K input.'}


def prepare_job(job, cases, skill_files, foundation, config, role='labeler', extra_prompt=''):
    check_section_limit(len(cases))
    job.mkdir(parents=True)
    for name, content in skill_files.items():
        path = job / 'skill' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    save(job / 'cases.json', {'cases': cases})
    save(job / 'foundation.json', {key: value for key, value in foundation.items() if key != 'calibrationExamples'})
    save(job / 'response-schema.json', response_schema())
    (job / 'AGENTS.md').write_text('Use only this job directory. The supplied frozen skill is authoritative for this evaluation. Do not inspect other jobs, global skill files, parent repositories, feedback stores, or network sources. Do not spawn agents. No canonical submissions.\n')
    prompt = '''Apply the frozen skill at ./skill/SKILL.md and ./skill/references/judgment-guide.md to every case in cases.json. Read foundation.json for definitions. These are exact local source sections with complete supplied context and entering holds; all columns are zero-based and times are source milliseconds. Judge the entire selected episode across ALL FIVE dimensions independently. Keep the supplied scope for this comparison, using context only to explain entry/exit. Do not infer any style from metadata or from another target. Full note arrays are factual inputs; no target gold or original machine labels are supplied. A source missing from context cannot be invented. Use only supplied files. Do not read globally installed skills, other jobs, repositories, canonical feedback, or network sources. Do not spawn agents.
Return JSON matching the supplied output schema: one case per input caseId and exactly one judgment per target. Each rationale has 2–4 brief bullets (array elements without bullet prefixes), normally <=80 words total. Use presence present/absent/unresolved; salience supporting/prominent only for present and null otherwise. Keep exact noteLines/contextLines supporting the judgment; full source refs are already supplied. Unknown dimensions are not negatives. Mark a semantic ambiguity unresolved only when it actually remains. A brief factual negative is useful. Your JSON is an unsealed experimental proposal, not human truth. No canonical files or external services may be modified. Do not edit the supplied inputs. Write only the final schema-shaped answer; the controller captures it and performs scoring independently.
'''
    (job / 'prompt.txt').write_text(prompt + extra_prompt)
    paths = [p for p in job.rglob('*') if p.is_file()]
    save(job / 'run.json', {'producerId': 'section-benchmark-' + str(uuid.uuid4()), 'role': role,
                           'status': 'prepared', 'caseCount': len(cases), 'judgmentCount': len(cases) * len(TAGS),
                           'requestedModel': config['models'][role],
                           'requestedReasoningEffort': config['reasoningEfforts'][role],
                           'inputHashes': {str(p.relative_to(job)): sha(p) for p in paths}})


def metrics(job, gold):
    run = read(job / 'run.json')
    result = {'job': job.name, **run}
    if run['status'] != 'completed':
        return result
    cases = read(job / 'cases.json')['cases']
    response = read(job / 'response.json')['cases']
    by_id = {c['caseId']: c for c in cases}
    errors, scored = [], []
    case_counts = {key: sum(c['caseId'] == key for c in response) for key in by_id}
    if set(c['caseId'] for c in response) != set(by_id) or set(case_counts.values()) != {1}:
        errors.append('Output case identities/counts differ.')
    for case in response:
        if case['caseId'] not in by_id:
            continue
        source = by_id[case['caseId']]
        notes = {n['source_line']: n for n in source['notes']}
        tag_counts = {tag: sum(j['tagId'] == tag for j in case['judgments']) for tag in TAGS}
        if set(tag_counts.values()) != {1} or len(case['judgments']) != len(TAGS):
            errors.append(case['caseId'] + ': target coverage differs')
        for judgment in case['judgments']:
            key = case['caseId'] + ':' + judgment['tagId']
            if (judgment['presence'] == 'present') != (judgment['salience'] in ('supporting', 'prominent')):
                errors.append(key + ': salience shape')
            if not 2 <= len(judgment['rationale']) <= 4:
                errors.append(key + ': bullet count')
            if sum(len(line.split()) for line in judgment['rationale']) > 80:
                errors.append(key + ': exceeds 80 words')
            for field, bounds_key in (('noteLines', 'scope'), ('contextLines', 'reviewContext')):
                interval = source[bounds_key]
                for line in judgment[field]:
                    note = notes.get(line)
                    if note is None:
                        errors.append(key + ': unknown note')
                    elif not (note['start_ms'] < interval['endMs'] and note['end_ms'] > interval['startMs'] if note['kind'] == 'long'
                              else interval['startMs'] <= note['start_ms'] < interval['endMs']):
                        errors.append(key + ': out-of-scope note')
            if judgment['presence'] == 'present' and not judgment['noteLines']:
                errors.append(key + ': positive without witnesses')
            expected = gold.get(key)
            if expected:
                assessment = {'presence': judgment['presence']}
                if judgment['presence'] == 'present':
                    assessment['salience'] = judgment['salience']
                scored.append({'caseId': case['caseId'], 'tagId': judgment['tagId'], 'predicted': assessment,
                               'expected': expected, 'exact': assessment == expected,
                               'presenceCorrect': assessment['presence'] == expected['presence']})
    keyed = {}
    for item in scored:
        key = item['caseId'] + ':' + item['tagId']
        if key in keyed:
            item = {**item, 'exact': False, 'presenceCorrect': False, 'duplicatePrediction': True}
        keyed[key] = item
    for key, expected in gold.items():
        case_id, tag = key.rsplit(':', 1)
        if case_id in by_id and key not in keyed:
            keyed[key] = {'caseId': case_id, 'tagId': tag, 'predicted': None, 'expected': expected,
                          'exact': False, 'presenceCorrect': False, 'missingPrediction': True}
    scored = list(keyed.values())
    usage = run['usage']
    cached, writes = usage.get('cached_input_tokens', 0), usage.get('cache_write_input_tokens', 0)
    uncached = usage.get('input_tokens', 0) - cached - writes
    estimate = (uncached * 10 + cached + writes * 12.5 + usage.get('output_tokens', 0) * 50) / 1e6
    result.update(mechanicalErrors=errors, scored=scored, goldCount=len(scored),
                  exactMatches=sum(s['exact'] for s in scored), presenceMatches=sum(s['presenceCorrect'] for s in scored),
                  secondsPerSection=run['elapsedSeconds'] / len(cases),
                  apiEquivalentUsd=estimate, pricing=PRICING,
                  unscoredJudgments=len(cases) * len(TAGS) - len(scored))
    return result


def report(root):
    gold_records = read(root / 'gold.json')['cases']
    gold = {c['caseId'] + ':' + tag: value for c in gold_records for tag, value in c['gold'].items()}
    results = [metrics(p.parent, gold) for p in sorted((root / 'runs').glob('*/run.json'))]
    save(root / 'results.json', {'design': read(root / 'design.json'), 'pricing': PRICING, 'runs': results})
    lines = ['# Annotation skill microbenchmark', '',
             'Same pre-extracted evidence, all five dimensions per section, independent ephemeral CLI runs. Only exact human-labeled dimensions are scored. This is not end-to-end discovery/dispatch/audit latency.', '',
             '| Run | Exact gold | Presence gold | Seconds | Seconds / section | Input | Cached input | Output | API-equivalent USD |',
             '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
    for run in results:
        if run['status'] != 'completed':
            lines.append(f"| {run['job']} | {run['status']} | | | | | | | |")
            continue
        u = run['usage']
        lines.append(f"| {run['job']} | {run['exactMatches']}/{run['goldCount']} | {run['presenceMatches']}/{run['goldCount']} | {run['elapsedSeconds']:.1f} | {run['secondsPerSection']:.1f} | {u.get('input_tokens')} | {u.get('cached_input_tokens')} | {u.get('output_tokens')} | ${run['apiEquivalentUsd']:.3f} |")
    lines += ['', 'API-equivalent amounts use [official Standard Astra rates](https://developers.openai.com/api/docs/models/gpt-6-astra), checked 2026-09-07. These are not measured Codex subscription charges. Raw usage and cache-write counts are retained in results.json. Cache reuse and tool-reading choices differ between runs; a shorter skill alone does not establish a cost saving.', '',
              '## Exact matches by dimension', '', '| Run | Jack | Stream | Trill | Tech | LN coordination |',
              '| --- | ---: | ---: | ---: | ---: | ---: |']
    for run in results:
        if run['status'] != 'completed':
            continue
        cells = []
        for tag in TAGS:
            subset = [s for s in run['scored'] if s['tagId'] == tag]
            cells.append(f"{sum(s['exact'] for s in subset)}/{len(subset)}" if subset else 'unscored')
        lines.append('| ' + run['job'] + ' | ' + ' | '.join(cells) + ' |')
    repeated = [r for r in results if r['status'] == 'completed' and r['job'].startswith('new-skill-')]
    if len(repeated) == 2:
        predictions = [{(c['caseId'], j['tagId']): (j['presence'], j['salience'])
                        for c in read(root / 'runs' / r['job'] / 'response.json')['cases']
                        for j in c['judgments']} for r in repeated]
        shared = predictions[0].keys() & predictions[1].keys()
        agreement = sum(predictions[0][key] == predictions[1][key] for key in shared)
        lines += ['', f'The two new-skill runs agree exactly on {agreement}/{len(shared)} shared judgments across all five dimensions. This measures repeat consistency, not human accuracy.']
    lines += ['', '## Interpretation and limits', '',
              'One old-skill run and two new-skill runs are a small paired pilot, not a stable population estimate. Target labels are withheld, but calibration-informed selection and skill author exposure prevent a claim of pristine held-out generalization. Additional dimensions have no human gold.', '',
              'All arms receive the same complete pre-extracted section/context notes and the same five-dimension response contract. This isolates the skill comparison; it does not measure the benefit of multi-dimension inspection versus the previous single-target workflow. The design records exact source/mapset exclusions and sparse gold strata. Frozen inputs, producer IDs, requested model/effort, raw CLI events, elapsed time and token usage are retained under runs/. Mechanical output validity is separate from semantic correctness.', '']
    (root / 'report.md').write_text('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['run', 'report'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--campaign', type=Path, default=REPO / '.local/corpus-500-v2')
    args = parser.parse_args()
    if args.command == 'run':
        config = read(args.campaign / 'controller/config.json')
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(lambda p: run_job(p.parent, config), sorted((args.root / 'runs').glob('*/run.json'))))
    report(args.root)


if __name__ == '__main__':
    main()
