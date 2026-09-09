"""Controller-only sealing and delivery of independently audited section judgments.

Each labeler uses its own batch_root. Workers only write unsealed responses; this
module uses the public exchange and never writes human or canonical documents.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request


REPO = Path(__file__).resolve().parents[2]
TAGS = ('jack-organization', 'stream-organization', 'trill-organization', 'tech', 'ln-coordination')
HUMAN = ('accepted', 'modified', 'rejected', 'deferred')
REVISABLE = ('needs-revision', 'needs-expert')


def read(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.writing')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def now():
    return datetime.now(timezone.utc).isoformat()


def config_for(campaign):
    return campaign if isinstance(campaign, dict) else read(Path(campaign) / 'controller/config.json')


def cli(*arguments):
    result = subprocess.run(['node', str(REPO / 'apps/inspector/server/annotation-workflow.mjs'),
                             *map(str, arguments)], cwd=REPO, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())


def feedback(server, source_sha):
    with urllib.request.urlopen(server.rstrip('/') + '/api/review/feedback/' + source_sha) as response:
        return json.load(response)


def completed_job(job, role):
    job = Path(job).resolve()
    run = read(job / 'run.json')
    require(run['status'] == 'completed' and run['inputsUnchanged'], 'Worker must complete with unchanged inputs.')
    require(run['role'] == role, f'Expected actual {role} worker provenance.')
    require(run['responseSha256'] == sha(job / 'response.json'), 'Worker response changed.')
    hashes = run['inputHashes']
    required = {'cases.json', 'foundation.json', 'skill-provenance.json', 'skill/manifest.json'}
    require(required <= hashes.keys(), 'Worker inputs must pin cases, Foundation, and skill provenance.')
    for name, digest in hashes.items():
        require(sha(job / name) == digest, f'Frozen worker input changed: {name}')
    skill = read(job / 'skill-provenance.json')
    require(skill['sha256'] == sha(job / 'skill/manifest.json'), 'Frozen skill descriptor differs.')
    if 'skill' in run:
        require(run['skill'] == skill, 'Run and frozen skill provenance differ.')
    for item in read(job / 'skill/manifest.json')['files']:
        require(sha(job / 'skill' / item['path']) == item['sha256'], 'Frozen skill content changed.')
    agent = {'producerId': run['producerId'], 'role': role, 'model': run['requestedModel'],
             'toolVersion': run['toolVersion'], 'skill': skill}
    return run, agent


def human_evidence(job, run):
    """Return only human observations actually exposed by a tracked harness.

    Dependencies are shared across the labeler job: the worker can use any
    returned example for any case. Legacy/missing provenance stays unknown;
    it must not become an explicit claim that no human examples were used.
    """
    harness = run.get('harness')
    if not harness:
        return None, None
    bundle = Path(harness['bundle'])
    manifest_path = bundle / 'manifest.json'
    require(sha(manifest_path) == harness['manifestSha256'], 'Frozen worker harness changed.')
    manifest = read(manifest_path)
    if manifest.get('humanEvidenceTracking') != 'returned-examples-v1':
        return None, None
    trace_path = Path(job) / 'harness-trace.jsonl'
    if not trace_path.exists():
        return None, None
    refs_path = bundle / 'example-refs.json'
    require(sha(refs_path) == manifest['files']['example-refs.json'], 'Frozen human evidence references changed.')
    available = [ref for ref in read(refs_path).values() if ref is not None]
    references, complete = {}, True
    for line in trace_path.read_text().splitlines():
        event = json.loads(line)
        if not event.get('humanEvidenceTrackingComplete', False):
            complete = False
        for ref in event.get('humanEvidenceRefs', []):
            require(ref in available, 'Harness trace references an observation outside the frozen examples.')
            references[(ref['sourceSha256'], ref['observationId'], ref['observationSha256'])] = ref
    return ([references[key] for key in sorted(references)] if complete else None), sha(trace_path)


def keyed(items, key, expected=None):
    result = {item[key]: item for item in items}
    require(len(result) == len(items), f'Duplicate {key}.')
    if expected is not None:
        require(result.keys() == set(expected), f'Incomplete or unexpected {key} coverage.')
    return result


def rationale(lines, bounded=True):
    require(isinstance(lines, list) and lines and all(isinstance(line, str) and line.strip() for line in lines),
            'Rationale must contain nonempty strings.')
    if bounded:
        require(2 <= len(lines) <= 4, 'Rationale must have 2–4 bullets.')
    return '\n'.join('- ' + line for line in lines)


def intersects(note, interval):
    return (note['startMs'] < interval['endMs'] and note['endMs'] > interval['startMs']
            if note['kind'] == 'long' else interval['startMs'] <= note['startMs'] < interval['endMs'])


def overlap(left, right):
    return max(left['startMs'], right['startMs']) < min(left['endMs'], right['endMs'])


def note_ref(note):
    return {'sourceLine': note['source_line'], 'column': note['column'], 'kind': note['kind'],
            'startMs': note['start_ms'], 'endMs': note['end_ms']}


def assessment(judgment):
    result = {'presence': judgment['presence']}
    if judgment['presence'] == 'present':
        result['salience'] = judgment['salience']
    return result


def validate_judgments(case, judgments):
    keyed(judgments, 'tagId', TAGS)
    notes = keyed([note_ref(note) for note in case['notes']], 'sourceLine')
    scope, context = case['scope'], case['reviewContext']
    require(context['startMs'] <= scope['startMs'] < scope['endMs'] <= context['endMs'],
            'Review context must contain the complete scope.')
    for judgment in judgments:
        presence, salience = judgment['presence'], judgment['salience']
        require(presence in ('present', 'absent', 'unresolved'), 'Unsupported assessment.')
        require(salience in ('supporting', 'prominent') if presence == 'present' else salience is None,
                'Salience must match presence.')
        rationale(judgment['rationale'])
        for field, interval in (('noteLines', scope), ('contextLines', context)):
            lines = judgment[field]
            require(len(set(lines)) == len(lines), 'Duplicate witness/context reference.')
            require(all(line in notes and intersects(notes[line], interval) for line in lines),
                    f'{case["caseId"]}: unknown or out-of-scope {field}.')
        require(presence != 'present' or judgment['noteLines'], 'Positive assessment needs witnesses.')


def bind_source(case, task, foundation, config):
    source_sha = case['sourceSha256']
    require(task['source']['sha256'] == source_sha
            and hashlib.sha256(bytes(task['sourceBytes'])).hexdigest() == source_sha,
            'Fresh task source bytes differ from the worker source.')
    require(task['foundationSha256'] == config['foundationSha256'] == foundation['foundationSha256'],
            'Fresh task Foundation pin differs.')
    require(all(task['foundation'][key] == foundation[key]
                for key in ('foundationId', 'revision', 'approval', 'policies', 'tags')),
            'Worker Foundation content differs from the fresh task.')
    require(case.get('sectionId', case['caseId']) == case['caseId'], 'Section identity differs from caseId.')
    expected = {note['sourceLine']: note for note in task['structure']['notes']
                if intersects(note, case['reviewContext'])}
    supplied = {note['source_line']: note_ref(note) for note in case['notes']}
    require(supplied == expected, 'Worker notes differ from the complete source-bound review context.')
    byline = {note['sourceLine']: note for note in task['structure']['notes']}
    for note in case.get('boundaryReleases', []):
        require(byline.get(note['source_line']) == note_ref(note), 'Boundary release source binding differs.')
    return byline


def check_feedback(current, source_sha, foundation_sha):
    require(current['sourceSha256'] == source_sha, 'Feedback source differs.')
    require(current['taskBinding']['foundationSha256'] == foundation_sha, 'Current Foundation differs.')


def machine_binding_current(row):
    trust = row.get('trust')
    if trust:
        return trust['source'] == 'current' and trust['foundation'] == 'current'
    return row['baseStatus'] == 'current'


def terminal_lineage(case, current, foundation_sha, include_exact_stale=False):
    """Follow an explicit current repair target through its immutable stale tail.

    A stale successor already owns the original's only revision edge. A fresh
    revision must target that tail; auditing it then propagates through the chain.
    Unrelated stale claims and changed crops remain controller conflicts.
    """
    rows = {(row['handoffId'], row['claimId']): row for row in current['agentReviews']}
    handoffs = {item['handoffId']: item for item in current['handoffs']}
    successors = {(link['handoffId'], link['claimId']): (item['handoffId'], link['replacementClaimId'])
                  for item in current['handoffs'] for link in item.get('supersedes', [])}
    references, ignored, stale_targets, lineages = [], set(), [], []
    for ref in case.get('originalReferences', []):
        identity = (ref['handoffId'], ref['claimId'])
        anchor = rows.get(identity)
        chain = [identity]
        if anchor and anchor['baseStatus'] == 'current' and anchor['status'] in REVISABLE:
            while chain[-1] in successors:
                chain.append(successors[chain[-1]])
        eligible = len(chain) > 1 and rows[chain[-1]]['status'] == 'stale'
        eligible = eligible and all(
            not rows[key].get('decision') and rows[key]['summary']['scope'] == case['scope']
            and rows[key]['summary']['tagId'] == ref.get('tagId', anchor['summary']['tagId'])
            and handoffs[key[0]]['foundationSha256'] == foundation_sha for key in chain)
        if not eligible:
            references.append(ref)
            continue
        records = [{**{key: rows[identity][key] for key in ('handoffId', 'claimId', 'status', 'baseStatus')},
                    'handoffSha256': handoffs[identity[0]]['handoffSha256'],
                    'tagId': rows[identity]['summary']['tagId'], 'scope': rows[identity]['summary']['scope']}
                   for identity in chain]
        # The anchor's frozen identity must still agree, including a hash when supplied.
        require(ref.get('handoffSha256', records[0]['handoffSha256']) == records[0]['handoffSha256']
                and ref.get('sourceSha256', case['sourceSha256']) == case['sourceSha256']
                and ref.get('scope', case['scope']) == case['scope'], 'Lineage anchor binding changed.')
        for left, right in zip(records, records[1:]):
            edge = next(link for link in handoffs[right['handoffId']]['supersedes']
                        if (link['handoffId'], link['claimId']) == (left['handoffId'], left['claimId']))
            require(edge['handoffSha256'] == left['handoffSha256'], 'Immutable lineage handoff hash differs.')
        references.append({**records[-1], 'sourceSha256': case['sourceSha256']})
        ignored.update(chain[:-1])
        stale_targets.append(chain[-1])
        lineages.append({'originalReference': ref, 'chain': records})
    if include_exact_stale:
        repaired_tags = {item['chain'][-1]['tagId'] for item in lineages}
        for identity, row in rows.items():
            if (identity in stale_targets or identity in successors or row.get('decision')
                    or row['status'] != 'stale' or row['baseStatus'] != 'stale'
                    or row['summary']['tagId'] not in repaired_tags or row['summary']['scope'] != case['scope']
                    or handoffs[identity[0]]['foundationSha256'] != foundation_sha):
                continue
            record = {**{key: row[key] for key in ('handoffId', 'claimId', 'status', 'baseStatus')},
                      'handoffSha256': handoffs[identity[0]]['handoffSha256'],
                      'tagId': row['summary']['tagId'], 'scope': row['summary']['scope']}
            ref = {**record, 'sourceSha256': case['sourceSha256']}
            references.append(ref)
            stale_targets.append(identity)
            lineages.append({'originalReference': ref, 'chain': [record], 'reason': 'exact-stale-duplicate'})
    return ({**case, 'originalReferences': references, 'staleLineageTargets': stale_targets},
            {**current, 'agentReviews': [row for key, row in rows.items() if key not in ignored]}, lineages)


def select_cells(case, judgments, current, foundation_sha):
    """Return eligible judgments, explicit replacement links, and preserved cells."""
    rows = current['agentReviews']
    bykey = {(row['handoffId'], row['claimId']): row for row in rows}
    handoffs = {handoff['handoffId']: handoff for handoff in current['handoffs']}
    references = {(ref['handoffId'], ref['claimId']): ref for ref in case.get('originalReferences', [])}
    if 'effectiveHumanObservations' in current:
        humans = [item.get('claim', item.get('summary')) for item in current['effectiveHumanObservations']]
        humans += [row['summary'] for row in rows if row['status'] in ('rejected', 'deferred')]
    else:
        humans = [claim for row in rows if row.get('decision') or row['status'] in HUMAN
                  for claim in [row['summary'], *([row['modifiedClaim']] if 'modifiedClaim' in row else [])]]
        humans += [item['summary'] for item in current.get('directObservations', [])]
    selected, links, skipped = [], [], []
    for judgment in judgments:
        tag = judgment['tagId']
        cell = {'caseId': case['caseId'], 'sourceSha256': case['sourceSha256'],
                'scope': case['scope'], 'tagId': tag}
        human = [claim for claim in humans if claim['tagId'] == tag and overlap(claim['scope'], case['scope'])]
        if human:
            skipped.append({**cell, 'reason': 'human-exact' if any(c['scope'] == case['scope'] for c in human)
                            else 'human-overlap', 'conflict': False})
            continue
        exact = [row for row in rows if row['summary']['tagId'] == tag
                 and row['summary']['scope'] == case['scope'] and row['status'] != 'superseded'
                 and not row.get('decision')]
        reason, conflict, replacements = None, False, []
        for identity, ref in references.items():
            row = bykey.get(identity)
            if ref.get('tagId', row['summary']['tagId'] if row else None) != tag:
                continue
            if (row not in exact or ref.get('sourceSha256', case['sourceSha256']) != case['sourceSha256']
                    or ref.get('scope', case['scope']) != case['scope']):
                reason, conflict = 'original-reference-changed', True
                break
        for row in exact if reason is None else []:
            identity = (row['handoffId'], row['claimId'])
            original = handoffs[row['handoffId']]
            stale_tail = identity in case.get('staleLineageTargets', [])
            if (not machine_binding_current(row) or row['status'] == 'stale') and not stale_tail:
                reason, conflict = 'stale-machine-cell', True
                break
            if original['foundationSha256'] != foundation_sha:
                reason, conflict = 'machine-foundation-conflict', True
                break
            if row['status'] == 'agent-reviewed':
                compatible = row['summary']['assessment'] == assessment(judgment)
                reason, conflict = ('compatible-machine' if compatible else 'supported-machine-conflict'), not compatible
                if not compatible:
                    break
            elif row['status'] == 'awaiting-audit':
                reason, conflict = 'existing-awaiting-audit', True
                break
            elif row['status'] in REVISABLE or stale_tail:
                ref = references.get(identity)
                if (ref is None or ref.get('tagId', tag) != tag
                        or ref.get('handoffSha256', original['handoffSha256']) != original['handoffSha256']):
                    reason, conflict = 'missing-current-supersedes-reference', True
                    break
                if any(link['handoffId'] == identity[0] and link['claimId'] == identity[1]
                       for handoff in current['handoffs'] for link in handoff.get('supersedes', [])):
                    reason, conflict = 'original-already-has-replacement', True
                    break
                replacements.append({'handoffId': identity[0], 'handoffSha256': original['handoffSha256'],
                                     'claimId': identity[1], 'replacementClaimId': case['caseId'] + '-' + tag})
        if reason:
            skipped.append({**cell, 'reason': reason, 'conflict': conflict})
        else:
            selected.append(judgment)
            links.extend(replacements)
    return selected, links, skipped


def verify_entry(entry):
    require(sha(entry['taskPath']) == entry['taskFileSha256'], 'Sealed task file changed.')
    require(sha(entry['handoffPath']) == entry['handoffSha256'] == entry['handoffFileSha256'],
            'Sealed handoff file changed.')
    task, handoff = read(entry['taskPath']), read(entry['handoffPath'])
    for key in ('taskId', 'taskSha256', 'foundationSha256', 'base'):
        require(task[key] == handoff[key] == entry[key], f'Sealed {key} binding differs.')
    require(handoff['handoffId'] == entry['handoffId'] and handoff['sourceSha256'] == entry['sourceSha256'],
            'Sealed handoff identity differs.')
    require([claim['id'] for claim in handoff['proposals']] == entry['claimIds'], 'Sealed claim identities differ.')
    return task, handoff


def prepare_handoffs(batch_root, label_job, campaign, *, follow_terminal_lineage=False,
                     handoff_suffix='', include_exact_stale=False):
    """Validate all five targets, freeze current tasks, and seal eligible cells only."""
    batch_root, label_job = Path(batch_root).resolve(), Path(label_job).resolve()
    config = config_for(campaign)
    defaults = {'followTerminalLineage': False, 'handoffSuffix': '', 'includeExactStale': False}
    options = {'followTerminalLineage': follow_terminal_lineage, 'handoffSuffix': handoff_suffix,
               'includeExactStale': include_exact_stale}
    require(not follow_terminal_lineage or handoff_suffix, 'Lineage repair needs a distinct new handoff suffix.')
    require(not include_exact_stale or follow_terminal_lineage, 'Exact stale coalescing requires explicit lineage repair.')
    run, agent = completed_job(label_job, 'labeler')
    human_refs, evidence_trace_sha = human_evidence(label_job, run)
    cases = keyed(read(label_job / 'cases.json')['cases'], 'caseId')
    outputs = keyed(read(label_job / 'response.json')['cases'], 'caseId', cases)
    for case_id, case in cases.items():
        validate_judgments(case, outputs[case_id]['judgments'])
    manifest_path = batch_root / 'packets/manifest.json'
    labeler = {'path': str(label_job / 'run.json'), 'sha256': sha(label_job / 'run.json'),
               'producerId': agent['producerId'], 'responseSha256': run['responseSha256'], 'skill': agent['skill']}
    if evidence_trace_sha is not None:
        labeler['humanEvidenceTraceSha256'] = evidence_trace_sha
    if manifest_path.exists():
        manifest = read(manifest_path)
        require(manifest['labelerRun'] == labeler and manifest['server'] == config['server'],
                'Existing preparation belongs to different immutable inputs.')
        require({**defaults, **manifest.get('options', {})} == options,
                'Existing preparation uses different lineage options; use a new batch root.')
        for entry in manifest['entries']:
            verify_entry(entry)
        return manifest
    foundation = read(label_job / 'foundation.json')
    manifest = {'kind': 'section-annotation-handoffs-v1', 'createdAt': now(),
                'status': 'prepared-not-submitted', 'server': config['server'], 'labelerRun': labeler,
                'options': options, 'entries': [], 'skippedCells': []}
    for case_id, case in cases.items():
        folder = batch_root / 'packets' / case_id
        folder.mkdir(parents=True, exist_ok=True)
        task_path, handoff_path = folder / 'task.json', folder / 'handoff.json'
        if not task_path.exists():
            cli('fetch-task', '--server', config['server'], '--source-sha', case['sourceSha256'],
                '--fresh', '--out', task_path)
        task = read(task_path)
        byline = bind_source(case, task, foundation, config)
        current = feedback(config['server'], case['sourceSha256'])
        save(folder / 'feedback-current.json', current)
        check_feedback(current, case['sourceSha256'], task['foundationSha256'])
        target, review, lineages = (terminal_lineage(case, current, task['foundationSha256'], include_exact_stale)
                                    if follow_terminal_lineage else (case, current, []))
        selected, links, skipped = select_cells(target, outputs[case_id]['judgments'], review, task['foundationSha256'])
        manifest['skippedCells'].extend(skipped)
        if not selected:
            continue
        proposals = []
        for judgment in selected:
            witnesses = set(judgment['noteLines'])
            proposals.append({'id': case_id + '-' + judgment['tagId'], 'sectionId': case_id,
                              'tagId': judgment['tagId'], 'scope': case['scope'], 'reviewContext': case['reviewContext'],
                              'assessment': assessment(judgment), 'evidence': {
                                  'noteRefs': [byline[line] for line in judgment['noteLines']],
                                  'contextNoteRefs': [byline[line] for line in sorted(
                                      {note['source_line'] for note in case['notes']} - witnesses)],
                                  'rationale': rationale(judgment['rationale'])}})
        handoff_id = agent['producerId'] + '-' + case_id + ('-' + handoff_suffix if handoff_suffix else '')
        proposal = {'handoffId': handoff_id, 'createdAt': run['finishedAt'],
                    'agent': agent, 'proposals': proposals, 'audit': [], 'questions': [], 'supersedes': links}
        if human_refs is not None:
            proposal['humanEvidenceRefs'] = human_refs
        proposal_path = folder / 'proposal.json'
        if handoff_path.exists():
            require(read(proposal_path) == proposal, 'Existing sealed proposal changed; preserve its packet.')
        else:
            save(proposal_path, proposal)
            cli('handoff', '--task', task_path, '--input', proposal_path, '--out', handoff_path)
        handoff = read(handoff_path)
        require(all(handoff[key] == value for key, value in proposal.items()),
                'Sealed handoff differs from the actual labeler proposal.')
        manifest['entries'].append({'caseId': case_id, 'sourceSha256': case['sourceSha256'],
            'scope': case['scope'], 'reviewContext': case['reviewContext'],
            'taskPath': str(task_path), 'taskFileSha256': sha(task_path), 'taskId': task['taskId'],
            'taskSha256': task['taskSha256'], 'foundationSha256': task['foundationSha256'], 'base': task['base'],
            'handoffPath': str(handoff_path), 'handoffFileSha256': sha(handoff_path),
            'handoffSha256': sha(handoff_path), 'handoffId': handoff['handoffId'],
            'claimIds': [claim['id'] for claim in handoff['proposals']], 'supersedes': links,
            'originalReferences': case.get('originalReferences', []),
            'followTerminalLineage': follow_terminal_lineage, 'includeExactStale': include_exact_stale,
            'lineageRepairs': lineages,
            'skippedCells': skipped, 'feedbackPath': str(folder / 'feedback-current.json')})
    save(manifest_path, manifest)
    return manifest


def audit_proposal(entry, handoff, verdict, run, agent):
    results = keyed(verdict['results'], 'claimId', entry['claimIds'])
    rationale(verdict['coverageRationale'], bounded=False)
    claims = []
    for proposal in handoff['proposals']:
        result = results[proposal['id']]
        outcome = result['status']
        require(outcome in ('supported', *REVISABLE), 'Unknown audit outcome.')
        require(outcome != 'supported' or proposal['assessment']['presence'] in ('present', 'absent'),
                'An unresolved proposal cannot be supported as settled.')
        claim = {'claimId': proposal['id'], 'outcome': outcome, 'rationale': rationale(result['rationale'])}
        if outcome == 'needs-expert':
            require(isinstance(result['question'], str) and result['question'].strip(),
                    'Expert referral needs the actual auditor question.')
            claim.update(expertReason=claim['rationale'], question=result['question'])
        else:
            require(result['question'] is None, 'Supported/revision results cannot retain expert questions.')
        claims.append(claim)
    return {'auditId': agent['producerId'] + '-' + entry['caseId'], 'createdAt': run['finishedAt'],
            'agent': agent, 'claims': claims, 'questions': []}


def human_records(current):
    return {'decisions': [{key: row[key] for key in ('handoffId', 'claimId', 'decision', 'modifiedClaim') if key in row}
                          for row in current['agentReviews'] if row.get('decision')],
            'directObservations': current.get('directObservations', [])}


def check_delivery(current, entry, handoff):
    check_feedback(current, entry['sourceSha256'], entry['foundationSha256'])
    # Ignore this exact handoff on retries; every other current cell still applies.
    other = {**current, 'agentReviews': [row for row in current['agentReviews'] if row['handoffId'] != entry['handoffId']],
             'handoffs': [item for item in current['handoffs'] if item['handoffId'] != entry['handoffId']]}
    case = {**entry, 'originalReferences': entry.get('originalReferences', entry['supersedes'])}
    if entry.get('followTerminalLineage'):
        case, other, lineages = terminal_lineage(case, other, entry['foundationSha256'], entry.get('includeExactStale', False))
        require(lineages == entry['lineageRepairs'], 'Current terminal lineage differs from the sealed repair.')
    judgments = [{'tagId': claim['tagId'], 'presence': claim['assessment']['presence'],
                  'salience': claim['assessment'].get('salience')} for claim in handoff['proposals']]
    selected, links, skipped = select_cells(case, judgments, other, entry['foundationSha256'])
    require(not skipped and len(selected) == len(judgments), f'Current cells changed: {skipped}')
    require(links == entry['supersedes'], 'Current supersession references changed.')
    existing = next((item for item in current['handoffs'] if item['handoffId'] == entry['handoffId']), None)
    require(existing is None or existing['handoffSha256'] == entry['handoffSha256'], 'Stored handoff content differs.')


def verify_applied(current, entry, handoff, audit, audit_sha):
    check_feedback(current, entry['sourceSha256'], entry['foundationSha256'])
    original = next(item for item in current['handoffs'] if item['handoffId'] == entry['handoffId'])
    require(original['handoffSha256'] == entry['handoffSha256'], 'Stored handoff hash differs.')
    stored = next(item for item in current['audits'] if item['auditId'] == audit['auditId'])
    require(stored['auditSha256'] == audit_sha and stored['handoffSha256'] == entry['handoffSha256'],
            'Stored audit hashes differ.')
    rows = {(row['handoffId'], row['claimId']): row for row in current['agentReviews']}
    results = {claim['claimId']: claim for claim in audit['claims']}
    statuses = {}
    for claim in handoff['proposals']:
        row, result = rows[(entry['handoffId'], claim['id'])], results[claim['id']]
        expected = 'agent-reviewed' if result['outcome'] == 'supported' else result['outcome']
        require(machine_binding_current(row) and row['status'] == expected, 'Delivered claim has a conflicting current status.')
        require(all(row['summary'][key] == claim[key] for key in ('scope', 'reviewContext', 'tagId', 'assessment')),
                'Delivered claim content differs.')
        require(any(item['auditId'] == audit['auditId'] and item['result'] == result for item in row['audits']),
                'Exact independent audit result is missing from feedback.')
        statuses[claim['id']] = row['status']
    for link in entry['supersedes']:
        if results[link['replacementClaimId']]['outcome'] == 'needs-revision':
            continue
        row = rows[(link['handoffId'], link['claimId'])]
        require(row.get('supersededBy') == {'handoffId': entry['handoffId'], 'claimId': link['replacementClaimId']},
                'Reviewed replacement did not retire the original machine claim.')
    for lineage in entry.get('lineageRepairs', []):
        terminal = lineage['chain'][-1]
        link = next((link for link in entry['supersedes'] if
                     (link['handoffId'], link['claimId']) == (terminal['handoffId'], terminal['claimId'])), None)
        if link is None or results[link['replacementClaimId']]['outcome'] == 'needs-revision':
            continue
        for left, right in zip(lineage['chain'], lineage['chain'][1:]):
            row = rows[(left['handoffId'], left['claimId'])]
            require(row.get('supersededBy') == {'handoffId': right['handoffId'], 'claimId': right['claimId']},
                    'Reviewed terminal repair did not propagate through its original lineage.')
    return statuses


def submit_packet(server, path, receipt_path, kind, packet_id, source_sha):
    cli('submit', '--server', server, '--input', path, '--out', receipt_path)
    receipt = read(receipt_path)
    require(receipt['id'] and receipt['kind'] == kind and receipt['packetId'] == packet_id
            and receipt['sourceSha256'] == source_sha, 'Submission receipt identity differs.')
    require(receipt['status'] in ('imported', 'duplicate') and receipt['baseStatus'] == 'current',
            'Submission was not imported against the current base.')
    return receipt


def deliver_audits(batch_root, audit_job, campaign):
    """Seal actual auditor responses, then deliver their exact handoffs and audits."""
    batch_root, audit_job = Path(batch_root).resolve(), Path(audit_job).resolve()
    config = config_for(campaign)
    manifest_path = batch_root / 'packets/manifest.json'
    manifest = read(manifest_path)
    require(manifest['server'] == config['server'], 'Delivery server differs from preparation.')
    require(sha(manifest['labelerRun']['path']) == manifest['labelerRun']['sha256'], 'Labeler run record changed.')
    run, agent = completed_job(audit_job, 'auditor')
    human_refs, evidence_trace_sha = human_evidence(audit_job, run)
    require(agent['producerId'].strip() != manifest['labelerRun']['producerId'].strip(), 'Auditor must be independent.')
    entries = keyed(manifest['entries'], 'caseId')
    keyed(read(audit_job / 'cases.json')['cases'], 'caseId', entries)
    verdicts = keyed(read(audit_job / 'response.json')['cases'], 'caseId', entries)
    audit_manifest = {'kind': 'section-annotation-audits-v1', 'createdAt': now(),
                      'handoffManifestSha256': sha(manifest_path), 'auditorRunPath': str(audit_job / 'run.json'),
                      'auditorRunSha256': sha(audit_job / 'run.json'), 'producerId': agent['producerId'],
                      'responseSha256': run['responseSha256'], 'entries': []}
    if evidence_trace_sha is not None:
        audit_manifest['humanEvidenceTraceSha256'] = evidence_trace_sha
    audit_manifest_path = batch_root / 'packets/audit-manifest.json'
    if audit_manifest_path.exists():
        previous = read(audit_manifest_path)
        identity_fields = ('handoffManifestSha256', 'auditorRunPath', 'auditorRunSha256',
                           'producerId', 'responseSha256', 'humanEvidenceTraceSha256')
        require(all(previous.get(key) == audit_manifest.get(key) for key in identity_fields),
                'Existing independent audit belongs to different immutable worker evidence.')
        audit_manifest['createdAt'] = previous['createdAt']
    # Validate every response before any public submission, including the worker's
    # frozen copies of the exact task and original handoff.
    prepared = []
    for case_id, entry in entries.items():
        task, handoff = verify_entry(entry)
        require(entry['taskFileSha256'] in run['inputHashes'].values()
                and entry['handoffFileSha256'] in run['inputHashes'].values(),
                'Auditor inputs do not pin the exact task and handoff files.')
        require(read(audit_job / 'foundation.json')['foundationSha256'] == task['foundationSha256'],
                'Auditor Foundation differs from the sealed task.')
        proposal = audit_proposal(entry, handoff, verdicts[case_id], run, agent)
        if human_refs is not None:
            proposal['humanEvidenceRefs'] = human_refs
        prepared.append((entry, handoff, proposal))
    for entry, handoff, proposal in prepared:
        folder = Path(entry['handoffPath']).parent
        input_path, audit_path = folder / 'audit-input.json', folder / 'audit.json'
        if audit_path.exists():
            require(read(input_path) == proposal, 'Existing independent audit is immutable; response changed.')
        else:
            save(input_path, proposal)
            cli('audit', '--task', entry['taskPath'], '--handoff', entry['handoffPath'], '--input', input_path, '--out', audit_path)
        audit = read(audit_path)
        require(audit['handoffSha256'] == entry['handoffSha256'] and audit['agent'] == agent,
                'Sealed audit binding or producer differs.')
        require(all(audit[key] == value for key, value in proposal.items()),
                'Sealed audit differs from the actual auditor response.')
        audit_manifest['entries'].append({'caseId': entry['caseId'], 'auditPath': str(audit_path),
                                         'auditSha256': sha(audit_path), 'auditId': audit['auditId'],
                                         'coverageRationale': verdicts[entry['caseId']]['coverageRationale']})
    save(audit_manifest_path, audit_manifest)
    delivery = {'kind': 'section-annotation-delivery-v1', 'startedAt': now(), 'status': 'in-progress',
                'auditManifestSha256': sha(audit_manifest_path),
                'entries': [], 'skippedCells': manifest['skippedCells']}
    for (entry, handoff, _), sealed in zip(prepared, audit_manifest['entries']):
        folder = batch_root / 'receipts' / entry['caseId']
        result = {'caseId': entry['caseId'], 'handoffId': entry['handoffId'], 'auditId': sealed['auditId']}
        try:
            verify_entry(entry)
            require(sha(sealed['auditPath']) == sealed['auditSha256'], 'Sealed audit file changed.')
            audit = read(sealed['auditPath'])
            before = feedback(config['server'], entry['sourceSha256'])
            save(folder / 'feedback-before.json', before)
            if any(item['auditId'] == audit['auditId'] for item in before['audits']):
                statuses = verify_applied(before, entry, handoff, audit, sealed['auditSha256'])
                result.update(status='already-delivered', claimStatuses=statuses)
            else:
                check_delivery(before, entry, handoff)
                humans = human_records(before)
                submit_packet(config['server'], entry['handoffPath'], folder / 'handoff-receipt.json',
                              'handoff', entry['handoffId'], entry['sourceSha256'])
                interim = feedback(config['server'], entry['sourceSha256'])
                save(folder / 'feedback-after-handoff.json', interim)
                check_delivery(interim, entry, handoff)
                submit_packet(config['server'], sealed['auditPath'], folder / 'audit-receipt.json',
                              'audit', sealed['auditId'], entry['sourceSha256'])
                after = feedback(config['server'], entry['sourceSha256'])
                save(folder / 'feedback-after.json', after)
                statuses = verify_applied(after, entry, handoff, audit, sealed['auditSha256'])
                result.update(status='delivered', claimStatuses=statuses,
                              humanRecordsUnchanged=human_records(after) == humans)
        except (ValueError, RuntimeError, OSError) as error:
            result.update(status='blocked', error=str(error))
        delivery['entries'].append(result)
        save(batch_root / 'receipts/delivery.json', delivery)
    status = ('blocked' if any(e['status'] == 'blocked' for e in delivery['entries']) else
              'needs-controller' if any(cell['conflict'] for cell in manifest['skippedCells']) else 'complete')
    delivery.update(status=status, finishedAt=now())
    save(batch_root / 'receipts/delivery.json', delivery)
    return delivery
