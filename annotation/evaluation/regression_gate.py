"""Require fresh, reviewed judgment comparisons when annotation behavior changes."""
import argparse
from collections import Counter
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'annotation'))
from playback_rate import same_playback_rate
import high_confidence_suite as human_gold
DIRECTORY = Path(__file__).resolve().parent
# These paths remain historical artifacts, never active selection or evidence defaults.
SUITE = 'annotation/evaluation/cases.json'
BASELINE = 'annotation/evaluation/source-baseline.json'
EVIDENCE = 'annotation/evaluation/accepted-evidence.json'
REPEATS = 3
ADAPTER_FILES = (
    *(f'annotation/evaluation/{name}' for name in
      ('regression_gate.py', 'run_regression.py', 'high_confidence_suite.py',
       'read-current-human-feedback.mjs', 'run-section-benchmark.py')),
    'apps/inspector/src/annotation/workflow/domain.ts',
    'apps/inspector/src/annotation/workflow/contracts.ts',
    'apps/inspector/src/annotation/workflow/directory.ts',
    'apps/inspector/src/annotation/canonical-json.ts',
    'apps/inspector/server/workflow-local-directory.mjs',
)
# These are coverage boundaries, not a claim that labeler replay certifies every role.
SOURCES = {
    'labeler': (
        '.agents/skills/mania-pattern-judgment/*',
        'annotation/roles/harness-labeler.md', 'annotation/roles/labeler.md',
        'harness/*.py', 'pyproject.toml', 'uv.lock', '.python-version',
        'annotation/annotation_runtime.py', 'annotation/section_evidence.py', 'annotation/playback_rate.py',
        'annotation/evaluation/run_regression.py', 'annotation/evaluation/run-section-benchmark.py',
        'annotation/evaluation/regression_gate.py', 'annotation/evaluation/high_confidence_suite.py',
        'annotation/evaluation/read-current-human-feedback.mjs',
        'annotation/evaluation/prepare-harness-benchmark.py',
        *ADAPTER_FILES,
    ),
    'auditor': ('annotation/roles/*auditor.md', 'annotation/pipeline/section_annotation_delivery.py'),
    'discovery': ('annotation/roles/corpus-labeler.md', 'annotation/roles/query-corpus-labeler.md',
                  'annotation/roles/curator.md', 'annotation/pipeline/run-annotation-campaign.py',
                  'annotation/pipeline/prepare-annotation-corpus.*',
                  'annotation/pipeline/prepare-query-*.py',
                  'annotation/pipeline/prepare-query-*.mjs'),
    'selected-workflow': ('annotation/pipeline/run-fine-annotation.py',
                          'annotation/pipeline/fine-annotation-campaign.py',
                          'annotation/pipeline/prepare-annotation-re*.py',
                          'annotation/pipeline/check-annotation-result.py',
                          'annotation/pipeline/campaign-exchange.mjs'),
    'foundation': ('apps/inspector/src/annotation/foundation.ts',
                   'apps/inspector/src/annotation/workflow/query-campaign.ts'),
}


def read(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git_bytes(repo, ref, path):
    return subprocess.check_output(['git', 'show', f'{ref}:{path}'], cwd=repo, stderr=subprocess.DEVNULL)


def source_snapshot(repo=REPO, ref=None):
    repo = Path(repo)
    if ref:
        names = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', ref], cwd=repo,
                                        text=True).splitlines()
    else:
        roots = {pattern.split('/')[0] for patterns in SOURCES.values() for pattern in patterns}
        paths = (repo / root for root in roots)
        names = [str(p.relative_to(repo)) for path in paths
                 for p in ([path] if path.is_file() else path.rglob('*')) if p.is_file()]
    files = {}
    for role, patterns in SOURCES.items():
        selected = sorted(name for name in names if any(fnmatch.fnmatchcase(name, p) for p in patterns)
                          and '/tests/' not in name and '/test_' not in name and '.test.' not in name
                          and '/__pycache__/' not in name and '/node_modules/' not in name)
        files[role] = {name: hashlib.sha256(git_bytes(repo, ref, name) if ref else
                                          (repo / name).read_bytes()).hexdigest() for name in selected}
    return {'files': files}


