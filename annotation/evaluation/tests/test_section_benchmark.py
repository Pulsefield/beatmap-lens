"""Scoring regressions for partially labeled section benchmark responses."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


spec = importlib.util.spec_from_file_location(
    'section_benchmark', Path(__file__).resolve().parent.parent.joinpath('run-section-benchmark.py'))
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def judgment(tag, presence='absent', salience=None):
    return {'tagId': tag, 'presence': presence, 'salience': salience,
            'rationale': ['The repeated chord attacks keep a regular pulse.',
                          'The neighboring handoff follows that same pulse.'],
            'noteLines': [102], 'contextLines': [101, 104]}


def section(case_id):
    return {'caseId': case_id, 'scope': {'startMs': 1000, 'endMs': 1400},
            'reviewContext': {'startMs': 800, 'endMs': 1600},
            'notes': [
                {'source_line': 101, 'kind': 'long', 'start_ms': 700, 'end_ms': 1200},
                {'source_line': 102, 'kind': 'normal', 'start_ms': 1000, 'end_ms': 1000},
                {'source_line': 103, 'kind': 'long', 'start_ms': 850, 'end_ms': 1000},
                {'source_line': 104, 'kind': 'normal', 'start_ms': 1400, 'end_ms': 1400},
                {'source_line': 105, 'kind': 'long', 'start_ms': 1350, 'end_ms': 1800},
                {'source_line': 106, 'kind': 'normal', 'start_ms': 1600, 'end_ms': 1600},
            ]}


class SectionBenchmarkTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.job = Path(self.temp.name) / 'new-skill'
        self.job.mkdir()
        self.cases = [section('case-01'), section('case-02')]
        self.response = [{'caseId': c['caseId'],
                          'judgments': [judgment(tag) for tag in benchmark.TAGS]}
                         for c in self.cases]
        self.gold = {'case-01:tech': {'presence': 'absent'},
                     'case-02:ln-coordination': {'presence': 'present', 'salience': 'supporting'}}
        self.response[1]['judgments'][-1].update(presence='present', salience='supporting')
        self.run = {'status': 'completed', 'elapsedSeconds': 120,
                    'usage': {'input_tokens': 100000, 'cached_input_tokens': 60000,
                              'cache_write_input_tokens': 10000, 'output_tokens': 10000}}

    def metrics(self):
        for name, value in [('run.json', self.run), ('cases.json', {'cases': self.cases}),
                            ('response.json', {'cases': self.response})]:
            (self.job / name).write_text(json.dumps(value))
        return benchmark.metrics(self.job, self.gold)

    def test_direct_job_omits_inherited_calibration_from_worker_foundation(self):
        foundation = {'foundationSha256': 'canonical-foundation', 'targets': [{'id': 'tech'}],
                      'calibrationExamples': [{'claim': {'evidence': {'rationale': 'Old agent rationale.'}}}]}
        before = deepcopy(foundation)
        job = Path(self.temp.name) / 'prepared'
        config = {'models': {'labeler': 'fixture-model'}, 'reasoningEfforts': {'labeler': 'medium'}}
        benchmark.prepare_job(job, self.cases, {}, foundation, config)
        self.assertEqual(benchmark.read(job / 'foundation.json'),
                         {'foundationSha256': 'canonical-foundation', 'targets': [{'id': 'tech'}]})
        self.assertEqual(foundation, before)
        run = benchmark.read(job / 'run.json')
        self.assertEqual(run['inputHashes']['foundation.json'], benchmark.sha(job / 'foundation.json'))

    def test_oversized_legacy_design_fails_before_creating_worker_or_bundle_files(self):
        cases = [section(str(i)) for i in range(5)]
        root = Path(self.temp.name)
        with self.assertRaisesRegex(ValueError, '1–4 sections'):
            benchmark.prepare_job(root / 'oversized-job', cases, {}, {}, {})
        self.assertFalse((root / 'oversized-job').exists())
        prepare_spec = importlib.util.spec_from_file_location(
            'harness_benchmark', Path(__file__).resolve().parent.parent / 'prepare-harness-benchmark.py')
        prepare = importlib.util.module_from_spec(prepare_spec)
        prepare_spec.loader.exec_module(prepare)
        design = root / 'oversized-design.json'
        design.write_text(json.dumps({'cases': cases}))
        with self.assertRaisesRegex(ValueError, '1–4 sections'):
            prepare.prepare(design, root / 'oversized-bundle', root / 'campaign', 'python')
        self.assertFalse((root / 'oversized-bundle').exists())

    def test_only_known_labels_count_and_average_cost_uses_cache_breakdown(self):
        self.response[0]['judgments'][0].update(presence='present', salience='prominent')
        self.gold['another-job:tech'] = {'presence': 'absent'}
        result = self.metrics()
        self.assertEqual(result['mechanicalErrors'], [])
        self.assertEqual((result['goldCount'], result['exactMatches'], result['presenceMatches']), (2, 2, 2))
        self.assertEqual(result['unscoredJudgments'], 8)
        self.assertEqual(result['secondsPerSection'], 60)
        # 30K uncached + 60K cache reads + 10K writes + 10K output.
        self.assertAlmostEqual(result['apiEquivalentUsd'], .985)
        self.assertIn('not actual Codex subscription billing', result['pricing']['basis'])

    def test_missing_gold_prediction_stays_in_denominator(self):
        self.response[1]['judgments'].pop()
        result = self.metrics()
        self.assertEqual((result['goldCount'], result['exactMatches']), (2, 1))
        missing = next(s for s in result['scored'] if s['caseId'] == 'case-02')
        self.assertTrue(missing['missingPrediction'])
        self.assertIsNone(missing['predicted'])
        self.assertIn('case-02: target coverage differs', result['mechanicalErrors'])

    def test_duplicate_target_is_one_failed_gold_prediction(self):
        self.response[1]['judgments'].append(deepcopy(self.response[1]['judgments'][-1]))
        result = self.metrics()
        self.assertEqual((result['goldCount'], result['exactMatches'], result['presenceMatches']), (2, 1, 1))
        duplicate = next(s for s in result['scored'] if s['caseId'] == 'case-02')
        self.assertTrue(duplicate['duplicatePrediction'])
        self.assertIn('case-02: target coverage differs', result['mechanicalErrors'])

    def test_missing_or_duplicate_case_never_improves_accuracy_denominator(self):
        for response in [[self.response[0]], self.response + [deepcopy(self.response[0])]]:
            with self.subTest(count=len(response)):
                self.response = response
                result = self.metrics()
                self.assertEqual((result['goldCount'], result['exactMatches']), (2, 1))
                self.assertIn('Output case identities/counts differ.', result['mechanicalErrors'])

    def test_presence_and_style_strength_are_scored_separately(self):
        ln = self.response[1]['judgments'][-1]
        for presence, salience, exact, presence_matches in [
                ('present', 'supporting', 2, 2), ('present', 'prominent', 1, 2),
                ('absent', None, 1, 1), ('unresolved', None, 1, 1)]:
            with self.subTest(presence=presence, salience=salience):
                ln.update(presence=presence, salience=salience)
                result = self.metrics()
                self.assertEqual((result['exactMatches'], result['presenceMatches']), (exact, presence_matches))

    def test_entering_holds_and_complete_ln_ends_use_half_open_scope(self):
        target = self.response[1]['judgments'][-1]
        target.update(noteLines=[101, 102, 105], contextLines=[101, 103, 104, 105])
        self.assertEqual(self.metrics()['mechanicalErrors'], [])
        for line in [103, 104]:
            with self.subTest(witness=line):
                target['noteLines'] = [line]
                self.assertIn('case-02:ln-coordination: out-of-scope note', self.metrics()['mechanicalErrors'])
        target.update(noteLines=[102], contextLines=[106])
        self.assertIn('case-02:ln-coordination: out-of-scope note', self.metrics()['mechanicalErrors'])

    def test_positive_requires_known_witness_and_compatible_salience(self):
        target = self.response[1]['judgments'][-1]
        target['noteLines'] = [999]
        self.assertIn('case-02:ln-coordination: unknown note', self.metrics()['mechanicalErrors'])
        target['noteLines'] = []
        self.assertIn('case-02:ln-coordination: positive without witnesses', self.metrics()['mechanicalErrors'])
        target.update(noteLines=[102], salience=None)
        self.assertIn('case-02:ln-coordination: salience shape', self.metrics()['mechanicalErrors'])
        target.update(presence='absent', salience='supporting')
        self.assertIn('case-02:ln-coordination: salience shape', self.metrics()['mechanicalErrors'])

    def test_brief_rationales_allow_two_to_four_bullets_and_eighty_words(self):
        target = self.response[1]['judgments'][-1]
        for count in [2, 4]:
            with self.subTest(bullets=count):
                target['rationale'] = ['A regular chord pulse continues.'] * count
                self.assertEqual(self.metrics()['mechanicalErrors'], [])
        target['rationale'] = [' '.join(['pulse'] * 40)] * 2
        self.assertEqual(self.metrics()['mechanicalErrors'], [])
        target['rationale'][0] += ' continues'
        self.assertIn('case-02:ln-coordination: exceeds 80 words', self.metrics()['mechanicalErrors'])
        for count in [1, 5]:
            with self.subTest(bullets=count):
                target['rationale'] = ['A regular chord pulse continues.'] * count
                self.assertIn('case-02:ln-coordination: bullet count', self.metrics()['mechanicalErrors'])


if __name__ == '__main__':
    unittest.main()
