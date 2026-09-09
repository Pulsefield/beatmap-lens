"""Natural chart library with separate community and confirmed human evidence.

The bundle freezes data, not executable tools. Inspection reuses the repository's
current Harness; no machine proposal or independently generated label is imported.
"""
from collections import Counter
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from annotation_runtime import REPO, load_module
from playback_rate import same_playback_rate

public_example = load_module(REPO / 'harness/harness_examples.py').public_example


SCRIPTS = Path(__file__).resolve().parent
SOURCE_KEYS = ('sha256', 'byteLength', 'osuFormatVersion', 'beatmapId', 'beatmapSetId',
               'title', 'artist', 'creator', 'difficulty', 'keyCount', 'noteCount', 'normalizerId')
NOTE_KEYS = ('sourceLine', 'column', 'kind', 'startMs', 'endMs')
EVIDENCE_ROLES = {
    'naturalSource': 'Exact source events support temporal, action and multiscale organization reading; no human label is required.',
    'community': 'Human votes describe this difficulty as a whole, not every section. Missing tags are not negative section judgments.',
    'humanSection': 'Confirmed human judgments apply to their original source and scope. Comments are exact human text when available.',
    'agentInterpretation': 'An interpretation to revisit against sources and human evidence, never another human label.',
}


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')


def _source(source):
    return {key: source[key] for key in SOURCE_KEYS if key in source}


def _chart(chart):
    return {'source': _source(chart['source']),
            'range': {key: chart['range'][key] for key in ('startMs', 'endMs')},
            'notes': [{key: note[key] for key in NOTE_KEYS} for note in chart['notes']],
            'timingPoints': [{'sourceLine': point['sourceLine'], 'fields': point['fields']}
                             for point in chart['timingPoints']]}


def _human_inputs(bundle):
    if bundle is None:
        return None, {}, []
    manifest = read(bundle / 'manifest.json')
    if (manifest['kind'] != 'beatmap-lens-annotation-harness-v1' or manifest['mode'] != 'annotation'
            or manifest['excludedSources'] or manifest['excludedGroups']):
        raise ValueError('Human learning input must be an annotation-mode bundle without evaluation exclusions.')
    for name, expected in manifest['files'].items():
        if digest(bundle / name) != expected:
            raise ValueError(f'Frozen human input changed: {name}')
    charts = {sha: _chart(read(bundle / ref['path'])) for sha, ref in manifest['charts'].items()}
    for sha, chart in charts.items():
        if chart['source']['sha256'] != sha:
            raise ValueError('Human chart source binding differs.')
    examples = [public_example(row) for row in read(bundle / 'examples.json')]
    return manifest, charts, examples


