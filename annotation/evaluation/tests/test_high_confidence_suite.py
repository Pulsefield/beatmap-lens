"""Current human gold selection and freezing, without model execution."""
from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import high_confidence_suite as gold
import regression_gate as gate
import run_regression as runner


def observation(identity='human-1', confidence='high', tag='tech', rate=None):
    result = {'id': identity, 'confidence': confidence, 'observationSha256': 'sha-' + identity,
              'foundationSha256': 'foundation', 'humanId': 'human', 'confirmedAt': '2026-09-11',
              'trust': {'source': 'current', 'foundation': 'current'},
              'claim': {'id': 'claim-' + identity, 'tagId': tag,
                        'assessment': {'presence': 'absent'},
                        'scope': {'startMs': 100, 'endMs': 200},
                        'reviewContext': {'startMs': 0, 'endMs': 300}}}
    if confidence is None:
        result.pop('confidence')
    if rate is not None:
        result['claim']['playbackRate'] = rate
    return result


def feedback(observations=None, revision=2, source='source'):
    return {'sourceSha256': source, 'documentVersion': {'revision': revision, 'sha256': f'document-{revision}'},
            'effectiveHumanObservations': observations if observations is not None else [observation()]}


class HighConfidenceSuiteTest(unittest.TestCase):
    def build(self, values):
        return gold.build_suite(values, 'comparison-fixture')

    def test_only_explicit_current_high_is_gold_and_pins_are_retained(self):
        current = feedback([observation(), observation('low', 'low'), observation('old', None)])
        current['directObservations'] = [observation('superseded')]
        current['agentReviews'] = [{'status': 'accepted', 'decision': {'id': 'historical'}}]
        suite = self.build([current])
        case = suite['cases'][0]
        self.assertTrue(case['critical'])
        self.assertEqual(case['gold'], {'tech': {'presence': 'absent'}})
        self.assertEqual([p['id'] for p in case['humans']['tech']], ['human-1'])
        self.assertEqual(case['humans']['tech'][0]['documentVersion'], current['documentVersion'])
        self.assertEqual(case['humans']['tech'][0]['observationSha256'], 'sha-human-1')

    def test_latest_lowered_or_withdrawn_observation_cannot_resurrect_history(self):
        for observations in ([observation('new', 'low')], []):
            newer = feedback(observations, revision=3)
            newer['directObservations'] = [observation()]
            for ordered in ([feedback(), newer], [newer, feedback()]):
                with self.subTest(observations=observations, ordered=ordered):
                    with self.assertRaisesRegex(ValueError, 'Zero usable'):
                        self.build(ordered)

    def test_duplicate_labels_collapse_by_source_scope_tag_and_normalized_rate(self):
        duplicate = observation('independent', rate=1)
        current = feedback([observation(), duplicate, deepcopy(duplicate), observation('slow', rate=.75),
                            observation('jack', tag='jack-organization')])
        suite = self.build([current, deepcopy(current)])
        self.assertEqual(len(suite['cases']), 2)
        self.assertEqual(sum(len(c['gold']) for c in suite['cases']), 3)
        normal = next(c for c in suite['cases'] if c['playbackRate'] == 1)
        self.assertEqual(len(normal['humans']['tech']), 2)

    def test_conflicting_independent_high_cells_and_document_identities_fail(self):
        conflicting = observation('conflict')
        conflicting['claim']['assessment'] = {'presence': 'present', 'salience': 'prominent'}
        with self.assertRaisesRegex(ValueError, 'Conflicting independent current High'):
            self.build([feedback([observation(), conflicting])])
        different = feedback()
        different['documentVersion']['sha256'] = 'other-sha'
        with self.assertRaisesRegex(ValueError, 'Conflicting current document'):
            self.build([feedback(), different])

    def test_unsupported_or_unbound_high_cannot_be_silently_skipped(self):
        for edit in ('trust', 'unresolved', 'hash', 'tag'):
            current = feedback()
            human = current['effectiveHumanObservations'][0]
            if edit == 'trust':
                human['trust']['foundation'] = 'changed'
            elif edit == 'unresolved':
                human['claim']['assessment'] = {'presence': 'unresolved'}
            elif edit == 'hash':
                human.pop('observationSha256')
            else:
                human['claim']['tagId'] = 'unsupported-custom-tag'
            with self.subTest(edit=edit), self.assertRaisesRegex(ValueError, 'High-confidence observation'):
                self.build([current])

    def test_legacy_static_missing_and_low_corpora_have_no_fallback(self):
        for current in (feedback([]), feedback([observation(confidence=None)]),
                        feedback([observation(confidence='low')])):
            with self.assertRaisesRegex(ValueError, 'Zero usable'):
                self.build([current])
        with self.assertRaisesRegex(ValueError, 'legacy feedback'):
            self.build([{'sourceSha256': 'source', 'directObservations': [observation()]}])
        with self.assertRaisesRegex(ValueError, 'historical static'):
            gold.validate_suite(gate.read(gate.REPO / gate.SUITE))

    def test_freeze_is_immutable_and_current_canonical_change_invalidates_it(self):
        with TemporaryDirectory() as directory, patch.object(gold, 'current_feedback', return_value=[feedback()]):
            out = Path(directory) / 'suite.json'
            gold.freeze('canonical-workspace', out)
            suite = gate.read(out)
            gold.require_current(suite, 'canonical-workspace')
            with self.assertRaises(FileExistsError):
                gold.freeze('canonical-workspace', out)
            with patch.object(gold, 'current_feedback', return_value=[feedback([observation('new')], revision=3)]):
                with self.assertRaisesRegex(ValueError, 'Frozen gold differs'):
                    gold.require_current(suite, 'canonical-workspace')
            with patch.object(gold, 'current_feedback', return_value=[feedback([observation(confidence='low')], revision=3)]):
                with self.assertRaisesRegex(ValueError, 'Zero usable'):
                    gold.require_current(suite, 'canonical-workspace')

    def test_every_generated_cell_is_protected_and_duplicate_weighting_is_rejected(self):
        suite = self.build([feedback()])
        suite['cases'][0]['critical'] = False
        with self.assertRaisesRegex(ValueError, 'Every current high-confidence'):
            gold.validate_suite(suite)
        suite['cases'][0]['critical'] = True
        suite['cases'].append(deepcopy(suite['cases'][0]))
        with self.assertRaisesRegex(ValueError, 'Duplicate scored'):
            gold.validate_suite(suite)

    def test_real_production_preparation_freezes_gold_and_excludes_source_and_song_examples(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        with TemporaryDirectory() as directory:
            root = Path(directory)
            campaign, feedback_dir = root / 'campaign', root / 'feedback'
            sources, feedbacks = [], []
            for number, title in enumerate(('Target song', 'TARGET SONG', 'Unrelated song')):
                source_path = root / f'source-{number}.osu'
                source_path.write_text(f'fixture original source bytes {number}')
                source_sha = gate.sha(source_path)
                metadata = {'sha256': source_sha, 'title': title, 'difficulty': 'fixture',
                            'keyCount': 4, 'beatmapSetId': number + 1}
                sources.append({'source': metadata, 'sourcePath': str(source_path)})
                human = observation(f'human-{number}')
                human['humanComment'] = 'target-secret-rationale' if number < 2 else 'allowed-example-comment'
                current = feedback([human], source=source_sha)
                gate.save(feedback_dir / f'{source_sha}.json', current)
                feedbacks.append(current)
                table = pa.Table.from_pylist([{'source_line': 10, 'column': 0, 'kind': 'tap',
                                               'start_ms': 150, 'end_ms': 150}])
                table = table.replace_schema_metadata({'beatmap_lens': json.dumps({
                    'source': metadata, 'range': {'startMs': 0, 'endMs': 300}, 'timingPoints': []})})
                chart = campaign / 'agent/charts' / f'{source_sha}.parquet'
                chart.parent.mkdir(parents=True, exist_ok=True)
                pq.write_table(table, chart)
            config = {'foundationSha256': 'foundation', 'workerCommonPath': 'common',
                      'models': {'labeler': 'fixture-model'}, 'reasoningEfforts': {'labeler': 'high'},
                      'codexCommand': 'fixture-never-launched'}
            gate.save(campaign / 'controller/config.json', config)
            gate.save(campaign / 'common/foundation.json', {'foundationSha256': 'foundation',
                      'targets': [], 'calibrationExamples': [{'answer': 'target-secret-rationale'}]})
            gate.save(campaign / 'admin/source-map.json', sources)
            target_feedback = deepcopy(feedbacks[0])
            for number in range(1, 6):
                extra = observation(f'target-window-{number}')
                extra['claim']['scope'] = {'startMs': 100 + number, 'endMs': 200 + number}
                target_feedback['effectiveHumanObservations'].append(extra)
            suite = self.build([target_feedback])
            suite_path = root / 'suite.json'
            gate.save(suite_path, suite)
            with patch.object(runner.runtime, 'run_job', side_effect=AssertionError('No model runs')):
                result = runner.prepare(root / 'baseline', campaign, feedback_dir, sys.executable, suite_path)
                runner.prepare(root / 'candidate', campaign, feedback_dir, sys.executable, suite_path)
            self.assertEqual(result['repeats'], 3)
            self.assertEqual(result['status'], 'prepared-not-launched')
            prepared = gate.read(root / 'baseline/regression.json')
            self.assertEqual(gate.read(root / 'baseline/gold-suite.json'), suite)
            self.assertEqual(gate.read(root / 'candidate/gold-suite.json'), suite)
            library = gate.read(root / 'baseline/harness/examples.json')
            self.assertEqual([e['sourceSha256'] for e in library], [sources[2]['source']['sha256']])
            production = runner.runtime.load_module(gate.REPO / 'annotation/pipeline/run-fine-annotation.py')
            for repeat in prepared['repeats']:
                for relative in repeat['jobs']:
                    job = root / 'baseline' / relative
                    cases = gate.read(job / 'cases.json')['cases']
                    self.assertTrue(all(not {'confidence', 'gold', 'human', 'humans'} & c.keys() for c in cases))
                    self.assertEqual((job / 'prompt.txt').read_text(), production.common_prompt(job.parents[1], 'labeler'))
                    self.assertNotIn('calibrationExamples', gate.read(job / 'foundation.json'))
                    self.assertNotIn('target-secret-rationale', (job / 'brief.md').read_text())
                    self.assertEqual(gate.read(job / 'regression-binding.json')['suiteSha256'], gate.digest(suite))
            # Source data needed by any High cell cannot be dropped by selection.
            unavailable = deepcopy(suite)
            unavailable['cases'][0]['sourceSha256'] = 'missing-source'
            gate.save(root / 'missing-suite.json', unavailable)
            with self.assertRaisesRegex(ValueError, 'none may be omitted'):
                runner.prepare(root / 'missing', campaign, feedback_dir, sys.executable, root / 'missing-suite.json')
            # The common evaluator can drive a checkout whose old evaluator has
            # no --suite support, while using that checkout's real production code.
            source_repo = root / 'adopted-checkout'
            for folder in ('annotation', 'harness', '.agents/skills/mania-pattern-judgment'):
                shutil.copytree(gate.REPO / folder, source_repo / folder,
                                ignore=shutil.ignore_patterns('__pycache__', 'tests'))
            (source_repo / 'annotation/evaluation/run_regression.py').write_text(
                'raise RuntimeError("Historical static runner must not be invoked")\n')
            role_path = source_repo / 'annotation/roles/harness-labeler.md'
            role_path.write_text('ADOPTED CHECKOUT ROLE\n' + role_path.read_text())
            runtime_path = source_repo / 'annotation/annotation_runtime.py'
            runtime_path.write_text(runtime_path.read_text() + '\n_original_schema = response_schema\n'
                                   'def response_schema():\n'
                                   '    return {**_original_schema(), "description": "ADOPTED RUNTIME"}\n')
            production_path = source_repo / 'annotation/pipeline/run-fine-annotation.py'
            production_path.write_text(production_path.read_text() +
                '\n_original_prepare = prepare\n'
                'def prepare(root, queue_path, bundle, campaign, python, max_sections=2, max_brief_chars=28000):\n'
                '    return _original_prepare(root, queue_path, bundle, campaign, python, max_sections, max_brief_chars)\n')
            subprocess.run(['git', 'init', '-q', str(source_repo)], check=True)
            subprocess.run(['git', '-C', str(source_repo), 'add', 'annotation/annotation_runtime.py'], check=True)
            subprocess.run(['git', '-C', str(source_repo), '-c', 'user.name=Fixture',
                            '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], check=True)
            runner.prepare(root / 'adopted', campaign, feedback_dir, sys.executable, suite_path,
                           source_repo=source_repo)
            adopted = gate.read(root / 'adopted/regression.json')
            self.assertEqual(adopted['sourceRepo'], str(source_repo.resolve()))
            self.assertEqual(adopted['sources'], gate.source_snapshot(source_repo))
            self.assertEqual(adopted['evaluationAdapter'], prepared['evaluationAdapter'])
            first_job = root / 'adopted' / adopted['repeats'][0]['jobs'][0]
            self.assertIn('ADOPTED CHECKOUT ROLE', (first_job / 'prompt.txt').read_text())
            self.assertEqual(gate.read(first_job / 'response-schema.json')['description'], 'ADOPTED RUNTIME')
            for repeat in adopted['repeats']:
                self.assertEqual(len(repeat['jobs']), 3)
                for relative in repeat['jobs']:
                    self.assertEqual(len(gate.read(root / 'adopted' / relative / 'cases.json')['cases']), 2)
            self.assertEqual(adopted['sources']['files']['labeler']['annotation/annotation_runtime.py'],
                             gate.sha(runtime_path))


if __name__ == '__main__':
    unittest.main()
