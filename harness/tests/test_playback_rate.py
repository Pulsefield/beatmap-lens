"""Playback changes performance evidence without changing source or human identity."""
from copy import deepcopy
import asyncio
import json
import sys
import unittest

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from harness_inspection import chart_context, inspect, perspective
from harness_render import _layout, render_section
import harness_examples as examples
from playback_rate import normalize_playback_rate, playback_rate_fields, same_playback_rate, SUPPORTED_PLAYBACK_RATES
from test_harness_examples import claim, feedback, review
from test_harness_inspection import chart, note
import test_annotation_harness as harness_tests

harness, prepare = harness_tests.harness, harness_tests.prepare


class PlaybackRateTest(unittest.TestCase):
    def test_supported_rates_and_historical_omission(self):
        self.assertEqual(normalize_playback_rate(), 1)
        self.assertEqual(playback_rate_fields({}), {})
        self.assertEqual(playback_rate_fields({'playbackRate': 1}), {'playbackRate': 1})
        self.assertTrue(same_playback_rate({}, {'playbackRate': 1}))
        self.assertFalse(same_playback_rate({}, {'playbackRate': 0.5}))
        for rate in SUPPORTED_PLAYBACK_RATES:
            self.assertEqual(normalize_playback_rate(rate), rate)
        for rate in (True, False, 0, 2, '1', float('nan')):
            with self.assertRaisesRegex(ValueError, 'playbackRate'):
                normalize_playback_rate(rate)

    def test_inspection_preserves_every_source_fact_and_scales_full_hold_spans(self):
        source = chart([note(10, 800, 0, 2000), note(11, 1000, 1, 1500),
                        note(12, 1250, 2), note(13, 1500, 3)])
        original = deepcopy(source)
        for view in ('rows', 'actions', 'articulation'):
            baseline = inspect(source, 1000, 1600, view, offset=1, limit=1)
            for rate in (0.5, 0.75, 1.25, 1.5):
                with self.subTest(view=view, rate=rate):
                    result = inspect(source, 1000, 1600, view, offset=1, limit=1, playback_rate=rate)
                    performance = result.pop('performanceTiming')
                    self.assertEqual(result.pop('playbackRate'), rate)
                    self.assertEqual(result, baseline)
                    self.assertEqual(performance['durationMs'], 600 / rate)
                    self.assertEqual(performance['rows'][0], [1250, 250 / rate, 250 / rate])
                    self.assertIn([10, -200 / rate, 1000 / rate, 1200 / rate], performance['notes'])
                    self.assertIn([11, 0, 500 / rate, 500 / rate], performance['notes'])
        self.assertEqual(source, original)
        self.assertEqual(inspect(source, 1000, 1600), inspect(source, 1000, 1600, playback_rate=1))

    def test_tempo_and_pulse_scale_while_beats_and_sv_remain_source_facts(self):
        source = chart([note(10, 1000, 0), note(11, 1250, 1), note(12, 1750, 2)], timing=[
            {'sourceLine': 1, 'fields': ['0', '500', '4', '2', '0', '100', '1', '0']},
            {'sourceLine': 2, 'fields': ['1200', '-50', '4', '2', '0', '100', '0', '0']},
            {'sourceLine': 3, 'fields': ['1500', '250', '4', '2', '0', '100', '1', '0']},
        ])
        context = chart_context(source, 1000, 1800, playback_rate=1.5)
        self.assertEqual(context['activeTempoAtStart']['bpm'], 120)
        self.assertEqual(context['performanceTiming']['activeTempoAtStart']['bpm'], 180)
        self.assertEqual(context['performanceTiming']['timingChanges'][0]['rawSvMultiplier'], 2)
        self.assertEqual(context['performanceTiming']['timingChanges'][1]['bpm'], 360)
        observed = perspective(source, 1000, 1800, playback_rate=0.5)
        self.assertEqual(observed['pulse']['commonGapsMsAndCounts'], [(250, 1), (500, 1)])
        self.assertEqual(observed['performanceTiming']['commonGapsMsAndCounts'], [(500, 1), (1000, 1)])
        self.assertEqual(observed['performanceTiming']['pulseExamples'][0]['beatDistances'],
                         observed['pulse']['examples'][0]['beatDistances'])

    def test_rate_changes_time_page_span_and_preserves_source_boundaries(self):
        source = chart([note(10, 1000, 0, 5000), note(11, 2250, 1), note(12, 4750, 2)])
        slow = _layout(source, 1000, 5000, 'time', 0, 0.5)
        fast = _layout(source, 1000, 5000, 'time', 0, 1.5)
        self.assertEqual((slow['start'], slow['end'], slow['pageCount']), (1000, 2250, 4))
        self.assertEqual((fast['start'], fast['end'], fast['pageCount']), (1000, 4750, 2))
        self.assertAlmostEqual((slow['y'](1500) - slow['y'](1000)) /
                               (fast['y'](1500) - fast['y'](1000)), 3)
        rendered = render_section(source, 1000, 5000, playback_rate=0.5)
        self.assertEqual(rendered['range'], {'startMs': 1000, 'endMs': 2250})
        self.assertEqual(rendered['performanceTiming']['pageElapsedRangeMs'], {'startMs': 0, 'endMs': 2500})
        self.assertEqual(rendered['events']['attacks'], 1)
        self.assertEqual(rendered['events']['continuingHolds'], 1)

    def test_human_examples_preserve_rate_through_extraction_projection_and_search(self):
        data = feedback()
        first, slow = claim('normal'), claim('slow')
        slow['playbackRate'] = 0.5
        data['agentReviews'] = [review(first, identity='first'), review(slow, identity='slow')]
        records = examples.extract_examples([data], {})
        normal = examples.search_examples(records, playback_rate=1)['cards']
        slower = examples.search_examples(records, playback_rate=0.5)['cards']
        self.assertEqual(len(normal), 1)
        self.assertNotIn('playbackRate', normal[0])
        self.assertEqual(len(slower), 1)
        self.assertEqual(slower[0]['playbackRate'], 0.5)
        self.assertEqual(examples.get_example(records, slower[0]['id'])['playbackRate'], 0.5)
        self.assertEqual(examples.search_examples(records, playback_rate=1.5)['total'], 0)


