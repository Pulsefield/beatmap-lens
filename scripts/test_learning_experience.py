"""Experience revisions retain source facts and human authority without machine label promotion."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from learning_experience import read, recall, remember, resolve_experience


class ExperienceTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir()
        (self.bundle / 'manifest.json').write_text('{"kind":"beatmap-lens-learning-v1"}')
        self.chart = {'source': {'sha256': 'source'}, 'range': {'startMs': 0, 'endMs': 2001},
                      'notes': [{'sourceLine': 20, 'column': 0, 'kind': 'long', 'startMs': 1000, 'endMs': 1800},
                                {'sourceLine': 21, 'column': 2, 'kind': 'normal', 'startMs': 1500, 'endMs': 1500},
                                {'sourceLine': 22, 'column': 3, 'kind': 'normal', 'startMs': 2000, 'endMs': 2000}]}
        self.human = {'id': 'human-confirmed', 'sourceSha256': 'source', 'tagId': 'ln-coordination',
                      'scope': {'startMs': 1000, 'endMs': 2001},
                      'reviewContext': {'startMs': 0, 'endMs': 2001},
                      'assessment': {'presence': 'absent'}, 'humanComment': 'A single anchor under taps.',
                      'agentComment': 'Ignored old explanation.'}
        community = {'scope': 'difficulty', 'beatmapId': 12, 'metadataSha256': 'metadata',
                     'sourceByteMatch': True,
                     'tags': [{'id': 113, 'name': 'style/LN coordination', 'count': 4,
                               'evidenceId': 'community:metadata:12:113'}]}
        self.corpus = SimpleNamespace(bundle=self.bundle, chart=lambda sha: self.chart,
                                      examples=[self.human], manifest={'charts': {'source': {'community': community}}})
        self.memory = self.root / 'memory'
        self.value = {'id': 'anchor-and-taps', 'title': 'One anchor under a moving tap group',
                      'time': 'The later attack occurs while the earlier hold continues.',
                      'action': 'One finger stays occupied as another attacks.',
                      'organization': 'The hold accompanies a tap passage; it does not alone prove coordination.',
                      'instances': [{'sourceSha256': 'source', 'scope': {'startMs': 1400, 'endMs': 1801},
                                     'sourceLines': [20, 21]}],
                      'humanAnchors': ['human-confirmed'],
                      'communityAnchors': [{'sourceSha256': 'source', 'tagId': 113}],
                      'limitations': ['These witnesses explain only the inspected passage.']}

    def test_resolves_complete_entering_hold_and_exact_human_evidence_at_distinct_scopes(self):
        before = deepcopy(self.value)
        result = resolve_experience(self.corpus, self.value)
        self.assertEqual(result['instances'][0]['sourceNotes'][0], self.chart['notes'][0])
        self.assertEqual(result['humanEvidence'][0]['scope'], self.human['scope'])
        self.assertEqual(result['humanEvidence'][0]['assessment'], {'presence': 'absent'})
        self.assertNotIn('agentComment', result['humanEvidence'][0])
        self.assertEqual(result['communityEvidence'][0]['scope'], 'difficulty')
        self.assertEqual(result['communityEvidence'][0]['tag']['id'], 113)
        self.assertEqual(self.value, before)

    def test_unlabeled_natural_chart_can_be_studied_without_any_human_anchor(self):
        self.value.update(humanAnchors=[], communityAnchors=[])
        result = remember(self.corpus, self.memory, self.value, 'study-agent')
        stored = read(result['path'])
        self.assertEqual(stored['status'], 'agent-hypothesis')
        self.assertEqual(stored['humanEvidence'], [])
        self.assertNotIn('assessment', stored)
        self.assertNotIn('labels', stored)

    def test_revision_preserves_original_and_recall_returns_latest_and_history(self):
        first = remember(self.corpus, self.memory, self.value, 'study-agent')
        original = Path(first['path']).read_bytes()
        revised = deepcopy(self.value)
        revised.update(action='The retained finger and moving attacks have distinct roles.',
                       updateReason='Inspected the following group in the original chart.')
        second = remember(self.corpus, self.memory, revised, 'study-agent')
        stored = read(second['path'])
        self.assertEqual(stored['previousSha256'], first['sha256'])
        self.assertEqual(stored['revision'], 2)
        self.assertEqual(Path(first['path']).read_bytes(), original)
        cards = recall(self.memory, text='retained finger')['cards']
        self.assertEqual([(card['id'], card['revision']) for card in cards], [('anchor-and-taps', 2)])
        self.assertEqual(len(recall(self.memory, identity=self.value['id'])['history']), 2)

    def test_machine_predictions_and_audits_cannot_be_used_as_human_anchors_or_targets(self):
        with self.assertRaisesRegex(ValueError, 'predicted section labels'):
            resolve_experience(self.corpus, self.value | {'labels': {'tech': 'prominent'}})
        with self.assertRaises(KeyError):
            resolve_experience(self.corpus, self.value | {'humanAnchors': ['agent-reviewed-claim']})
        self.assertFalse(self.memory.exists())

    def test_context_must_cover_witnesses_and_revisions_explain_the_change(self):
        instance = self.value['instances'][0]
        instance['sourceLines'].append(22)
        with self.assertRaisesRegex(ValueError, 'Witness notes'):
            resolve_experience(self.corpus, self.value)
        instance['reviewContext'] = self.chart['range']
        remember(self.corpus, self.memory, self.value, 'study-agent')
        with self.assertRaisesRegex(ValueError, 'updateReason'):
            remember(self.corpus, self.memory, self.value, 'study-agent')
        self.assertEqual(len(list(self.memory.glob('*.json'))), 1)


if __name__ == '__main__':
    unittest.main()
