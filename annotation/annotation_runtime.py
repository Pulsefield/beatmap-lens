"""Shared selected-section worker execution and response contract."""
from datetime import datetime, timezone
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

def read(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run_job(job, config):
    job = Path(job).resolve()
    run = read(job / 'run.json')
    if run['status'] != 'prepared':
        return run
    for name, digest in run['inputHashes'].items():
        if sha(job / name) != digest:
            raise ValueError(f'Frozen benchmark input changed: {job / name}')
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
