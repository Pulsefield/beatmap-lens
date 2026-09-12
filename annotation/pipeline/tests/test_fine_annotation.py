"""Supported continuation boundaries for the fine-section dispatcher."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Event
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('fine', Path(__file__).resolve().parent.parent.joinpath('run-fine-annotation.py'))
fine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fine)


class FineAnnotationTest(unittest.TestCase):
    def test_rate_brief_preserves_source_refs_and_explains_effective_timing(self):
        case = {'caseId': 'slow', 'sectionId': 'slow', 'sourceSha256': 'source',
                'sourceMetadata': {'title': 'Example'}, 'playbackRate': 0.5,
                'scope': {'startMs': 1000, 'endMs': 2000},
                'reviewContext': {'startMs': 900, 'endMs': 2100}, 'boundaryReleases': [],
                'timingPoints': [{'sourceLine': 5, 'fields': ['0', '500', '4', '2', '1', '100', '1', '0']}],
                'notes': [{'source_line': 10, 'column': 0, 'kind': 'long', 'start_ms': 1000, 'end_ms': 1500},
                          {'source_line': 11, 'column': 1, 'kind': 'normal', 'start_ms': 1250, 'end_ms': 1250}]}
        brief = fine.preparer.brief([case])
        self.assertIn('Playback rate: 0.5x', brief)
        self.assertIn('Performance duration: 2000 ms', brief)
        self.assertIn('performance BPM]: [[5,60.0]]', brief)
        self.assertIn('1000 [[10,0,"L",1500]]', brief)
        self.assertIn('[1250,500.0,500.0,[]]', brief)
        self.assertIn('[10,1000.0]', brief)

    def test_golden_brief_keeps_only_human_judgment_and_optional_comment(self):
        record = {'id': 'human-final', 'sourceSha256': 'source', 'tagId': 'ln-coordination',
                  'assessment': {'presence': 'absent'},
                  'scope': {'startMs': 1000, 'endMs': 2000},
                  'reviewContext': {'startMs': 900, 'endMs': 2100},
                  'rationale': 'These short holds read as taps.', 'rationaleOrigin': 'decision.rationale',
                  'sourceEvidence': {'noteRefs': ['AGENT-EVIDENCE']},
                  'provenance': {'handoffId': 'AGENT-HANDOFF'},
                  'agentComment': 'AGENT-COMMENT'}
        for example in (record, fine.public_example(record)):
            with self.subTest(public='humanComment' in example):
                case = {'caseId': 'case', 'existingHumanJudgments': [example]}
                with patch.object(fine.preparer, 'brief', return_value='# Complete source rows'):
                    brief = fine.section_brief([case])
                public = json.loads(brief.splitlines()[-1])['humanJudgments'][0]
                self.assertEqual(public['assessment'], {'presence': 'absent'})
                self.assertEqual(public['humanComment'], record['rationale'])
                self.assertEqual(public['scope'], record['scope'])
                self.assertNotIn('AGENT-', brief)
                self.assertEqual(set(public), {'id', 'sourceSha256', 'tagId', 'assessment',
                                               'scope', 'reviewContext', 'humanComment'})

    def test_dense_cases_are_balanced_without_an_avoidable_tail_worker(self):
        cases = [{'caseId': str(i), 'weight': weight} for i, weight in enumerate([1] * 15 + [6] * 5)]
        with patch.object(fine, 'section_brief', side_effect=lambda group: 'x' * sum(c['weight'] for c in group)):
            groups = fine.pack_cases(cases, 4, 15)
        self.assertEqual(len(groups), 5)
        self.assertEqual(sorted(c['caseId'] for group in groups for c in group), sorted(c['caseId'] for c in cases))
        self.assertTrue(all(len(group) == 4 and sum(c['weight'] for c in group) <= 15 for group in groups))

    def test_dense_singleton_keeps_its_complete_source_brief(self):
        cases = [{'caseId': str(i), 'weight': weight} for i, weight in enumerate([20] + [1] * 8)]
        with patch.object(fine, 'section_brief', side_effect=lambda group: 'x' * sum(c['weight'] for c in group)):
            groups = fine.pack_cases(cases, 4, 15)
        self.assertIn([cases[0]], groups)
        self.assertTrue(all(len(group) <= 4 for group in groups))
        self.assertEqual(sum(map(len, groups)), len(cases))

    def test_preparation_cannot_raise_the_worker_section_limit(self):
        cases = [{'caseId': str(i)} for i in range(5)]
        with TemporaryDirectory() as temporary:
            root = Path(temporary) / 'unprepared'
            with self.assertRaisesRegex(ValueError, '1–4 sections'):
                fine.prepare(root, root, root, root, 'python', max_sections=5)
            with self.assertRaisesRegex(ValueError, '1–4 sections'):
                fine.pack_cases(cases, 5, 28000)
            for role in ('labeler', 'auditor'):
                with self.subTest(role=role), self.assertRaisesRegex(ValueError, '1–4 sections'):
                    fine.prepare_job(root, cases, role, {}, 1)
            self.assertFalse(root.exists())

    def test_runtime_counts_assignments_before_launch_and_preserves_frozen_jobs(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            job = root / 'runs/labeler-001'
            fine.save(job / 'cases.json', {'cases': [{'caseId': str(i)} for i in range(5)]})
            fine.save(job / 'run.json', {'status': 'prepared', 'role': 'labeler', 'caseCount': 1,
                'inputHashes': {'cases.json': fine.sha(job / 'cases.json')}})
            frozen = {p.name: p.read_bytes() for p in job.iterdir()}
            with patch.object(fine.base.subprocess, 'Popen') as launch:
                with self.assertRaisesRegex(ValueError, '1–4 sections'):
                    fine.base.run_job(job, {})
                launch.assert_not_called()
            self.assertEqual({p.name: p.read_bytes() for p in job.iterdir() if p.name != '.worker.lock'}, frozen)
            run = fine.read(job / 'run.json')
            run['status'] = 'completed'
            fine.save(job / 'run.json', run)
            completed = (job / 'run.json').read_bytes()
            self.assertEqual(fine.base.run_job(job, {}), run)
            self.assertEqual(fine.prepare_job(root, [], 'labeler', {}, 1), job)
            self.assertEqual((job / 'run.json').read_bytes(), completed)

    def test_runtime_checks_recorded_count_and_uses_a_fresh_isolated_worker(self):
        with TemporaryDirectory() as temporary:
            job = Path(temporary) / 'job'
            bundle = Path(temporary) / 'harness'
            fine.save(bundle / 'manifest.json', {'mode': 'annotation'})
            fine.save(job / 'cases.json', {'cases': [{'caseId': str(i)} for i in range(4)]})
            (job / 'prompt.txt').write_text('FROZEN PROMPT')
            fine.save(job / 'response-schema.json', {})
            run = {'status': 'prepared', 'role': 'auditor', 'caseCount': 1,
                'requestedModel': 'test-model', 'requestedReasoningEffort': 'medium',
                'harness': {'bundle': str(bundle.resolve()), 'manifestSha256': fine.sha(bundle / 'manifest.json'),
                            'python': '/frozen/python'},
                'inputHashes': {p.name: fine.sha(p) for p in job.iterdir()}}
            fine.save(job / 'run.json', run)
            with self.assertRaisesRegex(ValueError, 'caseCount differs'):
                fine.base.run_job(job, {})
            run['caseCount'] = 4
            fine.save(job / 'run.json', run)
            prompts = []

            def communicate(prompt):
                prompts.append(prompt)
                fine.save(job / 'response.json', {'cases': []})

            process = SimpleNamespace(pid=321, returncode=0, communicate=communicate)
            with patch.object(fine.base.subprocess, 'check_output', return_value='test-codex'), \
                    patch.object(fine.base.subprocess, 'Popen', return_value=process) as launch:
                result = fine.base.run_job(job, {'codexCommand': 'test-codex'})
            command = launch.call_args.args[0]
            self.assertIn('--ignore-user-config', command)
            self.assertIn('--ephemeral', command)
            self.assertNotIn('resume', command)
            self.assertIn('mcp_servers.lens.command="/frozen/python"', command)
            self.assertIn('mcp_servers.lens.required=true', command)
            self.assertIn('mcp_servers.lens.args=' + json.dumps([
                str(bundle.resolve() / 'tools/annotation-harness.py'), '--bundle', str(bundle.resolve()),
                '--trace', str(job.resolve() / 'harness-trace.jsonl')]), command)
            self.assertEqual(prompts, ['FROZEN PROMPT'])
            self.assertEqual(result['status'], 'completed')
            self.assertTrue(result['inputsUnchanged'])

    def test_runtime_refuses_a_second_dispatcher_without_overwriting_the_job(self):
        with TemporaryDirectory() as temporary:
            job = Path(temporary)
            fine.save(job / 'run.json', {'status': 'prepared', 'producerId': 'original'})
            original = (job / 'run.json').read_bytes()
            with (job / '.worker.lock').open('a') as owner, patch.object(fine.base.subprocess, 'Popen') as launch:
                fine.base.fcntl.flock(owner, fine.base.fcntl.LOCK_EX | fine.base.fcntl.LOCK_NB)
                with self.assertRaisesRegex(ValueError, 'already owned by another dispatcher'):
                    fine.base.run_job(job, {})
                launch.assert_not_called()
            self.assertEqual((job / 'run.json').read_bytes(), original)
            self.assertFalse((job / 'events.jsonl').exists())
            self.assertFalse((job / 'response.json').exists())

    def test_recovery_cannot_reclassify_or_harvest_a_job_owned_by_its_launcher(self):
        with TemporaryDirectory() as temporary:
            job = Path(temporary)
            for fields in ({}, {'pid': 321}):
                fine.save(job / 'run.json', {'status': 'running', 'producerId': 'actual-launcher', **fields})
                original = (job / 'run.json').read_bytes()
                with fine.base.worker_lock(job), patch.object(fine.subprocess, 'run') as inspect:
                    with self.assertRaisesRegex(ValueError, 'already owned by another dispatcher'):
                        fine.run_worker(job, {})
                    inspect.assert_not_called()
                self.assertEqual((job / 'run.json').read_bytes(), original)
                self.assertFalse((job / 'response.json').exists())

    def test_single_job_cli_reports_existing_receipts_and_failure_exit_status(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            fine.save(root / 'config.json', {})
            for status, exit_code in (('completed', 0), ('failed', 1)):
                job = root / status
                run = {'status': status, 'producerId': 'existing-' + status, 'caseCount': 4}
                fine.save(job / 'run.json', run)
                frozen = (job / 'run.json').read_bytes()
                result = subprocess.run([sys.executable, fine.base.__file__, '--job', str(job),
                    '--config', str(root / 'config.json')], capture_output=True, text=True)
                self.assertEqual(result.returncode, exit_code, result.stderr)
                self.assertEqual(json.loads(result.stdout), {'job': str(job.resolve()), **run})
                self.assertEqual((job / 'run.json').read_bytes(), frozen)
                self.assertFalse((job / 'events.jsonl').exists())

    def test_compact_audit_evidence_resolves_to_the_exact_sealed_references(self):
        source = {7: {'sourceLine': 7, 'column': 0, 'kind': 'long', 'startMs': 900, 'endMs': 1400},
                  8: {'sourceLine': 8, 'column': 1, 'kind': 'tap', 'startMs': 1200, 'endMs': 1200}}
        handoff = {'handoffId': 'sealed', 'taskSha256': 'binding', 'proposals': [{
            'id': 'claim', 'scope': {'startMs': 1000, 'endMs': 1300},
            'evidence': {'noteRefs': [source[8]], 'contextNoteRefs': [source[7]],
                         'rationale': '- Tapping under an entering hold.\n- The exact release is retained.'}}]}
        view = fine.compact_handoff(handoff)
        evidence = view['proposals'][0]['evidence']
        reconstructed = {**{k: v for k, v in evidence.items() if k not in ('noteLines', 'contextLines')},
                         'noteRefs': [source[line] for line in evidence['noteLines']],
                         'contextNoteRefs': [source[line] for line in evidence['contextLines']]}
        self.assertEqual(reconstructed, handoff['proposals'][0]['evidence'])
        self.assertEqual(view['taskSha256'], handoff['taskSha256'])
        self.assertIn('noteRefs', handoff['proposals'][0]['evidence'])

    def test_controller_failure_does_not_drop_other_completed_batches(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            fine.save(root / 'campaign/controller/config.json', {})
            fine.save(root / 'preparation.json', {'campaign': str(root / 'campaign')})
            jobs = [root / 'runs' / f'labeler-{i:03d}' for i in (1, 2)]
            for job in jobs:
                fine.save(job / 'run.json', {'status': 'completed', 'role': 'labeler', 'inputsUnchanged': True})
            seen = []
            def prepare(_root, job, _campaign):
                seen.append(job.name)
                if job.name == 'labeler-001':
                    raise ValueError('Witness is outside the selected scope.')
                return {'entries': [], 'skippedCells': [{'conflict': True, 'reason': 'human-overlap'}]}
            with patch.object(fine, 'run_worker', side_effect=lambda job, _: fine.read(job / 'run.json')), \
                    patch.object(fine, 'module', return_value=SimpleNamespace(prepare_handoffs=prepare)):
                result = fine.run(root, 2)
            self.assertEqual(set(seen), {'labeler-001', 'labeler-002'})
            self.assertEqual(result['controllerErrors'][0]['job'], 'labeler-001')
            self.assertEqual(result['deliveries'][0]['status'], 'needs-controller')
            self.assertTrue(result['deliveries'][0]['skippedCells'][0]['conflict'])

    def test_usage_limit_stops_dispatch_preserves_active_output_and_allows_resume(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fine.save(root / 'campaign/controller/config.json', {})
            fine.save(root / 'preparation.json', {'campaign': str(root / 'campaign')})
            jobs = [root / 'runs' / f'labeler-{i:03d}' for i in (1, 2, 3)]
            for job in jobs:
                fine.save(job / 'input.json', {'source': job.name})
                fine.save(job / 'run.json', {'status': 'prepared', 'role': 'labeler',
                    'producerId': job.name, 'inputHashes': {'input.json': fine.sha(job / 'input.json')}})
            prepared = (jobs[2] / 'run.json').read_bytes()
            second_started, stop_observed = Event(), Event()
            attempts = []
            message = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 12th, 2026 8:34 PM."

            def worker(job, _config):
                run = fine.read(job / 'run.json')
                if run['status'] != 'prepared':
                    return run
                attempts.append(job.name)
                if job == jobs[0]:
                    self.assertTrue(second_started.wait(5))
                    (job / 'events.jsonl').write_text(json.dumps({'type': 'error', 'message': message}) + '\n'
                        + json.dumps({'type': 'turn.failed', 'error': {'message': message}}) + '\n')
                    run.update(status='failed', inputsUnchanged=True)
                else:
                    if job == jobs[1]:
                        second_started.set()
                        self.assertTrue(stop_observed.wait(5))
                    fine.save(job / 'response.json', {'cases': [job.name]})
                    run.update(status='completed', inputsUnchanged=True)
                fine.save(job / 'run.json', run)
                return run

            original_status = fine.status

            def status(root):
                if (root / 'controller-errors/labeler-001.json').exists():
                    stop_observed.set()
                return original_status(root)

            with patch.object(fine.base, '_run_job', side_effect=worker), \
                    patch.object(fine, 'status', side_effect=status):
                result = fine.run(root, 2, labels_only=True)
                self.assertEqual(set(attempts), {'labeler-001', 'labeler-002'})
                self.assertEqual((jobs[2] / 'run.json').read_bytes(), prepared)
                self.assertFalse((jobs[2] / 'events.jsonl').exists())
                self.assertIn('usage limit', result['controllerErrors'][0]['error'])
                retained = {str(path.relative_to(root)): path.read_bytes()
                            for job in jobs[:2] for path in job.iterdir()}
                result = fine.run(root, 2, labels_only=True)

            self.assertEqual(sorted(attempts), ['labeler-001', 'labeler-002', 'labeler-003'])
            self.assertEqual([r['status'] for r in result['runs']], ['failed', 'completed', 'completed'])
            for name, contents in retained.items():
                self.assertEqual((root / name).read_bytes(), contents)
            for job in jobs:
                self.assertEqual(fine.read(job / 'run.json')['inputHashes']['input.json'], fine.sha(job / 'input.json'))

    def test_ordinary_worker_failure_does_not_stop_prepared_jobs(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fine.save(root / 'campaign/controller/config.json', {})
            fine.save(root / 'preparation.json', {'campaign': str(root / 'campaign')})
            jobs = [root / 'runs' / f'labeler-{i:03d}' for i in (1, 2)]
            for job in jobs:
                fine.save(job / 'run.json', {'status': 'prepared', 'role': 'labeler'})
            seen = []

            def worker(job, _config):
                seen.append(job.name)
                if job == jobs[0]:
                    (job / 'events.jsonl').write_text(json.dumps({
                        'type': 'turn.failed', 'error': {'message': 'MCP startup failed.'}}) + '\n')
                return {'status': 'failed' if job == jobs[0] else 'completed', 'inputsUnchanged': True}

            with patch.object(fine, 'run_worker', side_effect=worker):
                fine.run(root, 1, labels_only=True)
            self.assertEqual(seen, ['labeler-001', 'labeler-002'])

    def test_auditor_usage_limit_stops_remaining_labelers(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            fine.save(root / 'campaign/controller/config.json', {})
            fine.save(root / 'preparation.json', {'campaign': str(root / 'campaign')})
            jobs = [root / 'runs' / f'labeler-{i:03d}' for i in (1, 2)]
            for job in jobs:
                fine.save(job / 'run.json', {'status': 'prepared', 'role': 'labeler'})
                fine.save(job / 'cases.json', {'cases': [{'caseId': job.name}]})
            prepared = (jobs[1] / 'run.json').read_bytes()
            seen = []

            def worker(job, _config):
                seen.append(job.name)
                run = fine.read(job / 'run.json')
                if run['role'] == 'auditor':
                    (job / 'events.jsonl').write_text(json.dumps({'type': 'turn.failed',
                        'error': {'message': "You've hit your usage limit. Try again later."}}) + '\n')
                    run.update(status='failed', inputsUnchanged=True)
                else:
                    run.update(status='completed', inputsUnchanged=True)
                fine.save(job / 'run.json', run)
                return run

            def handoffs(group, job, _campaign):
                fine.save(group / 'handoff.json', {})
                manifest = {'entries': [{'caseId': job.name, 'handoffPath': str(group / 'handoff.json')}],
                            'skippedCells': []}
                fine.save(group / 'packets/manifest.json', manifest)
                return manifest

            def audit_job(root, _cases, role, _config, number, _handoffs):
                job = root / 'runs' / f'{role}-{number:03d}'
                fine.save(job / 'run.json', {'status': 'prepared', 'role': role, 'inputHashes': {}})
                return job

            with patch.object(fine.base, '_run_job', side_effect=worker), \
                    patch.object(fine, 'prepare_job', side_effect=audit_job), \
                    patch.object(fine, 'module', return_value=SimpleNamespace(prepare_handoffs=handoffs)):
                result = fine.run(root, 1)
            self.assertEqual(seen, ['labeler-001', 'auditor-001'])
            self.assertEqual((jobs[1] / 'run.json').read_bytes(), prepared)
            self.assertEqual(result['controllerErrors'][0]['job'], 'auditor-001')
            self.assertIn('usage limit', result['controllerErrors'][0]['error'])

    def worker(self, root, completed):
        fine.save(root / 'input.json', {'source': 'frozen'})
        fine.save(root / 'run.json', {'status': 'running', 'pid': 321, 'producerId': 'actual-producer',
                                     'startedAt': '2026-09-07T00:00:00+00:00',
                                     'inputHashes': {'input.json': fine.sha(root / 'input.json')}})
        events = '{"type":"thread.started","thread_id":"actual-thread"}\n'
        if completed:
            fine.save(root / 'response.json', {'cases': []})
            events += '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":100}}\n'
        (root / 'events.jsonl').write_text(events)

    def test_harvest_finished_worker_retains_actual_producer_and_usage(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.worker(root, True)
            with patch.object(fine.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='')):
                result = fine.run_worker(root, {})
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['producerId'], 'actual-producer')
            self.assertEqual(result['threadIds'], ['actual-thread'])
            self.assertEqual(result['usage']['cached_input_tokens'], 100)
            self.assertEqual(result['responseSha256'], fine.sha(root / 'response.json'))

    def test_launch_interruption_without_pid_is_retained(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.worker(root, False)
            saved = fine.read(root / 'run.json')
            del saved['pid']
            fine.save(root / 'run.json', saved)
            result = fine.run_worker(root, {})
            self.assertEqual(result['status'], 'interrupted')
            self.assertEqual(result['producerId'], 'actual-producer')
            self.assertTrue((root / 'events.jsonl').exists())

    def test_dead_incomplete_worker_stays_visible_without_fabricated_completion(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.worker(root, False)
            with patch.object(fine.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='')):
                result = fine.run_worker(root, {})
            self.assertEqual(result['status'], 'interrupted')
            self.assertEqual(result['producerId'], 'actual-producer')
            self.assertNotIn('responseSha256', result)
            self.assertTrue((root / 'events.jsonl').exists())


if __name__ == '__main__':
    unittest.main()
