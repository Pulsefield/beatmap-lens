r"""Prepare a fresh revision assignment from submitted labeler/auditor artifacts.

Example:
  python3 scripts/prepare-annotation-revision.py --campaign .local/corpus-500 \
    --assignment-id ORIGINAL_ID --source-sha SOURCE_SHA [--source-sha ANOTHER_SHA]

Only preparation occurs: publish controller/revisions/<newId>.json after copying
its original frozen tasks and writing revision-inputs/<newId>/prior-review.json.
The dispatcher must run a fresh labeler and independent auditor. Existing runs,
results, packets and tasks are never changed. Saved feedback is used as supplied;
the coordinator can refresh it before preparation. --reason adds an explicit
coordinator explanation without replacing the original audit's findings.
When human review changed the base, the default refuses preparation. Explicit
--current-base issues a new frozen task through the configured service and retains
the old task binding, bytes and packet lineage. It does not change Foundation/skill.
"""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid


REPO = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(Path(path).read_text())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical_hashes(packets):
    # Use the actual protocol serializer rather than a second Python JSON convention.
    program = r"""
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(resolve('apps/inspector/package.json'));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const server=await createServer({root:process.cwd(),configFile:false,server:{middlewareMode:true,ws:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
try {
 const {serializeCanonicalJson}=await server.ssrLoadModule('/apps/inspector/src/annotation/canonical-json.ts');
 let input='';
 for await (const chunk of process.stdin) input+=chunk;
 const packets=JSON.parse(input);
 process.stdout.write(JSON.stringify(packets.map(packet=>createHash('sha256').update(serializeCanonicalJson(packet)).digest('hex'))));
} finally {await server.close();}
"""
    result = subprocess.run(['node', '--input-type=module', '-e', program], cwd=REPO,
                            input=json.dumps(packets, ensure_ascii=False), text=True,
                            capture_output=True, check=True)
    return json.loads(result.stdout)


def one(entries, key, value):
    matches = [entry for entry in entries if entry[key] == value]
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one {key}={value}')
    return matches[0]