def adapter_snapshot(repo=REPO):
    repo = Path(repo)
    return {name: sha(repo / name) for name in ADAPTER_FILES if (repo / name).exists()}


def changed_roles(baseline, candidate):
    roles = sorted(role for role in SOURCES if baseline['files'].get(role) != candidate['files'].get(role))
    return roles


def cell_key(case_id, tag):
    return case_id + ':' + tag


def compare(evidence, suite, baseline, candidate):
    """Recompute the gate from compact scored receipts; never trust a saved pass flag."""
    errors, regressions = [], []
    try:
        human_gold.validate_suite(suite)
    except (ValueError, KeyError) as error:
        return {'passed': False, 'errors': [str(error)]}
    if evidence.get('kind') != 'annotation-regression-evidence-v2':
        errors.append('Missing regression evidence contract.')
    if evidence.get('suite') != suite:
        errors.append('Evidence does not retain the exact frozen human gold suite.')
    if evidence.get('baseline') != baseline or evidence.get('candidate') != candidate:
        errors.append('Evidence belongs to different baseline/candidate sources.')
    if evidence.get('suiteSha256') != digest(suite):
        errors.append('Evidence belongs to another regression corpus.')
    expected = {cell_key(c['caseId'], tag): gold for c in suite['cases'] for tag, gold in c['gold'].items()}
    critical = {cell_key(c['caseId'], tag) for c in suite['cases'] if c['critical'] for tag in c['gold']}
    sides = {}
    producer_ids, settings, input_hashes, data_hashes = [], set(), set(), set()
    if not evidence.get('evaluationAdapter'):
        errors.append('Missing shared evaluation adapter identity.')
    for side in ('baseline', 'candidate'):
        runs = evidence.get('runs', {}).get(side, [])
        sides[side] = []
        if len(runs) < REPEATS:
            errors.append(f'{side}: at least {REPEATS} complete independent repeats required.')
        for index, run in enumerate(runs):
            label = f'{side} repeat {index + 1}'
            if run.get('status') != 'completed' or run.get('mechanicalErrors') != []:
                errors.append(label + ': incomplete or mechanically invalid output.')
            if run.get('sourceSha256') != digest(evidence.get(side)):
                errors.append(label + ': source identity differs.')
            if run.get('suiteSha256') != digest(suite):
                errors.append(label + ': frozen gold identity differs.')
            if run.get('evaluationAdapterSha256') != digest(evidence.get('evaluationAdapter')):
                errors.append(label + ': shared evaluation adapter differs.')
            if not run.get('producerIds') or not run.get('responseSha256'):
                errors.append(label + ': missing completed-worker receipt.')
            producer_ids += run.get('producerIds', [])
            settings.add((run.get('model'), run.get('reasoningEffort')))
            input_hashes.add(run.get('casesSha256'))
            data_hashes.add(run.get('evaluationDataSha256'))
            cells = run.get('cells', [])
            keys = [cell_key(c['caseId'], c['tagId']) for c in cells]
            if Counter(keys) != Counter(expected.keys()):
                errors.append(label + ': scored case/tag coverage differs.')
            predictions = {cell_key(c['caseId'], c['tagId']): c.get('predicted') for c in cells}
            valid = ({'presence': 'absent'}, {'presence': 'unresolved'},
                     {'presence': 'present', 'salience': 'supporting'},
                     {'presence': 'present', 'salience': 'prominent'})
            if any(prediction not in valid for prediction in predictions.values()):
                errors.append(label + ': missing or invalid scored prediction.')
            sides[side].append(predictions)
            if side == 'candidate':
                failures = sorted(key for key in critical if predictions.get(key) != expected[key])
                errors.extend(label + ': protected case failed: ' + key for key in failures)
    if len(set(producer_ids)) != len(producer_ids):
        errors.append('Repeat workers are reused; independent producer IDs required.')
    if len(settings) != 1 or any(None in setting for setting in settings):
        errors.append('Baseline and candidate model/effort settings differ or are missing.')
    if len(input_hashes) != 1 or None in input_hashes:
        errors.append('Baseline and candidate source sections differ or are missing.')
    if len(data_hashes) != 1 or None in data_hashes:
        errors.append('Baseline and candidate Foundation/source/example input data differ or are missing.')
    if len(sides['baseline']) != len(sides['candidate']):
        errors.append('Baseline and candidate repeat counts differ.')
    for key, gold in expected.items():
        lost = [i + 1 for i, (old, new) in enumerate(zip(sides['baseline'], sides['candidate']))
                if old.get(key) == gold and new.get(key) != gold]
        if lost:
            regressions.append({'cell': key, 'repeats': lost, 'critical': key in critical})
    review = evidence.get('review', {})
    if review.get('comparisonSha256') != digest({k: evidence.get(k) for k in
                                                ('baseline', 'candidate', 'suiteSha256', 'runs')}):
        errors.append('Review does not bind this exact comparison.')
    if not review.get('reviewer', '').strip() or not review.get('rationaleReview', '').strip():
        errors.append('Named source-reasoning review is required; matching labels alone cannot pass.')
    dispositions = review.get('regressions', {})
    for regression in regressions:
        key = regression['cell']
        if regression['critical']:
            continue
        disposition = dispositions.get(key, {})
        if disposition.get('decision') != 'accept' or not disposition.get('reason', '').strip():
            errors.append('Broader regression requires an explicit accepted disposition: ' + key)
    return {'passed': not errors, 'coverage': 'selected-section-labeler', 'errors': errors,
            'regressions': regressions, 'criticalCells': len(critical), 'goldCells': len(expected),
            'repeatCounts': {side: len(runs) for side, runs in sides.items()}}


