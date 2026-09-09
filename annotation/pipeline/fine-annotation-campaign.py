"""Continue bounded, independently audited fine annotation toward an explicit section target."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
from urllib.request import urlopen

REPO = Path(__file__).resolve().parents[2]


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


fine = module('run-fine-annotation')
priorities = module('annotation-priorities')
read, save = fine.read, fine.save


def now():
    return datetime.now(timezone.utc).isoformat()


def initialize(root, campaign, target=None, python=None):
    path = root / 'config.json'
    source = read(campaign / 'controller/config.json')
    if not path.exists():
        save(path, {'kind': 'fine-annotation-campaign-v1', 'createdAt': now(),
                    'campaign': str(campaign), 'target': target or 4000, 'baselineCompleteCount': 0,
                    'foundationSha256': source['foundationSha256'], 'batchSize': 25,
                    'concurrency': 5, 'maxSections': 5, 'maxBriefCharacters': 28000, 'seed': 20260907,
                    'python': python or os.environ.get('ANNOTATION_PYTHON', sys.executable), 'batches': []})
    config = read(path)
    if (config['campaign'] != str(campaign) or config['foundationSha256'] != source['foundationSha256']
            or target is not None and target != config['target']):
        raise ValueError('Campaign, approved Foundation, and target must match the persisted configuration.')
    return config


def adopt(root, config, path):
    path = path.resolve()
    if any(batch['path'] == str(path) for batch in config['batches']):
        return
    prepared = read(path / 'preparation.json')
    if (prepared['kind'] != 'fine-annotation-harness-v1' or prepared['coverageMode'] != 'selected-sections'
            or prepared['campaign'] != config['campaign']
            or read(path / 'common/foundation.json')['foundationSha256'] != config['foundationSha256']):
        raise ValueError('Only a prepared selected-section batch under the pinned Foundation can be adopted.')
    config['batches'].append({'id': path.name, 'path': str(path),
                              'snapshot': str(Path(prepared['queuePath']).parent),
                              'bundle': prepared['harness']['bundle'], 'adoptedAt': now()})
    save(root / 'config.json', config)


def batch_state(batch):
    path = Path(batch['path'])
    runs = [read(p) for p in sorted((path / 'runs').glob('*/run.json'))]
    errors = [read(p) for p in sorted((path / 'controller-errors').glob('*.json'))]
    deliveries = [read(p) for p in sorted((path / 'delivery').glob('*/delivery-result.json'))]
    failed = [r['status'] for r in runs if r['status'] not in ('prepared', 'running', 'completed')]
    blocked = [d['status'] for d in deliveries if d['status'] == 'blocked']
    pending = [cell for d in deliveries for cell in d.get('skippedCells', []) if cell.get('conflict')]
    labelers = list((path / 'runs').glob('labeler-*'))
    if (path / 'preparation.json').exists():
        def key(case):
            return (case.get('caseId', case.get('benchmarkCaseId', case.get('sectionId'))),
                    case['sourceSha256'], *priorities.bounds(case))
        expected = Counter(key(case) for case in read(path / 'sections.json')['sections'])
        actual = Counter(key(case) for job in labelers if (job / 'run.json').exists()
                         for case in read(job / 'cases.json')['cases'])
        if expected != actual or any(not (job / 'run.json').exists() for job in labelers):
            errors.append({'error': 'Incomplete frozen labeler preparation; inspect missing or duplicate case assignments.',
                           'missingCases': list((expected - actual).elements()),
                           'unexpectedCases': list((actual - expected).elements())})
    delivered = all((path / 'delivery' / job.name / 'delivery-result.json').exists()
                    and read(path / 'delivery' / job.name / 'delivery-result.json')['status']
                    in ('complete', 'reused-existing', 'needs-controller') for job in labelers)
    state = ('needs-controller' if errors or failed or blocked else
             'complete' if labelers and delivered and all(r['status'] == 'completed' for r in runs)
             else 'in-progress')
    return {'id': batch['id'], 'path': batch['path'], 'status': state,
            'runStatuses': dict(Counter(r['status'] for r in runs)),
            'errors': errors, 'failedRuns': failed, 'blockedDeliveries': blocked, 'pendingCells': pending}


def completed_judgments(path, batch_id):
    result = {}
    for job in sorted((path / 'runs').glob('labeler-*')):
        run_path = job / 'run.json'
        if not run_path.exists():
            continue
        run = read(run_path)
        if run['status'] != 'completed' or not run.get('inputsUnchanged'):
            continue
        response = job / 'response.json'
        if fine.sha(response) != run['responseSha256']:
            raise ValueError('Completed labeler response changed: ' + str(response))
        manifest = path / 'delivery' / job.name / 'packets/manifest.json'
        skipped = {(cell['caseId'], cell['tagId']): cell for cell in read(manifest)['skippedCells']} if manifest.exists() else {}
        for case in read(response)['cases']:
            judgments = []
            for judgment in case['judgments']:
                assessment = {'presence': judgment['presence']}
                if judgment['presence'] == 'present':
                    assessment['salience'] = judgment['salience']
                cell = skipped.get((case['caseId'], judgment['tagId']), {})
                judgments.append({'tagId': judgment['tagId'], 'assessment': assessment,
                                  'skippedReason': cell.get('reason'), 'skippedConflict': cell.get('conflict', False)})
            result[case['caseId']] = {'batchId': batch_id, 'caseId': case['caseId'],
                'producerId': run['producerId'], 'responsePath': str(response),
                'responseSha256': run['responseSha256'], 'skill': run['skill'], 'judgments': judgments}
    return result


def registered_sections(config):
    sections = {}
    for batch in config['batches']:
        path = Path(batch['path'])
        section_path = path / 'sections.json'
        queue_path = Path(batch['snapshot']) / 'queue.json'
        if not section_path.exists() and not queue_path.exists():
            continue
        preparation = read(path / 'preparation.json') if (path / 'preparation.json').exists() else {}
        judgments = completed_judgments(path, batch['id'])
        snapshot = {}
        for index, section in enumerate(read(section_path if section_path.exists() else queue_path)['sections'], 1):
            sha = section['sourceSha256']
            if sha not in snapshot:
                snapshot[sha] = read(Path(batch['snapshot']) / 'feedback' / (sha + '.json'))
            case_id = section.get('benchmarkCaseId', section.get('sectionId', f'section-{index:03d}'))
            key = (sha, *priorities.bounds(section))
            record = sections.setdefault(key, {'sourceSha256': sha, 'scope': section['scope'], 'registrations': []})
            record['registrations'].append({'batchId': batch['id'], 'caseId': case_id,
                'skill': preparation.get('skill'),
                'sourceFeedback': {k: snapshot[sha].get(k) for k in ('documentVersion', 'reviewBase')}})
            if case_id in judgments:
                record['latestLabeler'] = judgments[case_id]
    return list(sections.values())


def account_section(section, feedback):
    """Keep the original requested unit; clipped claims supply coverage, never new counted units."""
    human, machine, signals = priorities.feedback_labels(feedback)
    conflicts = priorities.human_conflicts(human)
    target = [priorities.bounds(section)]
    origins = {}
    handoffs = {item['handoffId']: item for item in feedback.get('handoffs', [])}
    for row in feedback.get('agentReviews', []):
        claim = row.get('modifiedClaim', row['summary'])
        handoff = handoffs.get(row['handoffId'], {})
        origins[id(claim)] = {k: row[k] for k in ('claimId', 'handoffId', 'status', 'baseStatus') if k in row}
        origins[id(claim)].update(auditIds=[a['auditId'] for a in row.get('audits', [])],
                                  decisionId=row.get('decision', {}).get('id'),
                                  base=handoff.get('base'), agent=handoff.get('agent'))
    for observation in feedback.get('effectiveHumanObservations', feedback.get('directObservations', [])):
        claim = observation.get('claim', observation.get('summary'))
        origin = observation.get('origin', {})
        origins[id(claim)] = {'observationId': observation['id'], 'claimId': claim['id'],
                             **{key: origin[key] for key in ('handoffId', 'decisionId') if key in origin},
                             **{key: observation[key] for key in ('observationSha256', 'trust') if key in observation}}
    issues = [{'issueId': '/'.join((section['sourceSha256'], s['handoffId'], s['claimId'])),
               'tagId': s['claim']['tagId'], 'scope': s['claim']['scope'],
               **{k: s[k] for k in ('status', 'question', 'expertReason') if k in s}}
              for s in signals if s['kind'] == 'openReview'
              and priorities.intersect(target, [priorities.bounds(s['claim'])])]
    conflicts = [c for c in conflicts if priorities.intersect(target, c['ranges'])]
    dimensions, skipped_conflicts = {}, []
    intended = {j['tagId']: j for j in section.get('latestLabeler', {}).get('judgments', [])}
    for tag in priorities.TAGS:
        human_ranges = [priorities.bounds(c) for c in human if c['tagId'] == tag]
        cuts = [r for c in conflicts if c['tagId'] == tag for r in c['ranges']]
        contributions = []
        for tier, claims, removed in (('human', human, cuts), ('machine', machine, human_ranges)):
            for claim in claims:
                if claim['tagId'] != tag:
                    continue
                ranges = priorities.intersect(target, priorities.subtract([priorities.bounds(claim)], removed))
                if ranges:
                    contributions.append({**origins[id(claim)], 'tier': tier, 'scope': claim['scope'],
                                          'assessment': claim['assessment'], 'coveredRanges': ranges})
        ranges = [r for claim in contributions for r in claim['coveredRanges']]
        dimensions[tag] = {'missingRanges': priorities.subtract(target, ranges), 'claims': contributions}
        judgment = intended.get(tag, {})
        if judgment.get('skippedConflict'):
            incompatible = [c for c in contributions if c['tier'] == 'machine' and c['scope'] == section['scope']
                            and c['assessment'] != judgment['assessment']]
            if incompatible:
                skipped_conflicts.append({'tagId': tag, 'reason': judgment['skippedReason'],
                    'intendedAssessment': judgment['assessment'],
                    'ranges': priorities.union(r for c in incompatible for r in c['coveredRanges']),
                    'canonicalClaims': [{k: c[k] for k in ('handoffId', 'claimId', 'assessment')} for c in incompatible]})
    complete = all(not d['missingRanges'] for d in dimensions.values())
    state = ('blocked' if issues or conflicts or skipped_conflicts else 'complete' if complete else
             'partial' if any(d['claims'] for d in dimensions.values()) else 'pending')
    return {**section, 'status': state, 'dimensions': dimensions, 'openIssues': issues,
            'humanConflicts': conflicts, 'skippedMachineConflicts': skipped_conflicts,
            'sourceFeedback': {k: feedback.get(k) for k in ('documentVersion', 'reviewBase')}}


def fetch_feedback(server, sha):
    with urlopen(server.rstrip('/') + '/api/review/feedback/' + sha, timeout=60) as response:
        return json.load(response)


def status(root, config):
    sections = registered_sections(config)
    source = read(Path(config['campaign']) / 'controller/config.json')
    started = now()
    def fetch(sha):
        value = fetch_feedback(source['server'], sha)
        if value['sourceSha256'] != sha or value['taskBinding']['foundationSha256'] != config['foundationSha256']:
            raise ValueError('Canonical feedback source or Foundation differs: ' + sha)
        save(root / 'feedback' / (sha + '.json'), value)
        return sha, value
    with ThreadPoolExecutor(max_workers=4) as pool:
        feedback = dict(pool.map(fetch, sorted({s['sourceSha256'] for s in sections})))
    ledger = [account_section(section, feedback[section['sourceSha256']]) for section in sections]
    save(root / 'ledger.json', {'updatedAt': now(), 'sections': ledger})
    counts = Counter(s['status'] for s in ledger)
    batches = [batch_state(b) for b in config['batches']]
    result = {'updatedAt': now(), 'feedbackReadStartedAt': started, 'canonicalFresh': True,
              'target': config['target'], 'baselineCompleteCount': 0, 'attemptedCount': len(ledger),
              'completeCount': counts['complete'], 'sectionStatuses': dict(counts),
              'targetReached': counts['complete'] >= config['target'], 'batches': batches,
              'pendingIssueIds': sorted({i['issueId'] for s in ledger for i in s['openIssues']}),
              'controllerStatus': 'needs-controller' if any(b['status'] == 'needs-controller' for b in batches) else 'ready'}
    return report(root, config, result)


def report(root, config, result):
    save(root / 'progress.json', result)
    command = shlex.join([config['python'], str(Path(__file__).resolve()), 'advance', '--root', str(root),
                          '--campaign', config['campaign']])
    lines = ['# Fine annotation campaign', '',
             f"{result.get('completeCount', 0)} / {config['target']} complete selected sections; baseline 0.",
             f"Controller: {result['controllerStatus']}. Canonical feedback fresh: {result.get('canonicalFresh', False)}.",
             'Only registered source/scope units count, once, after full five-dimension settled coverage.',
             'Old whole-chart acceptance, unresolved labels, stale machine labels and conflicting human coverage do not count.',
             '', 'The ledger preserves every attempted scope, exact contributing claims and current review bases.',
             'Open issues remain pending and attempted scopes are excluded from future selection.',
             '[Continuation notes and scheduled follow-ups](CONTINUATION.md).',
             '', '## Resume', '', '`' + command + '`', '',
             'Each advance resumes an unfinished batch or runs one new batch, using at most five workers.',
             'New batches read fresh feedback and freeze the current skill; prepared batches keep their original inputs.',
             'A busy dispatcher is skipped. Inspect controller-errors, incomplete preparation and blocked delivery receipts before retrying failures.',
             'Do not delete frozen jobs, reopen settled human decisions, or mark progress from worker status.',
             '', 'Pending issues: ' + str(len(result.get('pendingIssueIds', []))) + '.',
             *['- ' + identity for identity in result.get('pendingIssueIds', [])[:10]],
             'Full issue identities are retained in progress.json; inspect individual records instead of loading the ledger wholesale.']
    if result.get('error'):
        lines += ['', 'Controller error: ' + result['error']]
    (root / 'report.md').write_text('\n'.join(lines) + '\n')
    return result


def prepare_batch(root, config, batch):
    path, snapshot, bundle = (Path(batch[k]) for k in ('path', 'snapshot', 'bundle'))
    if (path / 'preparation.json').exists():
        return
    if path.exists():
        raise ValueError('Incomplete batch preparation needs controller inspection: ' + str(path))
    if not snapshot.exists():
        subprocess.run([config['python'], str(REPO / 'annotation/pipeline/annotation-priorities.py'),
                        '--campaign', config['campaign'], '--out', str(snapshot), '--batch-size', str(batch.get('sectionLimit', config['batchSize'])),
                        '--seed', str(config['seed'] + len(config['batches'])),
                        '--exclude-sections', str(root / 'ledger.json')], check=True)
    queue = snapshot / 'queue.json'
    if not read(queue)['sections']:
        raise ValueError('No unattempted eligible sections remain; inspect the pending ledger.')
    if not bundle.exists():
        subprocess.run([config['python'], str(REPO / 'harness/prepare-annotation-harness.py'),
                        '--campaign', config['campaign'], '--sections', str(queue),
                        '--feedback-dir', str(snapshot / 'feedback'), '--out', str(bundle), '--mode', 'annotation'], check=True)
    fine.prepare(path, queue, bundle, config['campaign'], config['python'],
                 config['maxSections'], config['maxBriefCharacters'])


def advance(root, config):
    progress = status(root, config)
    if progress['targetReached'] or progress['controllerStatus'] == 'needs-controller':
        return progress
    unfinished = [b for b, state in zip(config['batches'], progress['batches']) if state['status'] != 'complete']
    if unfinished:
        batch = unfinished[0]
    else:
        identity = f"batch-{len(config['batches']) + 1:04d}"
        batch = {'id': identity, 'path': str(root / 'batches' / identity),
                 'snapshot': str(root / 'snapshots' / identity), 'bundle': str(root / 'harnesses' / identity),
                 'createdAt': now(), 'sectionLimit': min(config['batchSize'], config['target'] - progress['completeCount'])}
        config['batches'].append(batch)
        save(root / 'config.json', config)
    prepare_batch(root, config, batch)
    # Persist exclusions before launching workers, including partial or subsequently failed targets.
    status(root, config)
    try:
        fine.run(Path(batch['path']), config['concurrency'])
    except BlockingIOError:
        return report(root, config, {**status(root, config), 'controllerStatus': 'busy'})
    return status(root, config)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('status', 'advance'))
    parser.add_argument('--root', type=Path, default=REPO / '.local/fine-annotation-4000')
    parser.add_argument('--campaign', type=Path, default=REPO / '.local/corpus-500-v2')
    parser.add_argument('--target', type=int, help='Initial target; an existing campaign retains its target.')
    parser.add_argument('--adopt-batch', type=Path)
    parser.add_argument('--python', help='Python runtime for new harness preparation.')
    args = parser.parse_args()
    if args.target is not None and args.target <= 0:
        parser.error('--target must be positive')
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    with (root / 'dispatcher.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'controllerStatus': 'busy', 'root': str(root)}))
            return
        config = initialize(root, args.campaign.resolve(), args.target, args.python)
        try:
            if args.adopt_batch:
                adopt(root, config, args.adopt_batch)
            result = advance(root, config) if args.command == 'advance' else status(root, config)
        except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
            previous = read(root / 'progress.json') if (root / 'progress.json').exists() else {}
            result = report(root, config, {**previous, 'updatedAt': now(), 'canonicalFresh': False,
                                          'targetReached': False, 'controllerStatus': 'needs-controller', 'error': str(error)})
        print(json.dumps({k: v for k, v in result.items() if k not in ('batches', 'pendingIssueIds')}, ensure_ascii=False))
        if result['controllerStatus'] == 'needs-controller':
            sys.exit(1)


if __name__ == '__main__':
    main()