def prepare_corpus(dataset: Path, beatmapsets: list[int], human_bundle: Path | None,
                   out: Path):
    """Import all confirmed human examples and selected natural 4K difficulties.

    Only selected sets expand to sibling charts. Already available human-source
    charts remain usable even when their raw .osu is absent from this dataset.
    """
    dataset, out = Path(dataset).resolve(), Path(out).resolve()
    human_bundle = Path(human_bundle).resolve() if human_bundle is not None else None
    if out.exists():
        raise FileExistsError(f'Choose a fresh learning output directory: {out}')
    human_manifest, charts, examples = _human_inputs(human_bundle)
    sets = sorted(set(beatmapsets))
    source_paths, set_files = set(), {}

    def sources_in_set(identity):
        if identity not in set_files:
            directory = dataset / '0' / str(identity)
            set_files[identity] = {digest(path): path for path in sorted(directory.glob('*.osu'))}
        return set_files[identity]

    for identity in sets:
        paths = sources_in_set(identity)
        if not paths:
            raise ValueError(f'No .osu files in selected beatmapset: {identity}')
        source_paths.update(paths.values())
    for sha, chart in charts.items():
        path = sources_in_set(chart['source'].get('beatmapSetId')).get(sha)
        if path is not None:
            source_paths.add(path)
    parsed = {'charts': [], 'skipped': []}
    if source_paths:
        result = subprocess.run(['node', str(SCRIPTS / 'prepare-learning-sources.mjs')],
                                input=json.dumps([str(p) for p in sorted(source_paths)]),
                                text=True, capture_output=True, check=True, cwd=REPO)
        parsed = json.loads(result.stdout)
    normalized = {row['chart']['source']['sha256']: row for row in parsed['charts']}
    for sha, row in normalized.items():
        # Human bundle judgments remain bound to its verified normalized source.
        if sha not in charts:
            charts[sha] = _chart(row['chart'])
    out.mkdir(parents=True, exist_ok=False)
    metadata_cache = {}
    vocabulary = None
    vocabulary_sha = None

    def community(source, row):
        nonlocal vocabulary, vocabulary_sha
        identity, beatmap_id = source.get('beatmapSetId'), source.get('beatmapId')
        if identity not in metadata_cache:
            original = dataset / '0' / str(identity) / 'metadata.json'
            if original.is_file():
                relative = f'metadata/{identity}.json'
                (out / relative).parent.mkdir(exist_ok=True)
                shutil.copyfile(original, out / relative)
                metadata_cache[identity] = (read(out / relative), digest(out / relative), relative, str(original))
            else:
                metadata_cache[identity] = None
        snapshot = metadata_cache[identity]
        if snapshot is None:
            return None
        metadata, snapshot_sha, relative, original = snapshot
        beatmap = next((b for b in metadata['beatmaps'] if b['id'] == beatmap_id), None)
        if beatmap is None:
            return None
        names = {tag['id']: tag['name'] for tag in metadata['tags']['related']}
        votes = beatmap.get('top_tag_ids', [])
        if any(v['tag_id'] not in names for v in votes):
            if vocabulary is None:
                vocabulary_path = dataset / 'metadata/osu_tags_2026-08-07.json'
                vocabulary = {}
                if vocabulary_path.is_file():
                    target = out / 'metadata/osu_tags_2026-08-07.json'
                    shutil.copyfile(vocabulary_path, target)
                    vocabulary_sha = digest(target)
                    vocabulary = {tag['id']: tag['name'] for tag in read(target)['tags']}
            names = vocabulary | names
        source_md5, metadata_md5 = row['sourceMd5'] if row else None, beatmap.get('checksum')
        tags = [{'id': vote['tag_id'], 'name': names.get(vote['tag_id'], f"#{vote['tag_id']}"),
                 'count': vote['count'], 'beatmapId': beatmap_id, 'metadataSha256': snapshot_sha,
                 'evidenceId': f"community:{snapshot_sha}:{beatmap_id}:{vote['tag_id']}"}
                for vote in votes]
        tags.sort(key=lambda tag: (-tag['count'], tag['name']))
        return {'scope': 'difficulty', 'beatmapId': beatmap_id, 'beatmapSetId': identity,
                'metadataSha256': snapshot_sha, 'metadataPath': relative, 'metadataSourcePath': original,
                'fetchedAt': metadata.get('fetched_at'), 'apiEndpoint': metadata.get('api_endpoint'),
                'sourceMd5': source_md5, 'metadataMd5': metadata_md5,
                'sourceByteMatch': source_md5 == metadata_md5 if source_md5 and metadata_md5 else None,
                'tags': tags,
                'interpretation': 'Votes join by beatmap ID and describe the difficulty at the metadata snapshot. '
                                  'MD5 agreement only checks byte identity; it does not prove voters reviewed these bytes. '
                                  'A mismatch preserves useful difficulty-level context without asserting source-byte endorsement.'}

    refs = {}
    sections = []
    for sha, chart in sorted(charts.items()):
        row = normalized.get(sha)
        source = chart['source']
        path = f'charts/{sha}.json'
        save(out / path, chart)
        ref = {'path': path, 'source': source, 'groupId': f"mapset:{source.get('beatmapSetId', sha)}",
               'origin': 'human-bundle-source' if human_manifest and sha in human_manifest['charts'] else 'natural-source',
               'rawSourcePath': None, 'originalSourcePath': None, 'rawSourceAvailable': row is not None,
               'community': community(source, row), 'audio': None}
        if human_manifest and sha in human_manifest['charts']:
            ref['groupId'] = human_manifest['charts'][sha]['groupId']
            ref['humanBundleManifestSha256'] = digest(human_bundle / 'manifest.json')
        if row:
            source_path = Path(row['sourcePath'])
            raw = f'sources/{sha}.osu'
            (out / raw).parent.mkdir(exist_ok=True)
            shutil.copyfile(source_path, out / raw)
            if digest(out / raw) != sha:
                raise ValueError(f'Source bytes changed during preparation: {source_path}')
            ref.update(rawSourcePath=raw, originalSourcePath=str(source_path))
            if row['audioFilename']:
                audio_path = (source_path.parent / row['audioFilename'].strip('"').replace('\\', '/')).resolve()
                ref['audio'] = {'path': str(audio_path), 'filename': row['audioFilename'],
                                'availableAtPreparation': audio_path.is_file(),
                                'audioLeadInMs': row['audioLeadInMs'], 'listened': False,
                                'interpretation': 'External audio reference only; playback/listening is not implied. '
                                                  'Shared beatmapset or filename does not establish exact alignment across difficulties.'}
        refs[sha] = ref
        sections.append({'sectionId': 'chart:' + sha, 'sourceSha256': sha,
                         'scope': chart['range'], 'reviewContext': chart['range']})
    for example in examples:
        ref = refs[example['sourceSha256']]
        example.update(groupId=ref['groupId'], **{k: ref['source'][k] for k in ('title', 'difficulty')})
    save(out / 'examples.json', examples)
    save(out / 'contrast-sets.json', {'sets': []})
    manifest = {'kind': 'beatmap-lens-learning-v1', 'mode': 'learning', 'charts': refs,
                'sections': sections, 'excludedSources': [], 'excludedGroups': [],
                'files': {str(p.relative_to(out)): digest(p) for p in sorted(out.rglob('*')) if p.is_file()},
                'provenance': {'dataset': str(dataset), 'selectedBeatmapsets': sets,
                               'humanBundle': str(human_bundle) if human_bundle else None,
                               'humanBundleManifestSha256': digest(human_bundle / 'manifest.json') if human_bundle else None,
                               'tagVocabularySha256': vocabulary_sha,
                               'preparerSha256': digest(Path(__file__)),
                               'parserHelperSha256': digest(SCRIPTS / 'prepare-learning-sources.mjs'),
                               'normalizerSourceSha256': digest(REPO / 'apps/inspector/src/annotation/source-identity.ts'),
                               'skippedOutside4KMania': parsed['skipped']},
                'evidenceRoles': EVIDENCE_ROLES,
                'limits': ['Data snapshot uses current repository inspection tools; tool implementations are not frozen here.',
                           'Community tags are whole-difficulty evidence; human section judgments retain their exact scopes.',
                           'Natural charts require no labels. Agent-generated section annotations are not learning evidence.',
                           'Audio stays an external availability pointer; no listening or cross-difficulty alignment is asserted.']}
    if human_manifest and 'foundationSha256' in human_manifest:
        manifest['foundationSha256'] = human_manifest['foundationSha256']
    save(out / 'manifest.json', manifest)
    return {'output': str(out), 'charts': len(refs), 'examples': len(examples),
            'chartsWithoutHumanJudgments': len(set(refs) - {e['sourceSha256'] for e in examples}),
            'communityTaggedCharts': sum(bool(ref['community'] and ref['community']['tags']) for ref in refs.values()),
            'selectedBeatmapsets': sets, 'skippedOutside4KMania': len(parsed['skipped']),
            'manifestSha256': digest(out / 'manifest.json')}