def expanded_task_hash(path):
    result = hashlib.sha256()
    with gzip.open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def request(server, path, body=None):
    payload = None if body is None else json.dumps(body).encode()
    req = Request(f"{server.rstrip('/')}/api/review/{path}", data=payload,
                  headers={'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=60) as response:
            raw = response.read()
    except HTTPError as error:
        detail = json.loads(error.read())
        raise ValueError(f"HTTP {error.code}: {detail['error']}") from error
    return json.loads(raw), raw


def current_task(config, prior):
    sha = prior['sourceSha256']
    task, raw = request(config['server'], f'task/{sha}', {})
    if (task['source']['sha256'] != sha
            or task['foundationSha256'] != prior['taskBinding']['foundationSha256']
            or task['foundationSha256'] != config['foundationSha256']):
        raise ValueError('Current task changed the source or frozen Foundation')
    feedback, _ = request(config['server'], f'feedback/{sha}')
    if feedback['sourceSha256'] != sha or feedback['reviewBase'] != task['base']:
        raise ValueError('Human review changed again after task issuance; no revision was published')
    if task['taskSha256'] == prior['taskBinding']['taskSha256']:
        raise ValueError('Current-base issuance did not create a new frozen task')
    reviews = [{'claim': entry.get('modifiedClaim', entry['summary']),
                'status': entry['status'],
                **({'decision': entry['decision']} if 'decision' in entry else {})}
               for entry in feedback['agentReviews']]
    binding = {'sourceSha256': sha,
               **{key: task[key] for key in ['taskId', 'taskSha256', 'foundationSha256', 'base']},
               'existingReviews': reviews, 'humanObservations': feedback['directObservations']}
    compressed = gzip.compress(raw, mtime=0)
    prior['currentTask'] = {'issuedFrom': f'POST /api/review/task/{sha}',
                            'taskBinding': binding, 'feedback': feedback,
                            'taskGzipSha256': digest(compressed), 'taskTextSha256': digest(raw)}
    return sha, compressed, digest(raw)


def revision_reasons(auditor_result, feedback, handoff_id, coordinator_reason, allow_empty=False):
    reasons = [dict(kind='claim', **entry) for entry in auditor_result['claims']
               if entry['outcome'] == 'needs-revision']
    reasons += [dict(kind='question', **entry) for entry in auditor_result['questions']
                if entry['disposition'] == 'needs-revision']
    if auditor_result['coverageReview']['outcome'] == 'needs-revision':
        reasons.append(dict(kind='coverage', **auditor_result['coverageReview']))
    reasons += [{'kind': 'human-rejection', 'claimId': entry['claimId'],
                 'decision': entry['decision']} for entry in feedback['agentReviews']
                if entry['handoffId'] == handoff_id and entry['status'] == 'rejected']
    if coordinator_reason:
        reasons.append({'kind': 'coordinator', 'rationale': coordinator_reason})
    if not reasons and not allow_empty:
        raise ValueError('Selected chart has no saved revision finding; provide an explicit --reason')
    return reasons


def prepare(campaign, original_id, source_shas, reason=None, current_base=False):
    root = Path(campaign).resolve()
    if not re.fullmatch(r'[a-f0-9]{20}', original_id):
        raise ValueError('Expected the original opaque 20-character assignment ID')
    if len(set(source_shas)) != len(source_shas) or any(
            not re.fullmatch(r'[a-f0-9]{64}', sha) for sha in source_shas):
        raise ValueError('Choose distinct full source SHA-256 values')
    label_job = root / 'workers' / f'{original_id}-labeler'
    audit_job = root / 'workers' / f'{original_id}-auditor'
    label_run, audit_run = read(label_job / 'run.json'), read(audit_job / 'run.json')
    for role, run in [('labeler', label_run), ('auditor', audit_run)]:
        if run['status'] != 'submitted' or run['role'] != role or run['assignmentId'] != original_id:
            raise ValueError(f'Original {role} run must be submitted for this assignment')
    if label_run['producerId'] == audit_run['producerId']:
        raise ValueError('Original audit must have an independent producer')
    assignment = read(label_job / 'assignment.json')
    audit_assignment = read(audit_job / 'assignment.json')
    label_result, audit_result = read(label_job / 'result.json'), read(audit_job / 'result.json')
    bindings = read(label_job / 'bindings.json')
    charts = [one(assignment['charts'], 'sourceSha256', sha) for sha in source_shas]
    config = read(root / 'controller/config.json')
    maximum = min(2400000, config['maxDurationMs'])
    if current_base and (config['skill'] != label_run['skill'] or config['skill'] != audit_run['skill']):
        raise ValueError('Current-base revision must preserve the original frozen skill')
    duration = sum(chart['durationMs'] for chart in charts)
    if not charts or duration <= 0 or duration > maximum:
        raise ValueError('Revision chart duration must be positive and at most 40 minutes')
    prior = []
    task_copies = []
    packets = []
    for chart in charts:
        sha = chart['sourceSha256']
        audit_chart = one(audit_assignment['charts'], 'sourceSha256', sha)
        if audit_chart['parquetSha256'] != chart['parquetSha256']:
            raise ValueError('Labeler and auditor chart inputs differ')
        if digest(Path(chart['parquetPath']).read_bytes()) != chart['parquetSha256']:
            raise ValueError('Original Parquet changed')
        handoff = read(label_job / 'packets' / f'{sha}.json')
        if read(audit_job / 'handoffs' / f'{sha}.json') != handoff:
            raise ValueError('Auditor did not receive this exact original handoff')
        audit = read(audit_job / 'packets' / f'{sha}.json')
        feedback = json.loads(gzip.decompress((audit_job / 'feedback' / f'{sha}.json.gz').read_bytes()))
        binding = one(bindings, 'sourceSha256', sha)
        if not current_base and feedback['reviewBase'] != binding['base']:
            raise ValueError('Human review changed this task base. Use explicit --current-base to issue a new task while preserving the original frozen task.')
        for role, packet, run in [('labeler', handoff, label_run), ('auditor', audit, audit_run)]:
            if packet['agent']['role'] != role or packet['agent']['producerId'] != run['producerId']:
                raise ValueError('Packet producer differs from original execution')
            for key in ['sourceSha256', 'taskId', 'taskSha256', 'foundationSha256', 'base']:
                if packet[key] != binding[key]:
                    raise ValueError(f'Original packet differs from frozen task binding: {key}')
        if feedback['sourceSha256'] != sha or audit['handoffId'] != handoff['handoffId']:
            raise ValueError('Original review source/handoff identity differs')
        saved_handoff = one(feedback['handoffs'], 'handoffId', handoff['handoffId'])
        saved_audit = one(feedback['audits'], 'auditId', audit['auditId'])
        audit_chart_result = one(audit_result['charts'], 'sourceSha256', sha)
        if audit_chart_result['claims'] != audit['claims'] or audit_chart_result['questions'] != audit['questions']:
            raise ValueError('Saved auditor result differs from sealed audit')
        reasons = revision_reasons(audit_chart_result, feedback, handoff['handoffId'], reason,
                                   allow_empty=current_base)
        task_path = root / 'controller/tasks' / f'{original_id}-{sha}.json.gz'
        compressed = task_path.read_bytes()
        task_copies.append((sha, compressed, expanded_task_hash(task_path)))
        prior.append({'sourceSha256': sha, 'reasons': reasons, 'handoff': handoff, 'audit': audit,
                      'feedback': feedback,
                      'labelerResult': one(label_result['charts'], 'sourceSha256', sha),
                      'auditorResult': audit_chart_result, 'taskBinding': binding,
                      'originalTaskGzipSha256': digest(compressed),
                      'originalTaskTextSha256': task_copies[-1][2],
                      'supersedes': {'sourceSha256': sha, 'handoffId': handoff['handoffId'],
                                     'handoffSha256': saved_handoff['handoffSha256'],
                                     'auditId': audit['auditId'], 'auditSha256': saved_audit['auditSha256']}})
        packets.extend([handoff, audit])
    hashes = canonical_hashes(packets)
    for index, entry in enumerate(prior):
        reference = entry['supersedes']
        if (hashes[index * 2] != reference['handoffSha256']
                or entry['audit']['handoffSha256'] != reference['handoffSha256']
                or hashes[index * 2 + 1] != reference['auditSha256']):
            raise ValueError('Original packet content differs from its canonical review hash')
    if current_base:
        task_copies = [current_task(config, entry) for entry in prior]
        for entry in prior:
            entry['reasons'] = revision_reasons(entry['auditorResult'], entry['currentTask']['feedback'],
                                                 entry['handoff']['handoffId'], reason)
    new_id = uuid.uuid4().hex[:20]
    inputs = root / 'controller/revision-inputs' / new_id
    inputs.mkdir(parents=True, exist_ok=False)
    for sha, compressed, expanded_hash in task_copies:
        target = root / 'controller/tasks' / f'{new_id}-{sha}.json.gz'
        with target.open('xb') as handle:
            handle.write(compressed)
        if digest(target.read_bytes()) != digest(compressed) or expanded_task_hash(target) != expanded_hash:
            raise ValueError('Copied frozen task bytes differ')
    prior_review = {'assignmentId': new_id, 'revisionOf': original_id,
                    'preparedAt': datetime.now(timezone.utc).isoformat(), 'charts': prior}
    (inputs / 'prior-review.json').write_text(json.dumps(prior_review, ensure_ascii=False, indent=2) + '\n')
    revised = {'kind': assignment['kind'], 'assignmentId': new_id, 'revisionOf': original_id,
               'durationMs': duration, 'maximumDurationMs': maximum, 'charts': charts,
               'supersedes': [entry['supersedes'] for entry in prior]}
    directory = root / 'controller/revisions'
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f'{new_id}.json'
    temporary = directory / f'{new_id}.writing'
    temporary.write_text(json.dumps(revised, ensure_ascii=False, indent=2) + '\n')
    temporary.rename(path)  # Publish only after all immutable task copies and review inputs exist.
    return {'assignmentId': new_id, 'revisionOf': original_id, 'assignmentPath': str(path),
            'priorReviewPath': str(inputs / 'prior-review.json'), 'chartCount': len(charts),
            'durationMs': duration, 'supersedes': revised['supersedes'], 'status': 'prepared-not-run'}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--campaign', type=Path, required=True)
    parser.add_argument('--assignment-id', required=True)
    parser.add_argument('--source-sha', action='append', required=True,
                        help='Full source SHA-256; repeat for multiple charts within 40 minutes')
    parser.add_argument('--reason', help='Additional coordinator rationale; saved findings remain intact')
    parser.add_argument('--current-base', action='store_true',
                        help='Explicitly issue new tasks at the current human review base; preserve old tasks')
    args = parser.parse_args()
    try:
        result = prepare(args.campaign, args.assignment_id, args.source_sha, args.reason, args.current_base)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'{error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
