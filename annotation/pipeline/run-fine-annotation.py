"""Prepare and dispatch bounded harness annotation jobs with independent canonical audit."""
import argparse
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
import time
from pathlib import Path
import shutil
import subprocess
import uuid

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import annotation_runtime as base
import section_evidence as preparer
from playback_rate import same_playback_rate

public_example = base.load_module(base.REPO / 'harness/harness_examples.py').public_example

REPO = Path(__file__).resolve().parents[2]


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


read, sha = base.read, base.sha


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.writing')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def overlap(first, second):
    return max(first['startMs'], second['startMs']) < min(first['endMs'], second['endMs'])


def freeze_skill(root):
    source = REPO / '.agents/skills/mania-pattern-judgment'
    target = root / 'common/skill'
    for path in sorted(source.rglob('*')):
        if path.is_file() and path.suffix in ('.md', '.yaml', '.yml'):
            dest = target / path.relative_to(source)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(path.read_bytes())
    save(target / 'manifest.json', {'files': [{'path': str(p.relative_to(target)), 'sha256': sha(p)}
                                           for p in sorted(target.rglob('*')) if p.is_file()]})
    descriptor = {'name': 'mania-pattern-judgment',
                  'version': 'fine-harness:' + subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip(),
                  'sha256': sha(target / 'manifest.json')}
    save(root / 'common/skill-provenance.json', descriptor)
    return descriptor


def audit_schema():
    def obj(properties):
        return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}
    strings = {'type': 'array', 'items': {'type': 'string'}}
    return obj({'cases': {'type': 'array', 'items': obj({'caseId': {'type': 'string'},
        'results': {'type': 'array', 'items': obj({'claimId': {'type': 'string'},
            'status': {'type': 'string', 'enum': ['supported', 'needs-revision', 'needs-expert']},
            'rationale': strings, 'question': {'type': ['string', 'null']}})},
        'coverageRationale': strings})}})


def common_prompt(root, role):
    common = root / 'common'
    workflow = '''This is a production selected-section annotation job. Use only the supplied frozen job files and lens MCP tools. Do not inspect other jobs, parent repositories, global skills, raw harness bundles, trace logs, full feedback ledgers or network sources. Do not spawn agents, submit canonical changes, or edit inputs. The controller handles task sealing and submission. Missing calibration JSON files are intentionally replaced by progressive human-example retrieval through lens; do not recover them elsewhere.
Start by reading brief.md once. It supplies complete review-context attack rows, entering holds, timing, exact human judgments overlapping the target, and concrete prior repair questions. Metadata and prior machine questions are context, not style labels. cases.json contains the same notes in verbose form for the controller; do not load that duplicate file wholesale. Apply every active Foundation dimension independently. Distinguish successive organizations from simultaneous co-occurrence, and do not let a positive somewhere label intervening negatives. The selected scopes in this batch are the requested judgment units; if their boundaries prevent a sound assessment, record the specific scope issue for revision rather than silently widening a claim. Whole-chart coverage is not claimed.
The lens tools expose facts, never verdicts. Use caseId as section_id. Tools are optional: call one only if missing evidence, another perspective, or a useful human comparison can change the result. Reuse supplied evidence. Search defaults are small; open useful examples individually, not a ledger. Native image views are optional. Wider source context may inform a judgment; final noteLines must overlap scope and contextLines must overlap reviewContext. Endpoint-only releases exactly at the left boundary are facts, not citable overlapping references. Keep short LNs and full entering holds intact. Existing human decisions are authoritative at their exact scopes; do not broaden their labels or replace their rationales with machine prose.
Work directly from the source relationships. Keep internal investigation bounded and stop when the section and remaining distinction are supported. Never use token economy to omit source inspection or unresolved issues. Write only a final JSON answer matching response-schema.json; no code fence, extra files, or canonical writes.
'''
    if read(root / 'preparation.json').get('annotationFocus') == 'tech':
        workflow += '''This batch focuses on expanding well-supported Tech judgments. Give particular attention to ordered rhythm, articulation inside repeated cells, and supporting/prominent comparisons. Use a relevant curated contrast when it resolves a boundary. Candidate selection is not a predicted label: absent and unresolved remain valid, with no positive quota. Still judge the other four dimensions independently.\n'''
    if role == 'labeler':
        workflow += '''Return one case per brief caseId and exactly five judgments, one per active tag. Use presence present/absent/unresolved; salience supporting/prominent only for present, null otherwise. Each rationale is 2–4 brief bullet strings without prefixes, at most 80 words total. Supply focused exact witness noteLines and relevant contextLines; do not copy all source rows into every dimension. The controller preserves the complete supplied context for audit. All five dimensions are considered even when the controller later reuses an existing settled cell. An unresolved judgment must state the concrete remaining semantic or scope choice.\n'''
    else:
        workflow += '''Read handoffs.json, a faithful compact view of the sealed proposals and binding identities being audited. Its noteLines/contextLines reference exact source rows in the complete brief; full note objects are not repeated for each dimension. Original exact task.json and handoff.json files remain under sealed/<caseId>/ with frozen hashes. Read an individual original claim only if needed; do not dump those full files or their sourceBytes. Audit the original sealed version, not a rewritten claim. Independently review every original claim once, preserving claimId and caseId. Return supported, needs-revision, or needs-expert per claim; unresolved proposals cannot be supported. Investigate a concrete missing fact through the harness before returning needs-revision. A needs-expert result requires a precise remaining question; question is null for other outcomes. Rationale arrays have 2–4 brief strings, at most 80 words. coverageRationale describes the selected-section review only, not whole-chart discovery. Never silently rewrite a labeler's claim or treat agreement as human confirmation.\n'''
    return workflow + '\n# Frozen role\n' + (common / (role + '.md')).read_text() + \
        '\n# Frozen skill\n' + (common / 'skill/SKILL.md').read_text() + \
        '\n# Frozen judgment guide\n' + (common / 'skill/references/judgment-guide.md').read_text() + \
        '\n# Frozen Foundation definitions\n' + json.dumps(read(common / 'foundation.json'), ensure_ascii=False, separators=(',', ':')) + '\n'


