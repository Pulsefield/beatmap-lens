import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import regression_gate as gate


def fixture():
    suite = {'cases': [
        {'caseId': 'protected', 'critical': True, 'gold': {'tech': {'presence': 'absent'}}},
        {'caseId': 'broad', 'critical': False,
         'gold': {'trill-organization': {'presence': 'present', 'salience': 'supporting'}}},
    ]}
    baseline = {'files': {role: {} for role in gate.SOURCES}, 'suiteSha256': gate.digest(suite)}
    candidate = copy.deepcopy(baseline)
    candidate['files']['labeler'] = {'annotation/roles/harness-labeler.md': 'new'}
    result = {'kind': 'annotation-regression-evidence-v1', 'baseline': baseline, 'candidate': candidate,
              'suiteSha256': gate.digest(suite), 'runs': {}}
    for side, source in [('baseline', baseline), ('candidate', candidate)]:
        result['runs'][side] = [
            {'status': 'completed', 'mechanicalErrors': [], 'sourceSha256': gate.digest(source),
             'producerIds': [f'{side}-{i}'], 'responseSha256': f'response-{side}-{i}',
             'casesSha256': 'same-source-notes', 'model': 'test-model', 'reasoningEffort': 'high',
             'evaluationDataSha256': 'same-foundation-and-example-inputs',
             'cells': [{'caseId': c['caseId'], 'tagId': tag, 'predicted': copy.deepcopy(gold)}
                       for c in suite['cases'] for tag, gold in c['gold'].items()]}
            for i in range(gate.REPEATS)]
    result['review'] = {'reviewer': 'test reviewer', 'rationaleReview': 'Witnesses and scoped reasoning reviewed.',
                        'regressions': {}}
    bind_review(result)
    return suite, baseline, candidate, result


def bind_review(evidence):
    evidence['review']['comparisonSha256'] = gate.digest({k: evidence[k] for k in
                                                        ('baseline', 'candidate', 'suiteSha256', 'runs')})


