"""Run and report paired fixed-evidence/optional-harness annotation experiments."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import importlib.util
from itertools import combinations
import json
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('section_benchmark', Path(__file__).with_name('run-section-benchmark.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
read, save = base.read, base.save


def label(assessment):
    if assessment is None:
        return 'missing'
    if assessment['presence'] == 'present':
        return assessment.get('salience') or 'present without salience'
    return assessment['presence']


def prediction_label(cell):
    if cell.get('duplicatePrediction'):
        return 'duplicate prediction'
    return label(cell['predicted'])


def score_summary(cells):
    errors = [{**c, 'direction': label(c['expected']) + ' → ' + prediction_label(c)}
              for c in cells if not c['exact']]
    return {'goldCells': len(cells), 'exactMatches': sum(c['exact'] for c in cells),
            'presenceMatches': sum(c['presenceCorrect'] for c in cells),
            'errorDirections': dict(Counter(c['direction'] for c in errors)), 'errors': errors}


def cohort_scores(scored, cases):
    subsets = {
        'allGold': scored,
        'allTech': [s for s in scored if s['tagId'] == 'tech'],
        'exposedTech': [s for s in scored if s['tagId'] == 'tech' and cases[s['caseId']]['cohort'] == 'exposed-regression'],
        'freshTech': [s for s in scored if s['tagId'] == 'tech' and cases[s['caseId']]['cohort'] == 'fresh-tech-probe'],
        'freshSupportingTech': [s for s in scored if s['tagId'] == 'tech'
                                and cases[s['caseId']]['cohort'] == 'fresh-tech-probe'
                                and label(s['expected']) == 'supporting'],
        'freshAbsentTech': [s for s in scored if s['tagId'] == 'tech'
                            and cases[s['caseId']]['cohort'] == 'fresh-tech-probe'
                            and label(s['expected']) == 'absent'],
    }
    return {name: score_summary(cells) for name, cells in subsets.items()}


def paired_summary(baseline, candidate, cases):
    baseline_cells = {(s['caseId'], s['tagId']): s for s in baseline['scored']}
    paired = []
    for cell in candidate['scored']:
        old = baseline_cells[(cell['caseId'], cell['tagId'])]
        paired.append({'caseId': cell['caseId'], 'tagId': cell['tagId'], 'cohort': cases[cell['caseId']]['cohort'],
                       'expected': cell['expected'], 'baseline': old['predicted'], 'candidate': cell['predicted'],
                       'baselineExact': old['exact'], 'candidateExact': cell['exact']})
    subsets = {'allGold': paired, 'allTech': [p for p in paired if p['tagId'] == 'tech'],
               'exposedTech': [p for p in paired if p['tagId'] == 'tech' and p['cohort'] == 'exposed-regression'],
               'freshTech': [p for p in paired if p['tagId'] == 'tech' and p['cohort'] == 'fresh-tech-probe']}
    result = {'baseline': baseline['job'], 'candidate': candidate['job']}
    for name, cells in subsets.items():
        newly_correct = [p for p in cells if not p['baselineExact'] and p['candidateExact']]
        newly_wrong = [p for p in cells if p['baselineExact'] and not p['candidateExact']]
        result[name] = {'pairedCells': len(cells), 'newlyCorrectCount': len(newly_correct),
                        'newlyWrongCount': len(newly_wrong), 'netExactChange': len(newly_correct) - len(newly_wrong),
                        'newlyCorrect': newly_correct, 'newlyWrong': newly_wrong}
    return result


def unique_predictions(response):
    """Exclude missing/duplicate cells from agreement instead of shrinking its denominator."""
    case_counts = Counter(c['caseId'] for c in response['cases'])
    predictions = {}
    for case in response['cases']:
        counts = Counter(j['tagId'] for j in case['judgments'])
        for judgment in case['judgments']:
            if case_counts[case['caseId']] != 1 or counts[judgment['tagId']] != 1:
                continue
            presence, salience = judgment['presence'], judgment['salience']
            if (presence == 'present') != (salience in ('supporting', 'prominent')):
                continue
            predictions[(case['caseId'], judgment['tagId'])] = (presence, salience)
    return predictions


def agreement(first, second, case_ids):
    expected = {(case_id, tag) for case_id in case_ids for tag in base.TAGS}
    a, b = unique_predictions(first), unique_predictions(second)
    shared = expected & a.keys() & b.keys()
    return {'plannedCells': len(expected), 'comparableCells': len(shared),
            'exactAgreements': sum(a[key] == b[key] for key in shared),
            'missingOrInvalidInEither': len(expected) - len(shared),
            'disagreements': [{'caseId': key[0], 'tagId': key[1], 'first': a[key], 'second': b[key]}
                              for key in sorted(shared) if a[key] != b[key]],
            'interpretation': 'Repeat consistency across all five dimensions, not human accuracy.'}


def summarize_tools(trace, native):
    """Native completions include validation/transport failures absent from server traces."""
    completed = [e['item'] for e in native if e.get('type') == 'item.completed'
                 and e.get('item', {}).get('type') == 'mcp_tool_call' and e['item']['server'] == 'lens']

    def failed(call):
        result = call.get('result') or {}
        return bool(call.get('error') or call.get('status') == 'failed'
                    or result.get('isError') or result.get('is_error'))

    names = sorted({t['tool'] for t in trace} | {c['tool'] for c in completed})
    by_tool = {}
    for name in names:
        rows = [t for t in trace if t['tool'] == name]
        calls = [c for c in completed if c['tool'] == name]
        by_tool[name] = {'calls': len(calls) if completed else len(rows), 'tracedCalls': len(rows),
                         'failedCalls': sum(failed(c) for c in calls) if completed else sum(t.get('failed', False) for t in rows),
                         'responseBytes': sum(t['responseBytes'] for t in rows),
                         'repeatedCalls': sum(t.get('repeatCount', 1) > 1 for t in rows),
                         'imageCalls': sum(bool(t.get('imageBytes')) for t in rows),
                         'imageBytes': sum(t.get('imageBytes', 0) for t in rows),
                         'serverElapsedMs': round(sum(t['elapsedMs'] for t in rows), 3)}
    totals = {key: sum(row[key] for row in by_tool.values())
              for key in ('calls', 'tracedCalls', 'failedCalls', 'responseBytes', 'repeatedCalls', 'imageCalls', 'imageBytes')}
    return {**totals, 'byTool': by_tool, 'nativeCompletedCalls': len(completed),
            'nativeCompletionsWithoutTrace': max(0, len(completed) - len(trace)),
            'countBasis': 'Native completed lens calls when available; otherwise server trace.',
            'byteBasis': 'UTF-8 JSON response payloads in server trace; PNG bytes counted separately. Not token estimates.',
            'repeatBasis': 'Calls after the first with identical tool/arguments; repetition alone does not establish wasted work.'}


def tool_stats(job):
    trace_path, event_path = job / 'harness-trace.jsonl', job / 'events.jsonl'

    def events_so_far(path):
        if not path.exists():
            return []
        content = path.read_text()
        lines = content.splitlines()
        # CLI output can be midway through a large native-image event during a status report.
        if content and not content.endswith('\n'):
            lines = lines[:-1]
        return [json.loads(line) for line in lines]

    trace, events = events_so_far(trace_path), events_so_far(event_path)
    return {**summarize_tools(trace, events), 'tracePresent': trace_path.exists()}


def fraction(summary, field='exactMatches'):
    return f"{summary[field]}/{summary['goldCells']}" if summary['goldCells'] else 'unscored'


def markdown(result):
    runs = result['runs']
    done = [r for r in runs if r['status'] == 'completed']
    case_count = len(result['design']['cases'])
    planned = case_count * len(base.TAGS)
    gold_count = result['goldCells']
    lines = ['# Annotation harness benchmark', '', result['design']['classification'], '',
             f"{case_count} sections × five dimensions = {planned} predictions per run; only {gold_count} human cells are scored. The other {planned - gold_count} predictions remain unscored. Same semantic guide, scopes, requested model settings and output contract. The optional harness includes its ROLE workflow; fixed evidence does not. This is a whole-package comparison, not an isolated tool effect.", '',
             '| Run | Exact gold | Presence gold | Seconds | Input | Cached input | Cache writes | Output | Assumed API-equivalent USD |',
             '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
    for run in runs:
        if run['status'] != 'completed':
            lines.append(f"| {run['job']} | {run['status']} | | | | | | | |")
            continue
        usage = run['usage']
        lines.append(f"| {run['job']} | {run['exactMatches']}/{run['goldCount']} | {run['presenceMatches']}/{run['goldCount']} | {run['elapsedSeconds']:.1f} | {usage.get('input_tokens', 0)} | {usage.get('cached_input_tokens', 0)} | {usage.get('cache_write_input_tokens', 0)} | {usage.get('output_tokens', 0)} | ${run['apiEquivalentUsd']:.3f} |")
    lines += ['', 'Elapsed time includes each CLI worker and its tool use; it excludes preparation and human review. Three workers may run concurrently, so this pilot does not establish a stable speed/cost improvement.', '',
              'Dollar values assume the requested Astra model uses [Standard API pricing](https://developers.openai.com/api/docs/models/gpt-6-astra): $10/M uncached input, $1/M cached input, $12.50/M cache writes, $50/M output. Actual runtime routing/tier is unverified; these are hypothetical API equivalents, not billed Codex subscription charges. Each request is assumed within the 272K input tier; aggregate run usage alone cannot verify this. Missing cache-write usage is treated as zero by the shared estimator. Raw usage and assumptions are retained in results.json.', '',
              '## Tech cohorts', '',
              '| Run | Exposed exact / presence | Fresh exact / presence | Fresh supporting exact | Fresh absent exact |',
              '| --- | ---: | ---: | ---: | ---: |']
    for run in done:
        scores = run['cohorts']
        lines.append(f"| {run['job']} | {fraction(scores['exposedTech'])} / {fraction(scores['exposedTech'], 'presenceMatches')} | {fraction(scores['freshTech'])} / {fraction(scores['freshTech'], 'presenceMatches')} | {fraction(scores['freshSupportingTech'])} | {fraction(scores['freshAbsentTech'])} |")
    lines += ['', 'There are eight exposed Tech cases and eight fresh Tech probes, including six fresh supporting cases and two negatives. No fresh prominent Tech gold is available. All fresh human rationales are generic confirmations of the original proposals, not independently written explanations.', '',
              '## Paired changes against fixed evidence', '',
              'Each cell below is newly correct / newly wrong on exactly the same human-labeled cells.', '',
              '| Harness run | All gold | All Tech | Exposed Tech | Fresh Tech |',
              '| --- | ---: | ---: | ---: | ---: |']
    for pair in result['paired']:
        values = [f"{pair[name]['newlyCorrectCount']} / {pair[name]['newlyWrongCount']}"
                  for name in ('allGold', 'allTech', 'exposedTech', 'freshTech')]
        lines.append('| ' + pair['candidate'] + ' | ' + ' | '.join(values) + ' |')
    if not result['paired']:
        lines.append('Paired comparison awaits completed baseline and harness runs.')
    for item in result['repeatAgreement']:
        lines += ['', f"{item['firstRun']} and {item['secondRun']} agree on {item['exactAgreements']}/{item['plannedCells']} planned judgments ({item['comparableCells']} comparable; {item['missingOrInvalidInEither']} missing/invalid). This measures repeat consistency, not human accuracy."]
    lines += ['', '## Every fresh supporting prediction', '',
              '| Section | Human | ' + ' | '.join(r['job'] for r in runs) + ' |',
              '| --- | --- | ' + ' | '.join('---' for _ in runs) + ' |']
    for case in result['design']['cases']:
        if case['cohort'] != 'fresh-tech-probe' or label(case['goldAssessment']) != 'supporting':
            continue
        case_id = case['benchmarkCaseId']
        predictions = [next(prediction_label(c) for c in r['scored'] if c['caseId'] == case_id and c['tagId'] == 'tech')
                       if r['status'] == 'completed' else r['status'] for r in runs]
        title = case['title'].replace('|', '\\|')
        lines.append(f"| {case_id}: {title} | supporting | " + ' | '.join(predictions) + ' |')
    lines += ['', '## Tech disagreements by direction', '']
    for run in done:
        for name, description in (('exposedTech', 'exposed'), ('freshTech', 'fresh')):
            errors = run['cohorts'][name]['errors']
            text = '; '.join(f"{c['caseId']}: {c['direction']}" for c in errors) or 'none'
            lines.append(f"- {run['job']} ({description}): {text}.")
    lines += ['', '## Other scored dimensions', '', '| Run | Jack | Stream | Trill | LN coordination |',
              '| --- | ---: | ---: | ---: | ---: |']
    for run in done:
        values = [fraction(score_summary([s for s in run['scored'] if s['tagId'] == tag]))
                  for tag in base.TAGS if tag != 'tech']
        lines.append('| ' + run['job'] + ' | ' + ' | '.join(values) + ' |')
    lines += ['', '## Harness use', '',
              '| Run / tool | Calls | Failed | Repeated | JSON bytes | Images | PNG bytes |',
              '| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for run in runs:
        total = run['tools']
        for name, row in [('total', total), *total['byTool'].items()]:
            lines.append(f"| {run['job']} / {name} | {row['calls']} | {row['failedCalls']} | {row['repeatedCalls']} | {row['responseBytes']} | {row['imageCalls']} | {row['imageBytes']} |")
    lines += ['', 'Calls/failures use completed native lens events when available. JSON bytes and exact-argument repeats come from server traces; image bytes are separate. Schema/transport failures may have no server response-byte trace. Repetition counts alone do not establish whether a call was useful.', '',
              '## Mechanical verification', '']
    for run in runs:
        if run['status'] != 'completed':
            lines.append(f"- {run['job']}: {run['status']}; not scored yet.")
            continue
        errors = run['mechanicalErrors']
        lines.append(f"- {run['job']}: " + ('; '.join(errors) if errors else 'no mechanical output errors.')
                     + f" Input hashes unchanged: {run.get('inputsUnchanged', 'unavailable')}.")
    lines += ['', '## Interpretation limits', '',
              'Human labels are reviewable reference judgments. Scored mismatches are disagreements against this snapshot, not proof that the agent is wrong. Review source facts, reasoning, scope and the human decision together; 100% label reconstruction is not the harness objective.', '',
              'The exposed regression answers influenced development. Fresh probes exclude documented prior exposures, but developer selection remains calibration-informed; this is not pristine held-out or prevalence-weighted corpus accuracy. The small supporting-heavy sample cannot establish prominent-Tech generalization or prove that the recognition problem is solved. Follow-up ablations are needed to separate workflow, inspection and example-retrieval effects. Bundle preparation and tools enforce source/song exclusions in retrieval. Reading outside job inputs is prohibited by instructions, not OS read isolation. Source reasoning still requires independent audit even when the predicted label matches. Full paired cells, errors, provenance, usage, tool details and repeat disagreements remain in results.json; raw worker events and responses remain under runs/.', '']
    return '\n'.join(lines)


def report(root):
    root = Path(root)
    design = read(root / 'design.json')
    gold_records = read(root / 'gold.json')['cases']
    gold = {c['caseId'] + ':' + tag: value for c in gold_records for tag, value in c['gold'].items()}
    cases = {c['benchmarkCaseId']: c for c in design['cases']}
    runs = []
    for path in sorted((root / 'runs').glob('*/run.json')):
        run = base.metrics(path.parent, gold)
        run['tools'] = tool_stats(path.parent)
        if run['status'] == 'completed':
            run['cohorts'] = cohort_scores(run['scored'], cases)
        runs.append(run)
    baseline = [r for r in runs if r['status'] == 'completed' and not r.get('harness')]
    harness = [r for r in runs if r['status'] == 'completed' and r.get('harness')]
    paired = [paired_summary(b, h, cases) for b in baseline for h in harness]
    repeated = [{'firstRun': a['job'], 'secondRun': b['job'],
                 **agreement(read(root / 'runs' / a['job'] / 'response.json'),
                             read(root / 'runs' / b['job'] / 'response.json'), cases)}
                for a, b in combinations(harness, 2)]
    result = {'kind': 'annotation-harness-benchmark-v1', 'design': design, 'goldCells': len(gold),
              'pricing': base.PRICING, 'runs': runs, 'paired': paired, 'repeatAgreement': repeated,
              'assumptions': ['API-equivalent amounts are not billed Codex subscription charges.',
                              'Pricing assumes requested Astra model; actual runtime routing and tier are unverified.',
                              'Standard per-request input tier at most 272K; run aggregates do not verify each request tier.',
                              'Missing cache-write usage is treated as zero by the shared estimator.',
                              'Only exact human gold cells score accuracy; all other cells are unscored.',
                              'Matching labels do not independently validate source reasoning.']}
    if (root / 'runtime.json').exists():
        result['runtime'] = read(root / 'runtime.json')
    save(root / 'results.json', result)
    (root / 'report.md').write_text(markdown(result))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['run', 'report'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--campaign', type=Path, default=REPO / '.local/corpus-500-v2')
    args = parser.parse_args()
    if args.command == 'run':
        config = read(args.campaign / 'controller/config.json')
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(lambda p: base.run_job(p.parent, config), sorted((args.root / 'runs').glob('*/run.json'))))
    result = report(args.root)
    print(json.dumps({'root': str(args.root.resolve()),
                      'runs': [{'job': r['job'], 'status': r['status'], 'exactMatches': r.get('exactMatches'),
                                'goldCount': r.get('goldCount'), 'toolCalls': r['tools']['calls']}
                               for r in result['runs']]}))


if __name__ == '__main__':
    main()
