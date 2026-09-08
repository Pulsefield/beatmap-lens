"""Supported natural-source import and human-evidence boundaries."""
import hashlib
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest

from learning_corpus import LearningCorpus, SCRIPTS, digest, prepare_corpus, read, save


def source_text(beatmap_id, set_id, difficulty, keys=4):
    return (f'osu file format v14\n[General]\nAudioFilename: song.mp3\nAudioLeadIn: 0\nMode: 3\n'
            f'[Metadata]\nTitle: Natural Song\nArtist: Musician\nCreator: Mapper\nVersion: {difficulty}\n'
            f'BeatmapID: {beatmap_id}\nBeatmapSetID: {set_id}\n[Difficulty]\nCircleSize: {keys}\n'
            '[TimingPoints]\n0,500,4,2,0,100,1,0\n1500,250,4,2,0,100,1,0\n'
            '1600,-50,4,2,0,100,0,0\n[HitObjects]\n'
            '64,192,1000,128,0,1750:0:0:0:0:\n192,192,1250,1,0,0:0:0:0:\n'
            '320,192,1500,1,0,0:0:0:0:\n448,192,1750,1,0,0:0:0:0:\n')


class LearningCorpusTest(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.dataset = self.root / 'dataset'
        self.paths = {}
        for beatmap_id, set_id, difficulty, keys in ((101, 10, 'First', 4), (102, 10, 'Sibling', 4),
                                                    (103, 10, 'Seven', 7), (201, 20, 'Another', 4)):
            path = self.dataset / '0' / str(set_id) / (difficulty + '.osu')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(source_text(beatmap_id, set_id, difficulty, keys))
            self.paths[beatmap_id] = path
        save(self.dataset / '0/10/metadata.json', {
            'id': 10, 'fetched_at': '2026-08-07T00:00:00Z',
            'api_endpoint': 'https://osu.ppy.sh/api/v2/beatmapsets/10',
            'tags': {'related': [{'id': 113, 'name': 'style/LN coordination'}]},
            'beatmaps': [
                {'id': 101, 'checksum': 'previous-source-md5', 'top_tag_ids': [{'tag_id': 113, 'count': 4}]},
                {'id': 102, 'checksum': hashlib.md5(self.paths[102].read_bytes()).hexdigest(),
                 'top_tag_ids': [{'tag_id': 119, 'count': 2}]},
            ],
        })
        save(self.dataset / 'metadata/osu_tags_2026-08-07.json',
             {'tags': [{'id': 119, 'name': 'tech/technical hybrid'}]})
        # No audio fixture is fabricated: source references correctly report unavailable.

    def make_human_bundle(self):
        bundle = self.root / 'human'
        normalized = json.loads(subprocess.run(
            ['node', str(SCRIPTS / 'prepare-learning-sources.mjs')],
            input=json.dumps([str(self.paths[identity]) for identity in (101, 201)]),
            text=True, capture_output=True, check=True).stdout)['charts']
        refs = {}
        for row in normalized:
            chart = row['chart']
            sha = chart['source']['sha256']
            path = f'charts/{sha}.json'
            chart['agentComment'] = 'machine-only-chart-comment'
            chart['source']['agentComment'] = 'machine-only-source-comment'
            chart['notes'][0]['agentReasoning'] = 'machine-only-note-comment'
            save(bundle / path, chart)
            refs[sha] = {'source': chart['source'], 'path': path,
                         'groupId': f"mapset:{chart['source']['beatmapSetId']}"}
        sha = digest(self.paths[101])
        example = {'id': 'human-confirmed', 'sourceSha256': sha, 'tagId': 'tech',
                   'assessment': {'presence': 'present', 'salience': 'supporting',
                                  'agentReasoning': 'machine-only-assessment'},
                   'scope': {'startMs': 1000, 'endMs': 1251, 'proposal': 'machine-only-scope'},
                   'reviewContext': {'startMs': 0, 'endMs': 1751},
                   'humanComment': 'Confirmed human interpretation.',
                   'status': 'machine-only-status', 'proposal': 'machine-only-proposal',
                   'agentComment': 'machine-only-comment', 'audit': {'text': 'machine-only-audit'}}
        save(bundle / 'examples.json', [example])
        save(bundle / 'contrast-sets.json', {'sets': []})
        save(bundle / 'manifest.json', {
            'kind': 'beatmap-lens-annotation-harness-v1', 'mode': 'annotation',
            'charts': refs, 'sections': [], 'foundationSha256': 'human-foundation',
            'excludedSources': [], 'excludedGroups': [],
            'files': {str(path.relative_to(bundle)): digest(path)
                      for path in bundle.rglob('*') if path.is_file()},
        })
        return bundle

    def test_natural_siblings_need_no_annotations_and_preserve_source_timing(self):
        out = self.root / 'natural'
        before = {str(p): digest(p) for p in self.dataset.rglob('*') if p.is_file()}
        summary = prepare_corpus(self.dataset, [10], None, out)
        self.assertEqual((summary['charts'], summary['examples'], summary['chartsWithoutHumanJudgments']), (2, 0, 2))
        self.assertEqual(summary['skippedOutside4KMania'], 1)
        corpus = LearningCorpus(out)
        catalog = corpus.catalog(limit=1)
        self.assertEqual(catalog['total'], 2)
        self.assertEqual(catalog['nextOffset'], 1)
        self.assertEqual(corpus.catalog(offset=1)['cards'][0]['source']['beatmapId'], 102)
        self.assertEqual(corpus.catalog(community_tag='technical hybrid')['cards'][0]['source']['beatmapId'], 102)
        handle = 'chart:' + digest(self.paths[101])
        context = corpus.context(handle, 1250, 1751)
        self.assertEqual(context['existingHumanJudgments'], [])
        self.assertEqual(context['activeTempoAtStart']['beatLengthMs'], 500)
        self.assertEqual(context['timingChanges']['points'][0]['beatLengthMs'], 250)
        self.assertEqual(context['siblingDifficulties'][0]['source']['beatmapId'], 102)
        self.assertFalse(context['audio']['availableNow'])
        self.assertFalse(context['audio']['listened'])
        page = corpus.inspect(handle, 1250, 1751, view='actions', limit=1)
        ln_line = self.paths[101].read_text().splitlines().index('64,192,1000,128,0,1750:0:0:0:0:') + 1
        self.assertEqual(page['enteringHolds'], [[ln_line, 0, 'long', 1000, 1750]])
        self.assertEqual(page['pagination']['nextOffset'], 1)
        articulation = corpus.inspect(handle, 1250, 1751, view='articulation')
        self.assertEqual(articulation['enteringHoldArticulation'][0][1:3], [750, 2.0])
        self.assertEqual(corpus.perspective(handle, 1000, 1751)['sourceSha256'], digest(self.paths[101]))
        self.assertTrue(corpus.render(handle, 1000, 1751)['png'].startswith(b'\x89PNG'))
        self.assertEqual(before, {str(p): digest(p) for p in self.dataset.rglob('*') if p.is_file()})

    def test_human_scope_is_exact_and_community_votes_are_difficulty_evidence(self):
        human = self.make_human_bundle()
        out = self.root / 'combined'
        summary = prepare_corpus(self.dataset, [10], human, out)
        self.assertEqual((summary['charts'], summary['examples']), (3, 1))
        corpus = LearningCorpus(out)
        sha = digest(self.paths[101])
        handle = 'chart:' + sha
        context = corpus.context(handle, 1000, 1251)
        self.assertEqual(context['existingHumanJudgments'][0]['humanComment'], 'Confirmed human interpretation.')
        self.assertEqual(corpus.context(handle, 1251, 1751)['existingHumanJudgments'], [])
        community = context['community']
        metadata_sha = digest(self.dataset / '0/10/metadata.json')
        self.assertEqual((community['scope'], community['beatmapId']), ('difficulty', 101))
        self.assertEqual(community['tags'][0]['evidenceId'], f'community:{metadata_sha}:101:113')
        self.assertEqual(community['tags'][0]['count'], 4)
        self.assertFalse(community['sourceByteMatch'])
        self.assertTrue(corpus.context('chart:' + digest(self.paths[102]))['community']['sourceByteMatch'])
        self.assertEqual(corpus.examples[0]['assessment'], {'presence': 'present', 'salience': 'supporting'})
        self.assertEqual(corpus.examples[0]['groupId'], 'mapset:10')
        self.assertNotIn('machine-only', json.dumps(context))
        self.assertNotIn('machine-only', (out / 'examples.json').read_text())
        self.assertNotIn('machine-only', (out / f'charts/{sha}.json').read_text())
        self.assertEqual(corpus.manifest['provenance']['humanBundleManifestSha256'], digest(human / 'manifest.json'))
        self.assertEqual(corpus.manifest['files'][f'sources/{sha}.osu'], sha)
        self.assertEqual(corpus.manifest['provenance']['tagVocabularySha256'],
                         digest(self.dataset / 'metadata/osu_tags_2026-08-07.json'))
        self.assertFalse(any(name.startswith('tools/') for name in corpus.manifest['files']))
        self.assertEqual(corpus.inspect('example:human-confirmed')['sourceSha256'], sha)

    def test_existing_outputs_and_evaluation_exclusions_are_preserved(self):
        out = self.root / 'occupied'
        out.mkdir()
        with self.assertRaisesRegex(FileExistsError, 'fresh learning output'):
            prepare_corpus(self.dataset, [10], None, out)
        human = self.make_human_bundle()
        manifest = read(human / 'manifest.json')
        manifest.update(mode='evaluation', excludedSources=[digest(self.paths[101])], excludedGroups=['mapset:10'])
        save(human / 'manifest.json', manifest)
        with self.assertRaisesRegex(ValueError, 'without evaluation exclusions'):
            prepare_corpus(self.dataset, [10], human, self.root / 'blocked')
        self.assertFalse((self.root / 'blocked').exists())


if __name__ == '__main__':
    unittest.main()