class RegressionGateTests(unittest.TestCase):
    def setUp(self):
        self.suite, self.baseline, self.candidate, self.evidence = fixture()

    def compare(self, rebind=True):
        if rebind:
            bind_review(self.evidence)
        return gate.compare(self.evidence, self.suite, self.baseline, self.candidate)

    def test_complete_reviewed_comparison_passes(self):
        self.assertTrue(self.compare()['passed'])

    def test_any_protected_error_blocks_even_with_review(self):
        self.evidence['runs']['candidate'][1]['cells'][0]['predicted'] = {'presence': 'present', 'salience': 'supporting'}
        self.evidence['review']['regressions']['protected:tech'] = {'decision': 'accept', 'reason': 'Not an allowed override.'}
        result = self.compare()
        self.assertFalse(result['passed'])
        self.assertTrue(any('protected case failed' in e for e in result['errors']))

    def test_broader_paired_loss_requires_explicit_review_even_when_aggregate_ties(self):
        self.evidence['runs']['baseline'][0]['cells'][1]['predicted'] = {'presence': 'absent'}
        self.evidence['runs']['candidate'][1]['cells'][1]['predicted'] = {'presence': 'absent'}
        self.assertFalse(self.compare()['passed'])
        self.evidence['review']['regressions']['broad:trill-organization'] = {
            'decision': 'accept', 'reason': 'Reviewed repeat 2 against repeat 1: same overall count, localized uncertainty.'}
        self.assertTrue(self.compare()['passed'])

    def test_missing_or_reused_repeats_fail(self):
        self.evidence['runs']['candidate'].pop()
        self.assertFalse(self.compare()['passed'])
        self.evidence['runs']['candidate'].append(copy.deepcopy(self.evidence['runs']['candidate'][0]))
        self.assertFalse(self.compare()['passed'])

    def test_incomplete_missing_and_duplicate_predictions_fail(self):
        for change in ('incomplete', 'missing', 'duplicate', 'invalid'):
            with self.subTest(change=change):
                self.setUp()
                run = self.evidence['runs']['candidate'][0]
                if change == 'incomplete':
                    run['status'] = 'failed'
                elif change == 'missing':
                    run['cells'].pop()
                elif change == 'duplicate':
                    run['cells'].append(copy.deepcopy(run['cells'][1]))
                else:
                    run['cells'][1]['predicted'] = None
                self.assertFalse(self.compare()['passed'])

    def test_mechanical_errors_cannot_be_reviewed_away(self):
        self.evidence['runs']['candidate'][0]['mechanicalErrors'] = ['positive without witnesses']
        self.assertFalse(self.compare()['passed'])

    def test_stale_sources_or_corpus_cannot_pass(self):
        self.candidate = copy.deepcopy(self.candidate)
        self.candidate['files']['labeler']['added-guide'] = 'new'
        self.assertFalse(self.compare()['passed'])
        self.setUp()
        self.evidence['suiteSha256'] = 'old-suite'
        self.assertFalse(self.compare()['passed'])

    def test_repeat_source_binding_and_source_notes_are_checked(self):
        self.evidence['runs']['candidate'][0]['sourceSha256'] = 'old-source'
        self.assertFalse(self.compare()['passed'])
        self.setUp()
        self.evidence['runs']['candidate'][0]['casesSha256'] = 'different-notes'
        self.assertFalse(self.compare()['passed'])

    def test_same_model_and_effort_required(self):
        self.evidence['runs']['candidate'][0]['model'] = 'different-model'
        self.assertFalse(self.compare()['passed'])

    def test_different_foundation_or_example_pool_inputs_fail(self):
        self.evidence['runs']['candidate'][0]['evaluationDataSha256'] = 'different-foundation-or-feedback'
        self.assertFalse(self.compare()['passed'])

    def test_reasoning_review_and_exact_comparison_binding_required(self):
        self.evidence['review']['rationaleReview'] = ''
        self.assertFalse(self.compare()['passed'])
        self.setUp()
        self.evidence['runs']['candidate'][0]['responseSha256'] = 'different-output'
        self.assertFalse(self.compare(rebind=False)['passed'])

    def repository(self, directory):
        repo = Path(directory)
        gate.save(repo / gate.SUITE, self.suite)
        role = repo / 'annotation/roles/harness-labeler.md'
        role.parent.mkdir(parents=True, exist_ok=True)
        role.write_text('Original role.\n')
        gate.save(repo / gate.BASELINE, {'snapshot': gate.source_snapshot(repo)})
        return repo, role

    def test_unchanged_sources_need_no_private_artifacts_but_role_edit_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            repo, role = self.repository(directory)
            self.assertTrue(gate.check(repo)['passed'])
            role.write_text('Changed judgment instructions.\n')
            self.assertFalse(gate.check(repo)['passed'])

    def test_direct_auditor_change_is_explicitly_uncovered(self):
        with tempfile.TemporaryDirectory() as directory:
            repo, role = self.repository(directory)
            role.with_name('harness-auditor.md').write_text('New audit instructions.\n')
            result = gate.check(repo)
            self.assertFalse(result['passed'])
            self.assertIn('auditor', result['errors'][0])

    def test_root_python_environment_files_are_bound_and_changes_need_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            repo, _ = self.repository(directory)
            for name in ('pyproject.toml', 'uv.lock', '.python-version'):
                (repo / name).write_text('Original environment.\n')
            baseline = gate.source_snapshot(repo)
            gate.save(repo / gate.BASELINE, {'snapshot': baseline})
            self.assertTrue(gate.check(repo)['passed'])
            for name in ('pyproject.toml', 'uv.lock', '.python-version'):
                with self.subTest(name=name):
                    self.assertIn(name, baseline['files']['labeler'])
                    (repo / name).write_text('Changed environment.\n')
                    self.assertEqual(gate.check(repo)['changedCoverage'], ['labeler'])
                    self.assertFalse(gate.check(repo)['passed'])
                    (repo / name).write_text('Original environment.\n')

    def test_ci_base_ref_prevents_replacing_baseline_to_hide_changed_role(self):
        with tempfile.TemporaryDirectory() as directory:
            repo, role = self.repository(directory)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=repo, stderr=subprocess.DEVNULL)
            git('init', '-q')
            git('add', '.')
            git('-c', 'user.name=Regression Test', '-c', 'user.email=test@example.invalid',
                'commit', '-qm', 'baseline')
            role.write_text('Changed judgment instructions.\n')
            gate.save(repo / gate.BASELINE, {'snapshot': gate.source_snapshot(repo)})
            self.assertFalse(gate.check(repo, base_ref='HEAD')['passed'])
            with self.assertRaises(subprocess.CalledProcessError):
                gate.check(repo, base_ref='missing-ci-base')

    def test_real_corpus_has_all_dimensions_and_human_anchors(self):
        suite = gate.read(gate.REPO / gate.SUITE)
        self.assertEqual({tag for c in suite['cases'] for tag in c['gold']},
                         {'tech', 'jack-organization', 'stream-organization', 'trill-organization', 'ln-coordination'})
        for case in suite['cases']:
            self.assertTrue(case['human']['decisionId'])
            self.assertTrue(case['human']['feedbackSha256'])
        moon = next(c for c in suite['cases'] if c['caseId'] == 'case-04')
        self.assertTrue(moon['critical'])
        self.assertTrue(any(r['run'].endswith('/old-skill') for r in moon['previouslyCorrect']))

    def completed_capture(self, directory):
        root = Path(directory)
        suite = copy.deepcopy(self.suite)
        source_cases = []
        for case in suite['cases']:
            case.update(sourceSha256='source-sha', scope={'startMs': 0, 'endMs': 100},
                        reviewContext={'startMs': 0, 'endMs': 200})
            source_cases.append({**{k: case[k] for k in ('caseId', 'sourceSha256', 'scope', 'reviewContext')},
                                 'notes': [{'source_line': 10, 'column': 0, 'kind': 'tap',
                                            'start_ms': 50, 'end_ms': 50}]})
        gate.save(root / 'harness/manifest.json', {'mode': 'evaluation'})
        sources = {'files': {}, 'suiteSha256': gate.digest(suite)}
        binding = {'sourceSha256': gate.digest(sources),
                   'harnessManifestSha256': gate.sha(root / 'harness/manifest.json'),
                   'evaluationDataSha256': 'fixture-data',
                   'foundationSha256': gate.hashlib.sha256(b'{}').hexdigest()}
        job = root / 'repeats/01/runs/labeler-001'
        gate.save(job / 'cases.json', {'cases': source_cases})
        gate.save(job / 'regression-binding.json', binding)
        for name in ('prompt.txt', 'ROLE.md', 'foundation.json'):
            (job / name).write_text('{}')
        tags = ('jack-organization', 'stream-organization', 'trill-organization', 'tech', 'ln-coordination')
        response = {'cases': [{'caseId': c['caseId'], 'judgments': [
            {'tagId': tag, 'presence': 'present' if tag == 'trill-organization' else 'absent',
             'salience': 'supporting' if tag == 'trill-organization' else None,
             'rationale': ['First test witness.', 'Second test context.'], 'noteLines': [10], 'contextLines': []}
            for tag in tags]} for c in source_cases]}
        hashes = {str(p.relative_to(job)): gate.sha(p) for p in job.iterdir()}
        gate.save(job / 'response.json', response)
        gate.save(job / 'run.json', {'status': 'completed', 'exitCode': 0, 'inputHashes': hashes,
                                    'responseSha256': gate.sha(job / 'response.json'), 'producerId': 'capture-fixture',
                                    'requestedModel': 'test', 'requestedReasoningEffort': 'high',
                                    'usage': {}, 'elapsedSeconds': 1})
        gate.save(root / 'regression.json', {'suiteSha256': gate.digest(suite), 'sources': sources,
                                            'binding': binding, 'harnessFiles': {},
                                            'repeats': [{'jobs': [str(job.relative_to(root))]}]})
        return root, job, suite

    def test_capture_scores_actual_response_and_rejects_changed_frozen_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root, job, suite = self.completed_capture(directory)
            _, receipts = gate.capture(root, suite)
            self.assertEqual(receipts[0]['mechanicalErrors'], [])
            self.assertEqual(len(receipts[0]['cells']), 2)
            (job / 'prompt.txt').write_text('Changed prompt.')
            with self.assertRaisesRegex(ValueError, 'Frozen worker inputs changed'):
                gate.capture(root, suite)

    def test_capture_rejects_relabeling_old_outputs_as_new_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root, job, suite = self.completed_capture(directory)
            preparation = gate.read(root / 'regression.json')
            preparation['sources']['files']['new-guide'] = 'new-hash'
            gate.save(root / 'regression.json', preparation)
            with self.assertRaisesRegex(ValueError, 'source identity differs'):
                gate.capture(root, suite)


if __name__ == '__main__':
    unittest.main()