def check(repo=REPO, evidence_path=None, base_ref=None, workflow_dir=None):
    repo = Path(repo)
    baseline_path = repo / BASELINE
    if base_ref:
        subprocess.check_output(['git', 'rev-parse', '--verify', base_ref + '^{commit}'], cwd=repo,
                                stderr=subprocess.DEVNULL)
        # Initial gate introduction has no prior contract. The reviewed migration
        # snapshot is the only bootstrap; later PRs are anchored to their base tree.
        exists = subprocess.run(['git', 'cat-file', '-e', f'{base_ref}:{BASELINE}'], cwd=repo,
                                stderr=subprocess.DEVNULL).returncode == 0
        baseline = source_snapshot(repo, base_ref) if exists else read(baseline_path)['snapshot']
    else:
        baseline = read(baseline_path)['snapshot']
    # Historical snapshots pinned the old static corpus alongside code. That
    # corpus is no longer active source identity; current gold is bound separately.
    baseline = {'files': baseline['files']}
    candidate = source_snapshot(repo)
    roles = changed_roles(baseline, candidate)
    if not roles and not evidence_path:
        return {'passed': True, 'status': 'annotation-sources-unchanged', 'changedCoverage': []}
    unsupported = sorted(set(roles) - {'labeler'})
    if unsupported:
        return {'passed': False, 'changedCoverage': roles, 'errors': [
            'Role-specific replay is not implemented for: ' + ', '.join(unsupported) +
            '. Add its regression coverage; selected-section judgment evidence cannot approve it.']}
    if not evidence_path or not Path(evidence_path).exists():
        return {'passed': False, 'changedCoverage': roles,
                'errors': ['Annotation sources changed. Supply explicit --evidence from a fresh automatic '
                           'High-gold comparison; historical accepted-evidence.json is not a fallback.']}
    if not workflow_dir:
        return {'passed': False, 'changedCoverage': roles,
                'errors': ['--workflow-dir is required to verify current canonical human gold; '
                           'a frozen feedback cache cannot establish currentness.']}
    evidence = read(evidence_path)
    suite = evidence.get('suite', {})
    human_gold.require_current(suite, workflow_dir)
    if evidence.get('evaluationAdapter') != adapter_snapshot(repo):
        return {'passed': False, 'changedCoverage': roles, 'errors': ['Evidence uses another evaluation adapter.']}
    return {'changedCoverage': roles, **compare(evidence, suite, baseline, candidate)}


