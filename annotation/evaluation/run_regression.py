"""Prepare or execute three selected-section production-prompt judgment repeats."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

import regression_gate as gate
import high_confidence_suite as human_gold


REPO = Path(os.environ.get('ANNOTATION_REGRESSION_SOURCE_REPO', gate.REPO)).resolve()
sys.path.insert(0, str(REPO / 'annotation'))
# The gate retains its own canonical rate helpers. Production imports below must
# resolve against the selected checkout in this fresh adapter process.
if REPO != gate.REPO:
    sys.modules.pop('playback_rate', None)
import annotation_runtime as runtime
from playback_rate import playback_rate_fields


def source_process(command, source_repo, arguments):
    """Keep old/new production imports isolated; do not copy candidate code into baseline."""
    with TemporaryDirectory(prefix='annotation-regression-adapter-') as temporary:
        result_file = Path(temporary) / 'result.json'
        environment = {**os.environ, 'ANNOTATION_REGRESSION_SOURCE_REPO': str(Path(source_repo).resolve())}
        script = ('import json,sys; from pathlib import Path; '
                  'sys.path.insert(0,sys.argv[1]); import run_regression as adapter; '
                  'result=getattr(adapter,sys.argv[2])(**json.loads(sys.argv[3])); '
                  'Path(sys.argv[4]).write_text(json.dumps(result))')
        result = subprocess.run([sys.executable, '-c', script, str(Path(__file__).resolve().parent),
                                 command, json.dumps(arguments), str(result_file)],
                                env=environment, text=True, capture_output=True)
        if result.returncode:
            raise ValueError('Selected source checkout failed: ' + (result.stderr or result.stdout).strip())
        if result.stdout:
            print(result.stdout, end='')
        return gate.read(result_file)


def prepare(root, campaign, feedback_dir, python, suite_path, repeats=gate.REPEATS, source_repo=None):
    if source_repo and Path(source_repo).resolve() != REPO:
        return source_process('prepare', source_repo, {
            'root': str(root), 'campaign': str(campaign), 'feedback_dir': str(feedback_dir),
            'python': str(python), 'suite_path': str(suite_path), 'repeats': repeats})
    if repeats < gate.REPEATS:
        raise ValueError(f'At least {gate.REPEATS} independent repeats are required.')
    root, campaign, feedback_dir = (Path(p).resolve() for p in (root, campaign, feedback_dir))
    production = runtime.load_module(REPO / 'annotation/pipeline/run-fine-annotation.py')
    harness = runtime.load_module(REPO / 'harness/prepare-annotation-harness.py')
    benchmark = runtime.load_module(REPO / 'annotation/evaluation/prepare-harness-benchmark.py')
    suite = gate.read(suite_path)
    human_gold.validate_suite(suite)
    config = gate.read(campaign / 'controller/config.json')
    source_map = {c['source']['sha256']: c for c in gate.read(campaign / 'admin/source-map.json')}
    missing = sorted({c['sourceSha256'] for c in suite['cases']} - source_map.keys())
    if missing:
        raise ValueError('Current High gold sources are missing from the campaign; none may be omitted: ' + ', '.join(missing))
    sources, adapter = gate.source_snapshot(REPO), gate.adapter_snapshot()
    root.mkdir(parents=True, exist_ok=False)
    gate.save(root / 'gold-suite.json', suite)
    sections = [{**{k: c[k] for k in ('caseId', 'sourceSha256', 'scope', 'reviewContext')},
                 **playback_rate_fields(c)} for c in suite['cases']]
    gate.save(root / 'sections.json', {'sections': sections})
    groups = benchmark.song_groups(source_map)
    bundle = root / 'harness'
    harness.prepare(campaign, root / 'sections.json', feedback_dir, bundle, 'evaluation', groups)
    manifest = gate.read(bundle / 'manifest.json')
    target_groups = {groups[c['sourceSha256']] for c in suite['cases']}
    if any(e['groupId'] in target_groups for e in gate.read(bundle / 'examples.json')):
        raise ValueError('Target song judgments entered the evaluation harness.')
    cases = production.preparer.source_cases({'cases': [{**s, 'benchmarkCaseId': s['caseId']} for s in sections]},
                                             campaign, source_map)
    original = gate.read(campaign / config['workerCommonPath'] / 'foundation.json')
    if original['foundationSha256'] != config['foundationSha256']:
        raise ValueError('Campaign Foundation pin differs from its definitions.')
    if any(pin['foundationSha256'] != config['foundationSha256'] for case in suite['cases']
           for pins in case['humans'].values() for pin in pins):
        raise ValueError('High gold Foundation differs from campaign definitions; cannot silently omit cells.')
    foundation = {k: v for k, v in original.items() if k != 'calibrationExamples'}
    common = root / 'common'
    production.freeze_skill(root)
    gate.save(common / 'foundation.json', foundation)
    for role in ('labeler', 'auditor'):
        shutil.copyfile(REPO / 'annotation/roles' / f'harness-{role}.md', common / f'{role}.md')
    harness_binding = {'bundle': str(bundle), 'manifestSha256': gate.sha(bundle / 'manifest.json'),
                       'python': str(Path(python).absolute())}
    binding = {'sourceSha256': gate.digest(sources), 'suiteSha256': gate.digest(suite),
               'coverage': 'selected-section-labeler', 'harnessManifestSha256': gate.sha(bundle / 'manifest.json'),
               'harness': harness_binding,
               'evaluationAdapterSha256': gate.digest(adapter),
               'foundationSha256': gate.sha(common / 'foundation.json'),
               'evaluationDataSha256': gate.digest({
                   'foundation': foundation,
                   'sourceMapSha256': manifest['provenance']['sourceMapSha256'],
                   'feedbackFiles': manifest['provenance']['feedbackFiles'],
                   'sourceParquets': {source: gate.sha(campaign / 'agent/charts' / (source + '.parquet'))
                                      for source in sorted(source_map)},
               })}
    planned = []
    for number in range(1, repeats + 1):
        repeat = root / 'repeats' / f'{number:02d}'
        shutil.copytree(common, repeat / 'common')
        gate.save(repeat / 'preparation.json', {
            'harness': harness_binding,
        })
        jobs = []
        for index, group in enumerate(production.pack_cases(cases, 5, 28000), 1):
            job = production.prepare_job(repeat, group, 'labeler', config, index)
            # Reuse the actual production prompt. Evaluation changes the supplied
            # record visibility, never a second copy of judgment instructions.
            gate.save(job / 'regression-binding.json', binding)
            run = gate.read(job / 'run.json')
            run['inputHashes']['regression-binding.json'] = gate.sha(job / 'regression-binding.json')
            gate.save(job / 'run.json', run)
            jobs.append(str(job.relative_to(root)))
        planned.append({'repeat': number, 'jobs': jobs})
    if gate.source_snapshot(REPO) != sources or gate.adapter_snapshot() != adapter:
        raise ValueError('Annotation sources changed while preparing the comparison.')
    gate.save(root / 'regression.json', {'sources': sources, 'suiteSha256': gate.digest(suite),
                                       'sourceRepo': str(REPO), 'evaluationAdapter': adapter,
                                       'binding': binding, 'repeats': planned,
                                       'harnessFiles': manifest['files'],
                                       'runner': {'codexCommand': config['codexCommand']}})
    return {'status': 'prepared-not-launched', 'root': str(root), 'repeats': repeats,
            'sectionsPerRepeat': len(cases), 'jobs': sum(len(r['jobs']) for r in planned),
            'coverage': 'selected-section-labeler', 'sourceSha256': gate.digest(sources)}


def run(root, concurrency=3):
    root = Path(root).resolve()
    preparation = gate.read(root / 'regression.json')
    if Path(preparation['sourceRepo']).resolve() != REPO:
        return source_process('run', preparation['sourceRepo'], {'root': str(root), 'concurrency': concurrency})
    suite = gate.read(root / 'gold-suite.json')
    human_gold.validate_suite(suite)
    if gate.digest(suite) != preparation['suiteSha256']:
        raise ValueError('Frozen human gold suite changed.')
    if (gate.source_snapshot(REPO) != preparation['sources'] or
            gate.adapter_snapshot() != preparation['evaluationAdapter']):
        raise ValueError('Annotation sources changed since preparation.')
    bundle = root / 'harness'
    if gate.sha(bundle / 'manifest.json') != preparation['binding']['harnessManifestSha256'] or any(
            gate.sha(bundle / name) != sha for name, sha in preparation['harnessFiles'].items()):
        raise ValueError('Frozen evaluation harness changed.')
    jobs = [root / job for repeat in preparation['repeats'] for job in repeat['jobs']]
    for job in jobs:
        if gate.read(job / 'regression-binding.json') != preparation['binding']:
            raise ValueError('Worker source binding differs: ' + str(job))
        gate.require_harness_binding(root, preparation['binding'], gate.read(job / 'run.json'))
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        outputs = list(pool.map(lambda job: runtime.run_job(job, preparation['runner']), jobs))
    return {'status': 'completed' if all(o['status'] == 'completed' for o in outputs) else 'incomplete',
            'jobs': len(outputs)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    command = commands.add_parser('freeze', help='Read all current canonical High judgments once for both sides.')
    command.add_argument('--workflow-dir', type=Path, required=True, help='Canonical Review workspace root.')
    command.add_argument('--out', type=Path, required=True, help='New controller-only suite JSON; never overwritten.')
    command = commands.add_parser('prepare')
    command.add_argument('--root', type=Path, required=True)
    command.add_argument('--campaign', type=Path, required=True)
    command.add_argument('--feedback-dir', type=Path, required=True)
    command.add_argument('--suite', type=Path, required=True, help='One frozen suite shared by baseline and candidate.')
    command.add_argument('--source-repo', type=Path,
                         help='Checkout owning the production preparer, skill, harness and execution runtime.')
    command.add_argument('--python', default=sys.executable)
    command.add_argument('--repeats', type=int, default=gate.REPEATS)
    command = commands.add_parser('run', help='Launches paid/model-usage-consuming workers.')
    command.add_argument('--root', type=Path, required=True)
    command.add_argument('--concurrency', type=int, default=3)
    args = parser.parse_args()
    try:
        if args.command == 'freeze':
            result = human_gold.freeze(args.workflow_dir, args.out)
        elif args.command == 'prepare':
            result = prepare(args.root, args.campaign, args.feedback_dir, args.python, args.suite, args.repeats,
                             args.source_repo)
        else:
            result = run(args.root, args.concurrency)
    except (OSError, ValueError, KeyError) as error:
        print(json.dumps({'status': 'failed', 'errors': [str(error)]}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result['status'] == 'incomplete':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
