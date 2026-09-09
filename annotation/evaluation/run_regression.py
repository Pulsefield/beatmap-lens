"""Prepare or execute three selected-section production-prompt judgment repeats."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import shutil
import sys

import regression_gate as gate


REPO = gate.REPO
sys.path.insert(0, str(REPO / 'annotation'))
import annotation_runtime as runtime
from playback_rate import playback_rate_fields


def prepare(root, campaign, feedback_dir, python, repeats=gate.REPEATS):
    if repeats < gate.REPEATS:
        raise ValueError(f'At least {gate.REPEATS} independent repeats are required.')
    root, campaign, feedback_dir = (Path(p).resolve() for p in (root, campaign, feedback_dir))
    production = runtime.load_module(REPO / 'annotation/pipeline/run-fine-annotation.py')
    harness = runtime.load_module(REPO / 'harness/prepare-annotation-harness.py')
    benchmark = runtime.load_module(REPO / 'annotation/evaluation/prepare-harness-benchmark.py')
    suite = gate.read(REPO / gate.SUITE)
    config = gate.read(campaign / 'controller/config.json')
    source_map = {c['source']['sha256']: c for c in gate.read(campaign / 'admin/source-map.json')}
    sources = gate.source_snapshot()
    root.mkdir(parents=True, exist_ok=False)
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
    foundation = {k: v for k, v in original.items() if k != 'calibrationExamples'}
    common = root / 'common'
    production.freeze_skill(root)
    gate.save(common / 'foundation.json', foundation)
    for role in ('labeler', 'auditor'):
        shutil.copyfile(REPO / 'annotation/roles' / f'harness-{role}.md', common / f'{role}.md')
    binding = {'sourceSha256': gate.digest(sources), 'suiteSha256': gate.digest(suite),
               'coverage': 'selected-section-labeler', 'harnessManifestSha256': gate.sha(bundle / 'manifest.json'),
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
            'harness': {'bundle': str(bundle), 'manifestSha256': gate.sha(bundle / 'manifest.json'),
                        'python': str(Path(python).absolute())},
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
    if gate.source_snapshot() != sources:
        raise ValueError('Annotation sources changed while preparing the comparison.')
    gate.save(root / 'regression.json', {'sources': sources, 'suiteSha256': gate.digest(suite),
                                       'binding': binding, 'repeats': planned,
                                       'harnessFiles': manifest['files'],
                                       'runner': {'codexCommand': config['codexCommand']}})
    return {'status': 'prepared-not-launched', 'root': str(root), 'repeats': repeats,
            'sectionsPerRepeat': len(cases), 'jobs': sum(len(r['jobs']) for r in planned),
            'coverage': 'selected-section-labeler', 'sourceSha256': gate.digest(sources)}


def run(root, concurrency=3):
    root = Path(root).resolve()
    preparation = gate.read(root / 'regression.json')
    bundle = root / 'harness'
    if gate.sha(bundle / 'manifest.json') != preparation['binding']['harnessManifestSha256'] or any(
            gate.sha(bundle / name) != sha for name, sha in preparation['harnessFiles'].items()):
        raise ValueError('Frozen evaluation harness changed.')
    jobs = [root / job for repeat in preparation['repeats'] for job in repeat['jobs']]
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        outputs = list(pool.map(lambda job: runtime.run_job(job, preparation['runner']), jobs))
    return {'status': 'completed' if all(o['status'] == 'completed' for o in outputs) else 'incomplete',
            'jobs': len(outputs)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    command = commands.add_parser('prepare')
    command.add_argument('--root', type=Path, required=True)
    command.add_argument('--campaign', type=Path, required=True)
    command.add_argument('--feedback-dir', type=Path, required=True)
    command.add_argument('--python', default=sys.executable)
    command.add_argument('--repeats', type=int, default=gate.REPEATS)
    command = commands.add_parser('run', help='Launches paid/model-usage-consuming workers.')
    command.add_argument('--root', type=Path, required=True)
    command.add_argument('--concurrency', type=int, default=3)
    args = parser.parse_args()
    result = prepare(args.root, args.campaign, args.feedback_dir, args.python, args.repeats) \
        if args.command == 'prepare' else run(args.root, args.concurrency)
    import json
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result['status'] == 'incomplete':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
