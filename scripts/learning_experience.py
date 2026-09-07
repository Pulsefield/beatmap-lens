"""Revisable reading experience grounded in charts and independently resolved human evidence."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

from harness_examples import public_example


FIELDS = {'id', 'title', 'time', 'action', 'organization', 'instances', 'humanAnchors',
          'communityAnchors', 'audioEvidence', 'limitations', 'updateReason'}


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _bounds(value, enclosing):
    start, end = value['startMs'], value['endMs']
    if not enclosing['startMs'] <= start < end <= enclosing['endMs']:
        raise ValueError(f'Choose an increasing scope within {enclosing}.')
    return {'startMs': start, 'endMs': end}


def _audio_evidence(corpus, paths, instances):
    evidence = []
    for name in dict.fromkeys(paths):
        path = Path(name).resolve()
        record = read(path)
        if record['kind'] != 'beatmap-lens-audio-evidence-v1':
            raise ValueError('Use evidence.json from the audio view command.')
        if record['corpusManifestSha256'] != digest(corpus.bundle / 'manifest.json'):
            raise ValueError('Audio evidence must belong to this corpus snapshot.')
        sha, scope = record['sourceSha256'], record['scope']
        _bounds(scope, corpus.chart(sha)['range'])
        if not any(instance['sourceSha256'] == sha
                   and max(scope['startMs'], instance['reviewContext']['startMs'])
                   < min(scope['endMs'], instance['reviewContext']['endMs']) for instance in instances):
            raise ValueError('Audio evidence must overlap a source instance in this experience.')
        audio_path = Path(corpus.manifest['charts'][sha]['audio']['path']).resolve()
        if Path(record['audio']['path']).resolve() != audio_path or digest(audio_path) != record['audio']['sha256']:
            raise ValueError('Audio bytes differ from the cited view.')
        for relative, expected in record['files'].items():
            if digest(path.parent / relative) != expected:
                raise ValueError(f'Audio view artifact changed: {relative}')
        evidence.append({'modality': 'mel-view', 'evidencePath': str(path),
                         'evidenceSha256': digest(path), 'sourceSha256': sha,
                         'scope': scope, 'audioSha256': record['audio']['sha256']})
    return evidence


def resolve_experience(corpus, value):
    """Resolve anchors from the corpus; a writer cannot supply a human verdict or comment."""
    if set(value) - FIELDS:
        raise ValueError('Experience accepts reading interpretations, not predicted section labels or supplied human evidence.')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,95}', value['id']):
        raise ValueError('Use a lowercase experience id with letters, digits and hyphens.')
    for key in ('title', 'time', 'action', 'organization'):
        if not value[key].strip():
            raise ValueError(f'Provide the {key} reading.')
    if not value['instances']:
        raise ValueError('A reading experience needs at least one actual source instance.')
    instances = []
    for instance in value['instances']:
        chart = corpus.chart(instance['sourceSha256'])
        scope = _bounds(instance['scope'], chart['range'])
        context = _bounds(instance.get('reviewContext', scope), chart['range'])
        _bounds(scope, context)
        notes = {note['sourceLine']: note for note in chart['notes']}
        refs = []
        for line in dict.fromkeys(instance['sourceLines']):
            note = notes[line]
            touches = (note['startMs'] < context['endMs'] and note['endMs'] >= context['startMs']
                       if note['kind'] == 'long' else context['startMs'] <= note['startMs'] < context['endMs'])
            if not touches:
                raise ValueError('Witness notes must belong to the declared context, including entering holds.')
            refs.append({key: note[key] for key in ('sourceLine', 'column', 'kind', 'startMs', 'endMs')})
        if not refs:
            raise ValueError('Cite source lines explaining the reading; the scope still concerns the complete arrangement.')
        instances.append({'sourceSha256': instance['sourceSha256'], 'scope': scope,
                          'reviewContext': context, 'sourceNotes': refs})
    examples = {row['id']: row for row in corpus.examples}
    human = [public_example(examples[identity]) for identity in dict.fromkeys(value.get('humanAnchors', []))]
    community = []
    for anchor in value.get('communityAnchors', []):
        sha = anchor['sourceSha256']
        evidence = corpus.manifest['charts'][sha]['community']
        tag = next(tag for tag in evidence['tags'] if tag['id'] == anchor['tagId'])
        community.append({'sourceSha256': sha, 'scope': 'difficulty',
                          **{key: evidence[key] for key in ('beatmapId', 'metadataSha256', 'sourceByteMatch')},
                          'tag': {key: tag[key] for key in ('id', 'name', 'count', 'evidenceId')}})
    result = {'id': value['id'], 'title': value['title'],
            'interpretation': {key: value[key] for key in ('time', 'action', 'organization')},
            'instances': instances, 'humanEvidence': human, 'communityEvidence': community,
            'limitations': value.get('limitations', []), 'updateReason': value.get('updateReason', '')}
    if value.get('audioEvidence'):
        result['audioEvidence'] = _audio_evidence(corpus, value['audioEvidence'], instances)
    return result


def remember(corpus, memory, value, producer):
    resolved = resolve_experience(corpus, value)
    memory = Path(memory)
    memory.mkdir(parents=True, exist_ok=True)
    previous = sorted(memory.glob(f"{value['id']}.*.json"))
    last = read(previous[-1]) if previous else None
    if last and not resolved['updateReason'].strip():
        raise ValueError('A revision needs updateReason; earlier readings remain available.')
    revision = last['revision'] + 1 if last else 1
    record = {'kind': 'beatmap-lens-reading-experience-v1', 'status': 'agent-hypothesis',
              'use': 'Source inspection and retrieval guidance; never section supervision or human authority.',
              'producer': producer, 'createdAt': datetime.now(timezone.utc).isoformat(),
              'revision': revision, 'previousSha256': digest(previous[-1]) if last else None,
              'corpusManifestSha256': digest(corpus.bundle / 'manifest.json'), **resolved}
    target = memory / f"{value['id']}.{revision:04d}.json"
    with target.open('x') as stream:
        stream.write(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
    return {'path': str(target.resolve()), 'id': value['id'], 'revision': revision,
            'status': record['status'], 'sha256': digest(target)}


def recall(memory, text='', identity=None, limit=5):
    files = sorted(Path(memory).glob('*.json'))
    records = [read(path) | {'path': str(path.resolve())} for path in files]
    if identity:
        return {'id': identity, 'history': [row for row in records if row['id'] == identity],
                'use': 'Reopen source evidence before reusing an agent interpretation.'}
    latest = {row['id']: row for row in records}
    words = text.casefold().split()
    matches = [row for row in latest.values()
               if all(word in (row['title'] + ' ' + ' '.join(row['interpretation'].values())).casefold()
                      for word in words)]
    return {'total': len(matches), 'cards': [
        {key: row[key] for key in ('id', 'title', 'revision', 'status', 'path')}
        | {'sourceCount': len({item['sourceSha256'] for item in row['instances']}),
           'humanAnchorCount': len(row['humanEvidence']), 'communityAnchorCount': len(row['communityEvidence'])}
        for row in matches[:max(1, min(limit, 12))]],
        'use': 'These are agent reading hypotheses, not new human examples or training labels.'}