def section_brief(cases):
    result = preparer.brief(cases)
    for case in cases:
        result += '\n## Scoped review records: ' + case['caseId'] + '\n'
        result += json.dumps({'humanJudgments': [public_example(e) for e in case.get('existingHumanJudgments', [])],
                              'priorRepairQuestions': case.get('originalReferences', [])},
                             ensure_ascii=False, separators=(',', ':')) + '\n'
    return result


def pack_cases(cases, max_sections, max_brief_chars):
    """Balance source evidence so dense cases do not leave an avoidable one-case job."""
    groups = [[] for _ in range((len(cases) + max_sections - 1) // max_sections)]
    order = {case['caseId']: i for i, case in enumerate(cases)}
    for case in sorted(cases, key=lambda c: len(section_brief([c])), reverse=True):
        available = [group for group in groups if len(group) < max_sections
                     and (not group or len(section_brief(group + [case])) <= max_brief_chars)]
        if not available:
            groups.append([case])
        else:
            min(available, key=lambda group: len(section_brief(group))).append(case)
    return [sorted(group, key=lambda c: order[c['caseId']]) for group in groups if group]


def compact_handoff(handoff):
    # The complete source brief already defines each exact source-line reference.
    # Preserve sealed files separately; do not repeat full note objects per dimension.
    claims = []
    for claim in handoff['proposals']:
        evidence = claim['evidence']
        claims.append({**claim, 'evidence': {
            **{key: value for key, value in evidence.items() if key not in ('noteRefs', 'contextNoteRefs')},
            'noteLines': [ref['sourceLine'] for ref in evidence['noteRefs']],
            'contextLines': [ref['sourceLine'] for ref in evidence['contextNoteRefs']]}})
    return {**handoff, 'proposals': claims}


def prepare_job(root, cases, role, config, number, handoffs=None):
    job = root / 'runs' / f'{role}-{number:03d}'
    if (job / 'run.json').exists():
        return job
    job.mkdir(parents=True, exist_ok=True)
    shutil.copytree(root / 'common/skill', job / 'skill', dirs_exist_ok=True)
    for name in ('foundation.json', 'skill-provenance.json'):
        shutil.copyfile(root / 'common' / name, job / name)
    shutil.copyfile(root / 'common' / (role + '.md'), job / 'ROLE.md')
    save(job / 'cases.json', {'cases': cases})
    save(job / 'response-schema.json', base.response_schema() if role == 'labeler' else audit_schema())
    brief = section_brief(cases)
    (job / 'brief.md').write_text(brief)
    if handoffs is not None:
        for entry in handoffs:
            folder = job / 'sealed' / entry['caseId']
            folder.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(entry['taskPath'], folder / 'task.json')
            shutil.copyfile(entry['handoffPath'], folder / 'handoff.json')
        save(job / 'handoffs.json', {'entries': [
            {'caseId': e['caseId'], 'handoffSha256': e['handoffSha256'],
             'handoff': compact_handoff(e['handoff'])} for e in handoffs]})
    (job / 'AGENTS.md').write_text('Use only this frozen job and the supplied lens MCP tools. Do not spawn agents. Write only the final schema-shaped output. The controller handles canonical delivery.\n')
    (job / 'prompt.txt').write_text(common_prompt(root, role))
    settings = read(root / 'preparation.json')
    run = {'producerId': 'fine-annotation-' + role + '-' + str(uuid.uuid4()), 'role': role,
           'status': 'prepared', 'caseCount': len(cases), 'judgmentCount': len(cases) * len(base.TAGS),
           'requestedModel': config['models'][role], 'requestedReasoningEffort': config['reasoningEfforts'][role],
           'skill': read(job / 'skill-provenance.json'),
           'harness': settings['harness'],
           'inputHashes': {str(p.relative_to(job)): sha(p) for p in sorted(job.rglob('*')) if p.is_file()}}
    save(job / 'run.json', run)
    return job


def prepare(root, queue_path, bundle, campaign, python, max_sections=5, max_brief_chars=28000):
    root, queue_path, bundle, campaign = (Path(p).resolve() for p in (root, queue_path, bundle, campaign))
    config = read(campaign / 'controller/config.json')
    queue, manifest = read(queue_path), read(bundle / 'manifest.json')
    if manifest['mode'] != 'annotation' or manifest['foundationSha256'] != config['foundationSha256']:
        raise ValueError('Harness mode or Foundation differs from the campaign.')
    for name, digest in manifest['files'].items():
        if sha(bundle / name) != digest:
            raise ValueError('Frozen harness file changed: ' + name)
    if len(queue['sections']) != len(manifest['sections']):
        raise ValueError('Queue and harness section counts differ.')
    sections = []
    for queued, section in zip(queue['sections'], manifest['sections']):
        if (any(queued[k] != section[k] for k in ('sourceSha256', 'scope', 'reviewContext'))
                or not same_playback_rate(queued, section)):
            raise ValueError('Queue and frozen harness target differ.')
        sections.append({**section, 'benchmarkCaseId': section['sectionId']})
    root.mkdir(parents=True, exist_ok=False)
    (root / 'common').mkdir()
    save(root / 'queue.json', queue)
    save(root / 'sections.json', {'sections': sections})
    quality = read(queue_path.parent / 'quality.json')
    issues = {i['issueId']: i for i in quality['openIssues']}
    sources = {c['source']['sha256']: c for c in read(campaign / 'admin/source-map.json')}
    cases = preparer.source_cases({'cases': sections}, campaign, sources)
    examples = read(bundle / 'examples.json')
    for case, queued in zip(cases, queue['sections']):
        case['originalReferences'] = [{k: v for k, v in issues[key].items() if k != 'audits'} for key in queued.get('issueIds', [])]
        case['existingHumanJudgments'] = [public_example(e) for e in examples
                                          if e['sourceSha256'] == case['sourceSha256']
                                          and same_playback_rate(e, case) and overlap(e['scope'], case['scope'])]
    skill = freeze_skill(root)
    original = read(campaign / config['workerCommonPath'] / 'foundation.json')
    save(root / 'common/foundation.json', {k: v for k, v in original.items() if k != 'calibrationExamples'})
    for role in ('labeler', 'auditor'):
        shutil.copyfile(REPO / 'annotation/roles' / ('harness-' + role + '.md'), root / 'common' / (role + '.md'))
    save(root / 'preparation.json', {'kind': 'fine-annotation-harness-v1', 'createdAt': datetime.now(timezone.utc).isoformat(),
        'campaign': str(campaign), 'campaignConfigSha256': sha(campaign / 'controller/config.json'),
        'queuePath': str(queue_path), 'queueSha256': sha(queue_path), 'sectionCount': len(cases),
        'coverageMode': 'selected-sections', 'skill': skill,
        'annotationFocus': quality.get('selectionFocus', {}).get('tag'),
        'harness': {'bundle': str(bundle), 'manifestSha256': sha(bundle / 'manifest.json'), 'python': str(Path(python).absolute())},
        'rotation': {'maxSections': max_sections, 'maxBriefCharacters': max_brief_chars,
                     'policy': 'Fresh worker per bounded batch and a separate fresh independent audit; no session resume or history accumulation.'}})
    groups = pack_cases(cases, max_sections, max_brief_chars)
    for number, group in enumerate(groups, 1):
        prepare_job(root, group, 'labeler', config, number)
    save(root / 'preparation-complete.json', {'caseIds': [c['caseId'] for c in cases],
        'jobs': [str(p.parent.relative_to(root)) for p in sorted((root / 'runs').glob('labeler-*/run.json'))]})
    return {'root': str(root), 'sections': len(cases), 'labelerJobs': len(groups), 'batchSizes': [len(g) for g in groups], 'skill': skill}


def status(root):
    runs = [{ 'job': p.parent.name, **read(p)} for p in sorted((root / 'runs').glob('*/run.json'))]
    totals = {}
    for run in runs:
        for key, value in run.get('usage', {}).items():
            totals[key] = totals.get(key, 0) + value
    result = {'updatedAt': datetime.now(timezone.utc).isoformat(),
              'runs': [{k: r[k] for k in ('job', 'producerId', 'role', 'status', 'caseCount', 'elapsedSeconds', 'usage', 'threadIds') if k in r} for r in runs],
              'usage': totals, 'cachedInputFraction': totals.get('cached_input_tokens', 0) / totals['input_tokens'] if totals.get('input_tokens') else None,
              'deliveries': [read(p) for p in sorted((root / 'delivery').glob('*/delivery-result.json'))],
              'controllerErrors': [read(p) for p in sorted((root / 'controller-errors').glob('*.json'))]}
    save(root / 'progress.json', result)
    return result


def run_worker(job, config):
    run = read(job / 'run.json')
    if run['status'] != 'running':
        return base.run_job(job, config)
    if not run.get('pid'):
        run.update(status='interrupted', interruptionReason='Controller stopped during launch before recording the worker PID; inspect the retained job before relaunch.')
        save(job / 'run.json', run)
        return run
    # Adopt the actual existing process after an interrupted controller. Never relabel
    # its response or resume its model context under a new producer identity.
    while True:
        process = subprocess.run(['ps', '-p', str(run['pid']), '-o', 'command='], capture_output=True, text=True)
        if process.returncode or str(job) not in process.stdout:
            break
        time.sleep(5)
    events = [json.loads(line) for line in (job / 'events.jsonl').read_text().splitlines() if line]
    completed = [event for event in events if event.get('type') == 'turn.completed']
    usage = {}
    for event in completed:
        for key, value in event.get('usage', {}).items():
            usage[key] = usage.get(key, 0) + value
    finished = datetime.now(timezone.utc)
    intact = all(sha(job / name) == digest for name, digest in run['inputHashes'].items())
    success = bool(completed) and (job / 'response.json').exists() and intact
    run.update(status='completed' if success else 'interrupted', recoveredByController=True,
               finishedAt=finished.isoformat(), usage=usage, inputsUnchanged=intact,
               threadIds=[e['thread_id'] for e in events if e.get('type') == 'thread.started'],
               elapsedSeconds=(finished - datetime.fromisoformat(run['startedAt'])).total_seconds(),
               elapsedIncludesControllerDowntime=True)
    if (job / 'response.json').exists():
        run['responseSha256'] = sha(job / 'response.json')
    save(job / 'run.json', run)
    return run


def usage_limit_error(job):
    events = job / 'events.jsonl'
    if not events.exists():
        return None
    with events.open() as stream:
        for line in stream:
            if not line.strip():
                continue
            event = json.loads(line)
            if event.get('type') == 'error':
                message = event.get('message', '')
            elif event.get('type') == 'turn.failed':
                message = event.get('error', {}).get('message', '')
            else:
                continue
            if message.startswith("You've hit your usage limit."):
                return message
    return None


def run(root, concurrency, labels_only=False):
    root = Path(root).resolve()
    preparation = read(root / 'preparation.json')
    campaign = Path(preparation['campaign'])
    config = read(campaign / 'controller/config.json')
    if not 1 <= concurrency <= 5:
        raise ValueError('Use one to five concurrent workers.')
    lock = (root / 'dispatcher.lock').open('a+')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    lock.seek(0)
    lock.truncate()
    lock.write(str(os.getpid()))
    lock.flush()
    delivery = None if labels_only else module('section_annotation_delivery')
    queue = sorted((root / 'runs').glob('labeler-*'))
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        pending = {}
        dispatch_stopped = False
        while (queue and not dispatch_stopped) or pending:
            while queue and not dispatch_stopped and len(pending) < concurrency:
                job = queue.pop(0)
                # Retained failures remain inspectable on resume, but only an
                # attempted or adopted worker can stop this invocation.
                attempted = read(job / 'run.json')['status'] in ('prepared', 'running')
                pending[pool.submit(run_worker, job, config)] = (job, attempted)
            done, _ = wait(pending, timeout=10, return_when=FIRST_COMPLETED)
            for future in done:
                job, attempted = pending.pop(future)
                try:
                    result = future.result()
                    if attempted and result['status'] in ('failed', 'interrupted'):
                        limit = usage_limit_error(job)
                        if limit:
                            dispatch_stopped = True
                            raise ValueError('Worker stopped at provider usage limit: ' + limit)
                    if result['status'] != 'completed' or not result['inputsUnchanged']:
                        raise ValueError('Worker needs controller inspection: ' + result['status'])
                    if labels_only:
                        continue
                    number = int(job.name.rsplit('-', 1)[1])
                    group_root = root / 'delivery' / f'labeler-{number:03d}'
                    group_root.mkdir(parents=True, exist_ok=True)
                    if result['role'] == 'labeler':
                        manifest = delivery.prepare_handoffs(group_root, job, campaign)
                        entries = manifest['entries']
                        if not entries:
                            save(group_root / 'delivery-result.json', {
                                'status': 'needs-controller' if any(c.get('conflict') for c in manifest['skippedCells']) else 'reused-existing',
                                'entries': [], 'skippedCells': manifest['skippedCells']})
                            error_path = root / 'controller-errors' / (job.name + '.json')
                            if error_path.exists():
                                error_path.unlink()
                            continue
                        ids = {e['caseId'] for e in entries}
                        cases = [c for c in read(job / 'cases.json')['cases'] if c['caseId'] in ids]
                        handoffs = [{**e, 'handoff': read(e['handoffPath'])} for e in entries]
                        audit = prepare_job(root, cases, 'auditor', config, number, handoffs)
                        audit_run = read(audit / 'run.json')
                        if audit_run['status'] == 'prepared':
                            shutil.copyfile(group_root / 'packets/manifest.json', audit / 'delivery-manifest.json')
                            audit_run['inputHashes']['delivery-manifest.json'] = sha(audit / 'delivery-manifest.json')
                            save(audit / 'run.json', audit_run)
                        queue.insert(0, audit)
                    else:
                        delivered = delivery.deliver_audits(group_root, job, campaign)
                        save(group_root / 'delivery-result.json', delivered)
                        print(json.dumps({'event': 'delivered', 'job': job.name, 'status': delivered['status']}, ensure_ascii=False), flush=True)
                    error_path = root / 'controller-errors' / (job.name + '.json')
                    if error_path.exists():
                        error_path.unlink()
                except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
                    save(root / 'controller-errors' / (job.name + '.json'), {
                        'job': job.name, 'error': str(error), 'at': datetime.now(timezone.utc).isoformat()})
                    print(json.dumps({'event': 'needs-controller', 'job': job.name, 'error': str(error)}), flush=True)
            status(root)
    lock.close()
    return status(root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'run', 'status'))
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--campaign', type=Path, default=REPO / '.local/corpus-500-v2')
    parser.add_argument('--queue', type=Path)
    parser.add_argument('--bundle', type=Path)
    parser.add_argument('--python', default=os.environ.get('ANNOTATION_PYTHON', sys.executable))
    parser.add_argument('--concurrency', type=int, default=5)
    parser.add_argument('--max-sections', type=int, default=5)
    parser.add_argument('--max-brief-chars', type=int, default=28000)
    parser.add_argument('--labels-only', action='store_true')
    args = parser.parse_args()
    if args.command == 'prepare':
        if args.queue is None or args.bundle is None:
            parser.error('prepare needs --queue and --bundle')
        result = prepare(args.root, args.queue, args.bundle, args.campaign, args.python, args.max_sections, args.max_brief_chars)
    elif args.command == 'run':
        result = run(args.root, args.concurrency, args.labels_only)
    else:
        result = status(args.root)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
