"""Prepare a fresh attempt for a failed labeler that has delivered no sealed packets.

Only controller revision inputs and an unpublished-then-atomic assignment are
written. Original runs/results remain unchanged. Current feedback is read without
issuing a task; changed bases and partial deliveries require the reviewed revision
path instead. The dispatcher performs the new execution with its configured model.
Changing that model or reasoning effort requires --model-change-reason and retains
the original and requested settings in the recovery provenance.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import uuid


spec = importlib.util.spec_from_file_location(
    "annotation_revision", Path(__file__).with_name("prepare-annotation-revision.py"))
revision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(revision)
read, digest = revision.read, revision.digest


def verify_skill(directory, expected):
    manifest = directory / 'skill/manifest.json'
    if digest(manifest.read_bytes()) != expected['sha256']:
        raise ValueError('Frozen skill manifest changed')
    for entry in read(manifest)['files']:
        if digest((directory / 'skill' / entry['path']).read_bytes()) != entry['sha256']:
            raise ValueError(f"Frozen skill file changed: {entry['path']}")


def validate_frozen_task(path):
    # Read the original transport once in Node, using the same complete validation as import.
    program = r"""
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
const require=createRequire(resolve('apps/inspector/package.json'));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const server=await createServer({root:process.cwd(),configFile:false,
 server:{middlewareMode:true,ws:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]},
 resolve:{alias:{'beatmap-lens':resolve('packages/beatmap-lens/src/index.ts')}}});