def require_harness_binding(root, binding, run):
    expected = binding.get('harness', {})
    if (not expected.get('python') or
            Path(expected.get('bundle', '')).resolve() != (Path(root) / 'harness').resolve() or
            expected.get('manifestSha256') != binding['harnessManifestSha256'] or
            run.get('harness') != expected):
        raise ValueError('Worker runtime harness differs from the frozen evaluation harness.')


def capture(root, suite):
    """Validate local worker outputs with the existing scorer and retain small receipts."""
    root = Path(root)
    sys.path.insert(0, str(REPO / 'annotation'))
    from annotation_runtime import load_module
    scorer = load_module(DIRECTORY / 'run-section-benchmark.py')
    preparation = read(root / 'regression.json')
    human_gold.validate_suite(suite)
    if read(root / 'gold-suite.json') != suite:
        raise ValueError('Prepared side does not use the same frozen comparison suite.')
    if preparation['suiteSha256'] != digest(suite):
        raise ValueError('Prepared run uses a different regression corpus.')
    if preparation['binding']['sourceSha256'] != digest(preparation['sources']):
        raise ValueError('Prepared source identity differs from worker binding.')
    if preparation['binding'].get('suiteSha256') != digest(suite):
        raise ValueError('Worker binding differs from the frozen gold suite.')
    if (preparation.get('evaluationAdapter') != adapter_snapshot() or
            preparation['binding'].get('evaluationAdapterSha256') != digest(preparation['evaluationAdapter'])):
        raise ValueError('Frozen shared evaluation adapter changed.')
    bundle = root / 'harness'
    if sha(bundle / 'manifest.json') != preparation['binding']['harnessManifestSha256'] or any(
            sha(bundle / name) != value for name, value in preparation['harnessFiles'].items()):
        raise ValueError('Frozen evaluation harness changed.')
    gold = {cell_key(c['caseId'], t): g for c in suite['cases'] for t, g in c['gold'].items()}
    expected_cases = {c['caseId']: c for c in suite['cases']}
    receipts = []
    for repeat in preparation['repeats']:
        cells, producers, responses, mechanical, cases = [], [], [], [], []
        models, efforts = set(), set()
        for relative in repeat['jobs']:
            job = root / relative
            run = read(job / 'run.json')
            if run['status'] != 'completed' or run.get('exitCode') != 0:
                raise ValueError('Worker not completed: ' + relative)
            if run.get('inputsUnchanged') is not True:
                raise ValueError('Worker inputs changed during execution or lack a completed integrity receipt: ' + relative)
            require_harness_binding(root, preparation['binding'], run)
            required = {'cases.json', 'prompt.txt', 'ROLE.md', 'foundation.json', 'regression-binding.json'}
            if not required <= run['inputHashes'].keys():
                raise ValueError('Worker receipt lacks frozen input hashes: ' + relative)
            if any(sha(job / name) != value for name, value in run['inputHashes'].items()):
                raise ValueError('Frozen worker inputs changed: ' + relative)
            if sha(job / 'response.json') != run['responseSha256']:
                raise ValueError('Worker response changed: ' + relative)
            binding = read(job / 'regression-binding.json')
            if binding != preparation['binding']:
                raise ValueError('Worker source binding differs: ' + relative)
            if sha(job / 'foundation.json') != binding['foundationSha256']:
                raise ValueError('Worker Foundation differs from comparison inputs: ' + relative)
            metrics = scorer.metrics(job, gold)
            mechanical.extend(metrics['mechanicalErrors'])
            cells.extend({k: c[k] for k in ('caseId', 'tagId', 'predicted')} for c in metrics['scored'])
            producers.append(run['producerId'])
            responses.append(run['responseSha256'])
            models.add(run['requestedModel'])
            efforts.add(run['requestedReasoningEffort'])
            cases.extend(read(job / 'cases.json')['cases'])
        if Counter(c['caseId'] for c in cases) != Counter(expected_cases.keys()):
            raise ValueError('Worker section coverage differs from regression corpus.')
        for case in cases:
            if (any(case[k] != expected_cases[case['caseId']][k] for k in ('sourceSha256', 'scope', 'reviewContext'))
                    or not same_playback_rate(case, expected_cases[case['caseId']])):
                raise ValueError('Worker source, scope, or playback rate differs: ' + case['caseId'])
            if (case.get('existingHumanJudgments') or case.get('originalReferences') or
                    any(key in case for key in ('gold', 'confidence', 'human', 'humans'))):
                raise ValueError('Target review answers leaked into worker cases.')
        if len(models) != 1 or len(efforts) != 1:
            raise ValueError('Model/effort differs within one repeat.')
        receipts.append({'status': 'completed', 'sourceSha256': digest(preparation['sources']),
                         'suiteSha256': digest(suite),
                         'evaluationAdapterSha256': preparation['binding']['evaluationAdapterSha256'],
                         'producerIds': producers, 'responseSha256': digest(responses),
                         'model': models.pop(), 'reasoningEffort': efforts.pop(),
                         'casesSha256': digest(sorted(cases, key=lambda c: c['caseId'])),
                         'evaluationDataSha256': preparation['binding']['evaluationDataSha256'],
                         'mechanicalErrors': mechanical, 'cells': cells})
    return preparation['sources'], receipts