class PlaybackRateHarnessTest(unittest.TestCase):
    setUp = harness_tests.HarnessTest.setUp

    def test_frozen_target_rate_controls_all_tools_and_does_not_transfer_human_gold(self):
        case = prepare.read(self.sections)['cases'][0]
        case['playbackRate'] = 0.5
        prepare.save(self.sections, {'cases': [case]})
        bundle = self.root / 'slow-bundle'
        prepare.prepare(self.campaign, self.sections, self.feedback_dir, bundle, 'annotation',
                        contrast_sets_path=self.contrast_sets)
        agent = harness.Harness(bundle)
        self.assertEqual(agent.manifest['sections'][0]['playbackRate'], 0.5)
        self.assertIn('tools/playback_rate.py', agent.manifest['files'])
        self.assertEqual(agent.context('case-0')['existingHumanJudgments'], [])
        self.assertEqual(agent.context('case-0')['performanceTiming']['activeTempoAtStart']['bpm'], 60)
        self.assertEqual(agent.rows('case-0')['performanceTiming']['rows'][1], [1250, 500, None])
        self.assertEqual(agent.perspective('case-0')['performanceTiming']['commonGapsMsAndCounts'], [(500, 1)])
        self.assertEqual(agent.render('case-0')['playbackRate'], 0.5)
        query = agent.query('case-0', 'ln-events')
        self.assertEqual(query['matches'][0]['bounds'], {'startMs': 1000, 'endMs': 1001})
        self.assertEqual(query['performanceTiming']['matches'][0]['elapsedBoundsMs'], {'startMs': 0, 'endMs': 2})
        human, = agent.context('example:' + self.example_ids[self.source_ids[0]])['existingHumanJudgments']
        self.assertNotIn('playbackRate', human)
        self.assertNotIn('performanceTiming', agent.rows('example:' + human['id']))
        self.assertEqual(agent.search(playback_rate=0.5)['total'], 0)
        manifest = prepare.read(bundle / 'manifest.json')
        manifest['sections'][0]['playbackRate'] = 1.5
        prepare.save(bundle / 'manifest.json', manifest)
        with self.assertRaisesRegex(ValueError, 'section targets changed'):
            harness.Harness(bundle)

    def test_invalid_target_rate_is_rejected_before_bundle_creation(self):
        case = prepare.read(self.sections)['cases'][0]
        case['playbackRate'] = 0.9
        prepare.save(self.sections, {'cases': [case]})
        bundle = self.root / 'invalid-rate'
        with self.assertRaisesRegex(ValueError, 'playbackRate'):
            prepare.prepare(self.campaign, self.sections, self.feedback_dir, bundle,
                            contrast_sets_path=self.contrast_sets)
        self.assertFalse(bundle.exists())

    def test_frozen_mcp_uses_example_rate_and_exposes_rate_search(self):
        path = self.feedback_dir / (self.source_ids[0] + '.json')
        data = prepare.read(path)
        data['agentReviews'][0]['summary']['playbackRate'] = 1.25
        prepare.save(path, data)
        bundle = self.root / 'rated-mcp'
        prepare.prepare(self.campaign, self.sections, self.feedback_dir, bundle, 'annotation',
                        contrast_sets_path=self.contrast_sets)

        async def run():
            params = StdioServerParameters(command=sys.executable, args=[
                str(bundle / 'tools/annotation-harness.py'), '--bundle', str(bundle)])
            async with stdio_client(params) as (reader, writer):
                async with ClientSession(reader, writer) as client:
                    await client.initialize()
                    response = await client.call_tool('find_human_examples', {'playback_rate': 1.25})
                    self.assertFalse(response.isError)
                    card, = json.loads(response.content[0].text)['cards']
                    self.assertEqual(card['playbackRate'], 1.25)
                    response = await client.call_tool('inspect_section', {'section_id': card['sectionId'],
                                                                         'view': 'articulation'})
                    self.assertFalse(response.isError)
                    result = json.loads(response.content[0].text)
                    self.assertEqual(result['playbackRate'], 1.25)
                    self.assertEqual(result['rows'][0][1], [[12, 0, 'long', 1000, 1500]])
                    self.assertEqual(result['performanceTiming']['notes'][0], [12, 0, 400, 400])
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
