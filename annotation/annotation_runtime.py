"""Shared selected-section worker execution and response contract."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[1]


def load_module(path):
    path = Path(path)
    spec = importlib.util.spec_from_file_location(path.stem.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(path.parent))
    return module


TAGS = ('jack-organization', 'stream-organization', 'trill-organization', 'tech', 'ln-coordination')
MAX_SECTIONS_PER_WORKER = 4


def check_section_limit(count):
    if not 1 <= count <= MAX_SECTIONS_PER_WORKER:
        raise ValueError(f'Selected-section workers require 1–{MAX_SECTIONS_PER_WORKER} sections; '
                         'prepare a new bounded batch without editing frozen jobs.')


def read(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@contextmanager
def worker_lock(job):
    with (Path(job) / '.worker.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Worker job is already owned by another dispatcher: ' + str(job)) from None
        yield


def run_job(job, config):
    job = Path(job).resolve()
    with worker_lock(job):
        return _run_job(job, config)


def _run_job(job, config):
    """Execute while the caller holds worker_lock, including during recovery dispatch."""
    run = read(job / 'run.json')
    if run['status'] != 'prepared':
        return run
    for name, digest in run['inputHashes'].items():
        if sha(job / name) != digest:
            raise ValueError(f'Frozen benchmark input changed: {job / name}')
    # Read the assignments, not the informational caseCount in run.json.
    case_count = len(read(job / 'cases.json')['cases'])
    check_section_limit(case_count)
    if run['caseCount'] != case_count:
        raise ValueError('Worker caseCount differs from its frozen section assignments.')
    codex = config['codexCommand']
    harness_args = []
    if run.get('harness'):
        harness = run['harness']
        bundle = Path(harness['bundle'])
        if sha(bundle / 'manifest.json') != harness['manifestSha256']:
            raise ValueError('Frozen benchmark harness changed.')
        harness_args = ['-c', 'mcp_servers.lens.command=' + json.dumps(harness['python']),
                        '-c', 'mcp_servers.lens.args=' + json.dumps([
                            str(bundle / 'tools/annotation-harness.py'), '--bundle', str(bundle),
                            '--trace', str(job / 'harness-trace.jsonl')]),
                        '-c', 'mcp_servers.lens.required=true', '-c', 'mcp_servers.lens.startup_timeout_sec=30']
    command = [codex, '-a', 'never', 'exec', '--ignore-user-config', '-C', str(job),
               '--skip-git-repo-check', '--sandbox', 'workspace-write', '--ephemeral', '--json',
               '--model', run['requestedModel'], '-c', f'model_reasoning_effort="{run["requestedReasoningEffort"]}"',
               '-c', 'service_tier="default"', *harness_args, '--output-schema', str(job / 'response-schema.json'),
               '-o', str(job / 'response.json'), '-']
    run.update(command=command, toolVersion=subprocess.check_output([codex, '--version'], text=True).strip(),
               status='running', startedAt=datetime.now(timezone.utc).isoformat())
    save(job / 'run.json', run)
    start = time.monotonic()
    with (job / 'events.jsonl').open('w') as stdout, (job / 'stderr.log').open('w') as stderr:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr, text=True)
        run['pid'] = process.pid
        save(job / 'run.json', run)
        process.communicate((job / 'prompt.txt').read_text())
    run.update(elapsedSeconds=time.monotonic() - start, exitCode=process.returncode,
               finishedAt=datetime.now(timezone.utc).isoformat(), usage={}, threadIds=[])
    for line in (job / 'events.jsonl').read_text().splitlines():
        event = json.loads(line)
        if event.get('type') == 'thread.started':
            run['threadIds'].append(event['thread_id'])
        if event.get('type') == 'turn.completed':
            for key, value in event.get('usage', {}).items():
                run['usage'][key] = run['usage'].get(key, 0) + value
    run['status'] = 'completed' if process.returncode == 0 and (job / 'response.json').exists() else 'failed'
    run['inputsUnchanged'] = all(sha(job / name) == digest for name, digest in run['inputHashes'].items())
    if (job / 'response.json').exists():
        run['responseSha256'] = sha(job / 'response.json')
    save(job / 'run.json', run)
    print(json.dumps({'job': str(job), 'status': run['status'], 'seconds': round(run['elapsedSeconds'], 2), 'usage': run['usage']}), flush=True)
    return run


def response_schema():
    def obj(properties):
        return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}
    return obj({'cases': {'type': 'array', 'items': obj({'caseId': {'type': 'string'},
        'judgments': {'type': 'array', 'items': obj({'tagId': {'type': 'string', 'enum': list(TAGS)},
            'presence': {'type': 'string', 'enum': ['present', 'absent', 'unresolved']},
            'salience': {'type': ['string', 'null'], 'enum': ['supporting', 'prominent', None]},
            'rationale': {'type': 'array', 'items': {'type': 'string'}},
            'noteLines': {'type': 'array', 'items': {'type': 'integer'}},
            'contextLines': {'type': 'array', 'items': {'type': 'integer'}}})}})}})


def main():
    parser = argparse.ArgumentParser(description='Execute one frozen selected-section worker job.')
    parser.add_argument('--job', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True, help='Campaign controller configuration.')
    args = parser.parse_args()
    run = run_job(args.job, read(args.config))
    print(json.dumps({'job': str(args.job.resolve()), **{
        key: run[key] for key in ('status', 'producerId', 'caseCount') if key in run}}))
    return 0 if run['status'] == 'completed' else 1


if __name__ == '__main__':
    sys.exit(main())