def collect(baseline_root, candidate_root, review_path, out):
    suite = read(Path(baseline_root) / 'gold-suite.json')
    baseline, old = capture(baseline_root, suite)
    candidate, new = capture(candidate_root, suite)
    result = {'kind': 'annotation-regression-evidence-v2', 'baseline': baseline, 'candidate': candidate,
              'evaluationAdapter': read(Path(baseline_root) / 'regression.json')['evaluationAdapter'],
              'suite': suite, 'suiteSha256': digest(suite), 'runs': {'baseline': old, 'candidate': new}}
    review = read(review_path) if review_path else {'reviewer': '', 'rationaleReview': '', 'regressions': {}}
    result['review'] = review
    result['review']['comparisonSha256'] = digest({k: result[k] for k in
                                                  ('baseline', 'candidate', 'suiteSha256', 'runs')})
    # A review authored for older receipts must not be rebound automatically.
    if review_path and read(review_path).get('comparisonSha256') != result['review']['comparisonSha256']:
        raise ValueError('Review must name the comparisonSha256 from the unreviewed evidence.')
    save(out, result)
    return compare(result, suite, baseline, candidate)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    command = commands.add_parser('check')
    default_base = os.environ.get('ANNOTATION_REGRESSION_BASE') or None
    if default_base and set(default_base) == {'0'}:
        default_base = None  # First push: no earlier Git tree; use the reviewed initial snapshot.
    command.add_argument('--base-ref', default=default_base,
                         help='CI base ref (or ANNOTATION_REGRESSION_BASE); anchors the comparison to its base tree.')
    command.add_argument('--evidence', type=Path)
    command.add_argument('--workflow-dir', type=Path,
                         help='Canonical Review workspace root, required when changed sources need evidence.')
    command = commands.add_parser('compare')
    command.add_argument('--baseline', type=Path, required=True)
    command.add_argument('--candidate', type=Path, required=True)
    command.add_argument('--review', type=Path)
    command.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = check(evidence_path=args.evidence, base_ref=args.base_ref,
                       workflow_dir=args.workflow_dir) if args.command == 'check' else \
            collect(args.baseline, args.candidate, args.review, args.out)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        result = {'passed': False, 'errors': [str(error)]}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['passed'] else 1)


if __name__ == '__main__':
    main()
