"""Freeze current canonical human High judgments for one paired regression run."""
from collections import defaultdict
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import uuid

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'annotation'))
from playback_rate import normalize_playback_rate

KIND = 'annotation-high-confidence-suite-v1'
TAGS = {'jack-organization', 'stream-organization', 'trill-organization', 'tech', 'ln-coordination'}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def current_feedback(workflow_dir):
    """Use the canonical TS workflow reader, including its revision resolution."""
    result = subprocess.run(['node', str(Path(__file__).with_name('read-current-human-feedback.mjs')),
                             '--workflow-dir', str(Path(workflow_dir).resolve())],
                            text=True, capture_output=True)
    if result.returncode:
        raise ValueError('Cannot read current canonical human judgments: ' + result.stderr.strip())
    return json.loads(result.stdout)


def build_suite(feedbacks, comparison_id):
    """Consume effective observations only; never resurrect append-only history.

    The canonical reader supplies one latest document per source. Selecting the
    latest document first also makes exported fixture/snapshot duplicates safe:
    lowering confidence must remove the old High observation before filtering.
    """
    latest = {}
    for feedback in feedbacks:
        if 'effectiveHumanObservations' not in feedback:
            raise ValueError('Current canonical effectiveHumanObservations are required; legacy feedback is not gold.')
        source, version = feedback['sourceSha256'], feedback['documentVersion']
        previous = latest.get(source)
        if previous and previous['documentVersion']['revision'] > version['revision']:
            continue
        if previous and previous['documentVersion']['revision'] == version['revision']:
            if (previous['documentVersion'] != version or
                    previous['effectiveHumanObservations'] != feedback['effectiveHumanObservations']):
                raise ValueError('Conflicting current document identity: ' + source)
        latest[source] = feedback
    cells, documents = {}, []
    for source, feedback in sorted(latest.items()):
        version = feedback['documentVersion']
        if not version.get('sha256') or not isinstance(version.get('revision'), int):
            raise ValueError('Missing canonical document identity: ' + source)
        documents.append({'sourceSha256': source, 'documentVersion': deepcopy(version)})
        seen = {}
        for observation in feedback['effectiveHumanObservations']:
            identity = observation['id']
            if identity in seen and seen[identity] != observation:
                raise ValueError('Conflicting effective observation identity: ' + identity)
            seen[identity] = observation
        for observation in seen.values():
            if observation.get('confidence') != 'high':
                continue
            claim = observation.get('claim', observation.get('summary'))
            identity = observation['id']
            if (not observation.get('observationSha256') or not observation.get('foundationSha256') or
                    any(observation.get('trust', {}).get(layer) != 'current' for layer in ('source', 'foundation'))):
                raise ValueError('High-confidence observation has unusable current identity/trust: ' + identity)
            assessment = claim['assessment']
            valid = ({'presence': 'absent'}, {'presence': 'present', 'salience': 'supporting'},
                     {'presence': 'present', 'salience': 'prominent'})
            if assessment not in valid or claim['tagId'] not in TAGS:
                raise ValueError('High-confidence observation has unsupported judgment: ' + identity)
            rate = normalize_playback_rate(claim.get('playbackRate'))
            scope, context = claim['scope'], claim['reviewContext']
            key = (source, scope['startMs'], scope['endMs'], claim['tagId'], rate)
            pin = {key: deepcopy(observation[key]) for key in
                   ('id', 'observationSha256', 'foundationSha256', 'humanId', 'confirmedAt') if key in observation}
            pin.update(documentVersion=deepcopy(version), claimId=claim['id'],
                       reviewContext=deepcopy(context), confidence='high')
            if key in cells and cells[key]['assessment'] != assessment:
                raise ValueError('Conflicting independent current High judgments for cell: ' + str(key))
            cell = cells.setdefault(key, {'assessment': deepcopy(assessment), 'humans': []})
            cell['humans'].append(pin)
    if not cells:
        raise ValueError('Zero usable current high-confidence human gold cells. Mark human observations High explicitly; '
                         'historical missing confidence and static suites are not a fallback.')
    sections = defaultdict(dict)
    for (source, start, end, tag, rate), cell in sorted(cells.items()):
        sections[(source, start, end, rate)][tag] = cell
    cases = []
    for (source, start, end, rate), tagged in sorted(sections.items()):
        pins = [pin for cell in tagged.values() for pin in cell['humans']]
        section = {'sourceSha256': source, 'scope': {'startMs': start, 'endMs': end}, 'playbackRate': rate}
        cases.append({**section, 'caseId': 'human-' + digest(section)[:24], 'critical': True,
                      'reviewContext': {'startMs': min(p['reviewContext']['startMs'] for p in pins),
                                        'endMs': max(p['reviewContext']['endMs'] for p in pins)},
                      'gold': {tag: cell['assessment'] for tag, cell in sorted(tagged.items())},
                      'humans': {tag: sorted(cell['humans'], key=lambda pin: (pin['id'], pin['observationSha256']))
                                 for tag, cell in sorted(tagged.items())}})
    return {'kind': KIND, 'comparisonId': comparison_id,
            'selection': {'authority': 'current-canonical-workflow', 'confidence': 'high',
                          'documents': documents}, 'cases': cases}


def validate_suite(suite):
    if suite.get('kind') != KIND or not suite.get('comparisonId'):
        raise ValueError('A frozen automatic current-human High suite is required; historical static suites are not active.')
    cases = suite.get('cases', [])
    if not cases or any(not c.get('gold') for c in cases):
        raise ValueError('Zero usable current high-confidence human gold cells.')
    if any(c.get('critical') is not True for c in cases):
        raise ValueError('Every current high-confidence human gold cell must be protected.')
    keys = [(c['sourceSha256'], c['scope']['startMs'], c['scope']['endMs'], tag,
             normalize_playback_rate(c.get('playbackRate'))) for c in cases for tag in c['gold']]
    if len(keys) != len(set(keys)) or len({c['caseId'] for c in cases}) != len(cases):
        raise ValueError('Duplicate scored human gold cells or case identities.')


def freeze(workflow_dir, out):
    suite = build_suite(current_feedback(workflow_dir), str(uuid.uuid4()))
    validate_suite(suite)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('x') as stream:
        stream.write(json.dumps(suite, ensure_ascii=False, indent=2) + '\n')
    return {'status': 'frozen-not-launched', 'suite': str(out.resolve()), 'suiteSha256': digest(suite),
            'sections': len(suite['cases']), 'goldCells': sum(len(c['gold']) for c in suite['cases'])}


def require_current(suite, workflow_dir):
    validate_suite(suite)
    current = build_suite(current_feedback(workflow_dir), suite['comparisonId'])
    if current != suite:
        raise ValueError('Frozen gold differs from current canonical observations/documents. '
                         'Freeze a new suite and rerun both sides; stale feedback or accepted evidence cannot pass.')