try {
 const {assertTaskPacketV2}=await server.ssrLoadModule('/apps/inspector/src/annotation/workflow/domain.ts');
 const input=JSON.parse(gunzipSync(await readFile(process.argv[1])).toString('utf8'));
 const task=await assertTaskPacketV2(input);
 process.stdout.write(JSON.stringify({sourceSha256:task.source.sha256,taskId:task.taskId,
  taskSha256:task.taskSha256,foundationSha256:task.foundationSha256,base:task.base}));
} catch(error) {
 process.stderr.write(error.message+'\n'); process.exitCode=1;
} finally {await server.close();}
"""
    result = subprocess.run(['node', '--input-type=module', '-e', program, str(path)],
                            cwd=revision.REPO, text=True, capture_output=True)
    if result.returncode:
        raise ValueError(f'Frozen task validation failed: {result.stderr.strip()}')
    return json.loads(result.stdout)


def prepare(campaign, original_id, findings_file, model_change_reason=None):
    if model_change_reason is not None and not model_change_reason.strip():
        raise ValueError('--model-change-reason requires a nonempty explicit authorization')
    root = Path(campaign).resolve()
    if not re.fullmatch(r'[a-f0-9]{20}', original_id):
        raise ValueError('Expected the original opaque 20-character assignment ID')
    job = root / 'workers' / f'{original_id}-labeler'
    run_bytes = (job / 'run.json').read_bytes()
    run = json.loads(run_bytes)
    if (run['status'] not in ('execution-failed', 'acceptance-failed')
            or run['role'] != 'labeler' or run['assignmentId'] != original_id):
        raise ValueError('Recovery requires a terminal failed labeler for this assignment')
    if (list((job / 'packets').glob('*.json'))
            or list((job / 'receipts').glob('*.json'))
            or ((job / 'exchange.json').exists() and read(job / 'exchange.json')['charts'])):
        raise ValueError('Sealed packets or delivery receipts exist; use the reviewed revision path')
    config = read(root / 'controller/config.json')
    common = (root / config.get('workerCommonPath', 'worker-common')).resolve()
    if config['skill'] != run['skill']:
        raise ValueError('Recovery must preserve the original frozen skill')
    model_fields = [('models', 'requestedModel'), ('reasoningEfforts', 'requestedReasoningEffort')]
    original_model = {field: run.get(field) for _, field in model_fields}
    current_model = {field: config.get(key, {}).get('labeler') for key, field in model_fields}
    model_change = None
    if current_model != original_model:
        if model_change_reason is None:
            raise ValueError('Recovery must preserve the configured labeler model and reasoning effort unless --model-change-reason records explicit authorization')
        model_change = {'original': original_model, 'current': current_model,
                        'reason': model_change_reason.strip()}
    for name, expected in run['inputHashes'].items():
        if digest((job / name).read_bytes()) != expected:
            raise ValueError(f'Original worker input changed: {name}')
    for directory in (job, common):
        verify_skill(directory, config['skill'])
    if (digest((common / 'foundation.json').read_bytes()) != run['inputHashes']['foundation.json']
            or read(common / 'foundation.json')['foundationSha256'] != config['foundationSha256']):
        raise ValueError('Recovery Foundation changed')
    result_bytes = (job / 'result.json').read_bytes()
    if run.get('resultSha256') and digest(result_bytes) != run['resultSha256']:
        raise ValueError('Original labeler result changed')
    original_result = json.loads(result_bytes)
    findings_bytes = Path(findings_file).read_bytes()
    diagnostics = json.loads(findings_bytes)
    if (not isinstance(diagnostics, dict) or not isinstance(diagnostics.get('findings'), list)
            or not diagnostics['findings']
            or any(not isinstance(entry, dict) or not entry for entry in diagnostics['findings'])):
        raise ValueError('Findings file requires a nonempty structured findings array')
    assignment = read(job / 'assignment.json')
    bindings = read(job / 'bindings.json')
    charts = assignment['charts']
    maximum = min(2400000, config['maxDurationMs'])
    duration = sum(chart['durationMs'] for chart in charts)
    if not charts or duration != assignment['durationMs'] or not 0 < duration <= maximum:
        raise ValueError('Recovery must retain the original charts within 40 minutes')
    source_shas = {chart['sourceSha256'] for chart in charts}
    if len(source_shas) != len(charts) or len(bindings) != len(charts):
        raise ValueError('Original chart/binding coverage differs')
    if any(entry.get('sourceSha256', next(iter(source_shas))) not in source_shas
           for entry in diagnostics['findings']):
        raise ValueError('A recovery finding refers to an unassigned chart')
    prior = []
    task_copies = []
    for chart in charts:
        sha = chart['sourceSha256']
        if digest(Path(chart['parquetPath']).read_bytes()) != chart['parquetSha256']:
            raise ValueError(f'Original Parquet changed: {sha}')
        binding = revision.one(bindings, 'sourceSha256', sha)
        task_path = root / 'controller/tasks' / f'{original_id}-{sha}.json.gz'
        compressed = task_path.read_bytes()
        task = validate_frozen_task(task_path)
        if task['sourceSha256'] != sha:
            raise ValueError('Frozen task source differs')
        for key in ['taskId', 'taskSha256', 'foundationSha256', 'base']:
            if task[key] != binding[key]:
                raise ValueError(f'Frozen task differs from original binding: {key}')
        if binding['foundationSha256'] != config['foundationSha256']:
            raise ValueError('Recovery task Foundation changed')
        feedback, _ = revision.request(config['server'], f'feedback/{sha}')
        if (feedback['sourceSha256'] != sha or feedback['reviewBase'] != binding['base']
                or feedback['taskBinding']['foundationSha256'] != binding['foundationSha256']):
            raise ValueError('Source, Foundation or review base changed; recovery will not issue or rebase tasks')
        if any(header['agent']['producerId'] == run['producerId'] for header in feedback['handoffs']):
            raise ValueError('Original producer already delivered a handoff; use the reviewed revision path')
        task_copies.append((sha, compressed))
        prior.append({
            'sourceSha256': sha, 'taskBinding': binding, 'feedback': feedback,
            'originalTaskGzipSha256': digest(compressed),
            'originalTaskTextSha256': revision.expanded_task_hash(task_path),
            'reasons': [entry for entry in diagnostics['findings']
                        if entry.get('sourceSha256', sha) == sha],
        })
    new_id = uuid.uuid4().hex[:20]
    inputs = root / 'controller/revision-inputs' / new_id
    inputs.mkdir(parents=True, exist_ok=False)
    for sha, compressed in task_copies:
        target = root / 'controller/tasks' / f'{new_id}-{sha}.json.gz'
        with target.open('xb') as handle:
            handle.write(compressed)
        if digest(target.read_bytes()) != digest(compressed):
            raise ValueError('Copied frozen task bytes differ')
    for name, content in [('original-run.json', run_bytes), ('original-result.json', result_bytes),
                          ('findings.json', findings_bytes)]:
        (inputs / name).write_bytes(content)
    prior_review = {
        'kind': 'unsubmitted-labeler-recovery', 'assignmentId': new_id, 'revisionOf': original_id,
        'preparedAt': datetime.now(timezone.utc).isoformat(), 'supersedes': [],
        'originalRun': run, 'originalRunSha256': digest(run_bytes),
        'originalResult': original_result, 'originalResultSha256': digest(result_bytes),
        'originalAssignmentSha256': digest((job / 'assignment.json').read_bytes()),
        'originalBindingsSha256': digest((job / 'bindings.json').read_bytes()),
        'diagnostics': diagnostics, 'findingsSha256': digest(findings_bytes),
        **({'modelChange': model_change} if model_change else {}),
        'workerCommonPath': str(common),
        'workerCommonHashes': {str(path.relative_to(common)): digest(path.read_bytes())
                               for path in sorted(common.rglob('*')) if path.is_file()},
        'charts': prior,
        'instruction': 'This is a fresh execution after an unsubmitted failed result. Correct the retained findings; no original claim has a sealed handoff or independent audit, and no handoff is superseded.',
    }
    (inputs / 'prior-review.json').write_text(json.dumps(prior_review, ensure_ascii=False, indent=2) + '\n')
    revised = {**assignment, 'assignmentId': new_id, 'revisionOf': original_id,
               'maximumDurationMs': maximum, 'supersedes': []}
    directory = root / 'controller/revisions'
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f'{new_id}.json'
    temporary = directory / f'{new_id}.writing'
    temporary.write_text(json.dumps(revised, ensure_ascii=False, indent=2) + '\n')
    temporary.rename(path)
    return {'assignmentId': new_id, 'revisionOf': original_id, 'assignmentPath': str(path),
            'priorReviewPath': str(inputs / 'prior-review.json'), 'chartCount': len(charts),
            'durationMs': duration, 'supersedes': [], 'status': 'prepared-not-run',
            **({'modelChange': model_change} if model_change else {})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--campaign', type=Path, required=True)
    parser.add_argument('--assignment-id', required=True)
    parser.add_argument('--findings-file', type=Path, required=True)
    parser.add_argument('--model-change-reason',
                        help='Explicit authorization to use changed configured labeler model/effort; retained with both settings')
    args = parser.parse_args()
    try:
        result = prepare(args.campaign, args.assignment_id, args.findings_file, args.model_change_reason)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'{error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