_harness = load_module(REPO / 'harness/annotation-harness.py')


class LearningCorpus(_harness.Harness):
    def __init__(self, bundle, trace=None):
        super().__init__(bundle, trace)
        if self.manifest['kind'] != 'beatmap-lens-learning-v1':
            raise ValueError('Use a prepared natural learning corpus.')
        self.human_counts = Counter(example['sourceSha256'] for example in self.examples)

    def catalog(self, text='', community_tag='', offset=0, limit=8):
        if offset < 0 or limit < 1:
            raise ValueError('offset must be nonnegative and limit positive')
        limit = min(limit, 24)
        terms = text.casefold().split()
        matches = []
        for sha, ref in self.manifest['charts'].items():
            source = ref['source']
            tags = ref['community']['tags'] if ref['community'] else []
            searchable = ' '.join(str(source.get(key, '')) for key in
                                  ('title', 'artist', 'creator', 'difficulty', 'beatmapId', 'beatmapSetId')).casefold()
            if not all(term in searchable for term in terms):
                continue
            if community_tag and not any(community_tag.casefold() in tag['name'].casefold()
                                         or community_tag == str(tag['id']) for tag in tags):
                continue
            matches.append({'handle': 'chart:' + sha, 'source': _source(source),
                            'groupId': ref['groupId'], 'humanJudgmentCount': self.human_counts[sha],
                            'communityTags': [{key: tag[key] for key in ('id', 'name', 'count')} for tag in tags]})
        matches.sort(key=lambda item: (item['source'].get('beatmapSetId', 0),
                                       item['source'].get('beatmapId', 0), item['handle']))
        cards = matches[offset:offset + limit]
        return {'cards': cards, 'total': len(matches), 'offset': offset, 'limit': limit,
                'nextOffset': offset + len(cards) if offset + len(cards) < len(matches) else None,
                'order': 'beatmapset-id, beatmap-id, source-sha',
                'interpretation': 'Natural source discovery includes unlabelled charts. Community tag filters select whole difficulties, not section judgments.'}

    def context(self, handle=None, start_ms=None, end_ms=None, timing_offset=0, timing_limit=12,
                section_id=None):
        handle = handle or section_id
        section, _, start, end = self.bounds(handle, start_ms, end_ms)
        result = super().context(handle, start, end, timing_offset, timing_limit)
        sha = section['sourceSha256']
        ref = self.manifest['charts'][sha]
        result.update(handle=handle, evidenceRoles=deepcopy(EVIDENCE_ROLES),
                      community=deepcopy(ref['community']), audio=deepcopy(ref['audio']),
                      existingHumanJudgments=[public_example(example) for example in self.examples
                                              if example['sourceSha256'] == sha
                                              and same_playback_rate(example, section)
                                              and max(start, example['scope']['startMs']) < min(end, example['scope']['endMs'])],
                      siblingDifficulties=[{'handle': 'chart:' + other_sha, 'source': _source(other['source'])}
                                           for other_sha, other in self.manifest['charts'].items()
                                           if other_sha != sha and other['source'].get('beatmapSetId') == ref['source'].get('beatmapSetId')],
                      sourceReference={'rawSourcePath': ref['rawSourcePath'],
                                       'originalSourcePath': ref['originalSourcePath'],
                                       'rawSourceAvailable': ref['rawSourceAvailable']})
        if result['audio']:
            result['audio']['availableNow'] = Path(result['audio']['path']).is_file()
        return result

    def inspect(self, handle, start_ms=None, end_ms=None, view='rows', offset=0, limit=32):
        return self.rows(handle, start_ms, end_ms, view, offset, limit)
