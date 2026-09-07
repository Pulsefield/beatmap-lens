"""Real MCP transport and frozen-bundle boundaries for annotation tools."""
import asyncio
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

import pyarrow as pa
import pyarrow.parquet as pq

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from test_harness_examples import claim, feedback, review

SCRIPTS = Path(__file__).parent


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), SCRIPTS / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


prepare = module('prepare-annotation-harness')
harness = module('annotation-harness')


class HarnessTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        campaign = self.root / 'campaign'
        sources, sections = [], []
        self.feedback_dir = self.root / 'feedback'
        self.source_ids = []
        for index in range(3):
            # Valid source input, two related difficulties plus another song.
            text = ('osu file format v14\n[General]\nMode:3\n[Metadata]\n'
                    f'Title:Fixture {index}\nVersion:Test\n[Difficulty]\nCircleSize:4\n'
                    '[TimingPoints]\n0,500,4,2,0,100,1,0\n[HitObjects]\n'
                    '64,192,1000,128,0,1500:0:0:0:0:\n192,192,1250,1,0,0:0:0:0:\n')
            path = self.root / f'source-{index}.osu'
            path.write_text(text)
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            self.source_ids.append(sha)
            source = {'sha256': sha, 'title': f'Fixture {index}', 'keyCount': 4, 'beatmapSetId': 10 if index < 2 else 20}
            bounds = {'startMs': 0, 'endMs': 1501}
            sources.append({'source': source, 'range': bounds, 'sourcePath': str(path)})
            notes = [{'source_line': 12, 'column': 0, 'kind': 'long', 'start_ms': 1000, 'end_ms': 1500},
                     {'source_line': 13, 'column': 1, 'kind': 'normal', 'start_ms': 1250, 'end_ms': 1250}]
            meta = {'source': source, 'range': bounds,
                    'timingPoints': [{'sourceLine': 10, 'fields': ['0', '500', '4', '2', '0', '100', '1', '0']}]}
            target = campaign / 'agent/charts' / (sha + '.parquet')
            target.parent.mkdir(parents=True, exist_ok=True)
            table = pa.Table.from_pylist(notes).replace_schema_metadata({b'beatmap_lens': json.dumps(meta).encode()})
            pq.write_table(table, target)
            data = feedback(sha)
            value = claim(identity=f'claim-{index}')
            value.update(scope={'startMs': 1000, 'endMs': 1501}, reviewContext=bounds)
            data['agentReviews'] = [review(value, identity=f'human-{index}', rationale=f'Exact human explanation {index}.')]
            prepare.save(self.feedback_dir / f'{sha}.json', data)
            sections.append({'caseId': f'case-{index}', 'sourceSha256': sha,
                             'scope': value['scope'], 'reviewContext': bounds})
        prepare.save(campaign / 'admin/source-map.json', sources)
        prepare.save(campaign / 'controller/config.json', {'foundationSha256': 'frozen-foundation'})
        self.sections = self.root / 'sections.json'
        prepare.save(self.sections, {'cases': sections[:1]})
        self.campaign = campaign
        self.bundle = self.root / 'bundle'
        prepare.prepare(campaign, self.sections, self.feedback_dir, self.bundle, 'evaluation')

    def test_evaluation_excludes_target_and_related_difficulty_labels_from_disk_and_tools(self):
        library = prepare.read(self.bundle / 'examples.json')
        self.assertEqual(len(library), 1)
        self.assertEqual(library[0]['sourceSha256'], self.source_ids[2])
        agent = harness.Harness(self.bundle)
        cards = agent.search()['cards']
        self.assertEqual(len(cards), 1)
        self.assertNotIn('sourceSha256', cards[0])
        self.assertNotIn('existingHumanJudgments', agent.context('case-0'))
        from harness_examples import extract_examples
        records = extract_examples([prepare.read(p) for p in self.feedback_dir.glob('*.json')], {})
        excluded = next(e for e in records if e['sourceSha256'] == self.source_ids[0])
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            agent.example(excluded['id'])
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            agent.rows('example:' + excluded['id'])

    def test_annotation_reuses_exact_scoped_human_judgments_and_reference_views(self):
        bundle = self.root / 'annotation'
        prepare.prepare(self.campaign, self.sections, self.feedback_dir, bundle, 'annotation')
        agent = harness.Harness(bundle)
        current = agent.context('case-0')['existingHumanJudgments']
        self.assertEqual(current[0]['rationale'], 'Exact human explanation 0.')
        card = agent.search()['cards'][0]
        example = agent.example(card['id'])
        view = agent.rows(example['sectionId'], view='actions')
        self.assertEqual(view['sourceSha256'], example['sourceSha256'])
        self.assertTrue(view['coverage']['allEventsReturned'])
        self.assertNotIn('notes', example)

    def test_job_case_handles_disambiguate_source_local_section_ids(self):
        first = prepare.read(self.sections)['cases'][0]
        first['sectionId'] = 'whole-source'
        second = {**first, 'caseId': 'case-1', 'sourceSha256': self.source_ids[1]}
        prepare.save(self.sections, {'cases': [first, second]})
        bundle = self.root / 'unique-handles'
        prepare.prepare(self.campaign, self.sections, self.feedback_dir, bundle, 'evaluation')
        agent = harness.Harness(bundle)
        self.assertEqual(agent.rows('case-0')['sourceSha256'], self.source_ids[0])
        self.assertEqual(agent.rows('case-1')['sourceSha256'], self.source_ids[1])
        for section in (first, second):
            section.pop('caseId')
        prepare.save(self.sections, {'sections': [first, second]})
        with self.assertRaisesRegex(ValueError, 'Supply unique caseId'):
            prepare.prepare(self.campaign, self.sections, self.feedback_dir, self.root / 'collision')

    def test_changed_source_snapshot_is_detected_before_inspection(self):
        manifest = prepare.read(self.bundle / 'manifest.json')
        chart = self.bundle / manifest['charts'][self.source_ids[0]]['path']
        chart.write_text(chart.read_text().replace('Fixture 0', 'Edited title'))
        with self.assertRaisesRegex(ValueError, 'Frozen harness input changed'):
            harness.Harness(self.bundle).rows('case-0')

    def test_changed_tool_snapshot_is_detected_on_start(self):
        path = self.bundle / 'tools/harness_inspection.py'
        path.write_text(path.read_text() + '\n# changed\n')
        with self.assertRaisesRegex(ValueError, 'Frozen harness tool changed'):
            harness.Harness(self.bundle)

    def test_native_mcp_returns_compact_text_images_and_actionable_argument_errors(self):
        async def run():
            trace = self.root / 'trace.jsonl'
            params = StdioServerParameters(command=sys.executable, args=[
                str(self.bundle / 'tools/annotation-harness.py'), '--bundle', str(self.bundle), '--trace', str(trace)])
            async with stdio_client(params) as (reader, writer):
                async with ClientSession(reader, writer) as client:
                    await client.initialize()
                    tools = (await client.list_tools()).tools
                    self.assertEqual(len(tools), 7)
                    self.assertTrue(all(t.annotations.readOnlyHint for t in tools))
                    context = await client.call_tool('chart_context', {'section_id': 'case-0', 'start_ms': 0,
                                                                       'timing_offset': 0, 'timing_limit': 1})
                    self.assertFalse(context.isError)
                    self.assertEqual(json.loads(context.content[0].text)['timingChanges']['returned'], 1)
                    page = await client.call_tool('inspect_section', {'section_id': 'case-0', 'view': 'actions', 'limit': 1})
                    self.assertFalse(page.isError)
                    self.assertEqual(json.loads(page.content[0].text)['pagination']['nextOffset'], 1)
                    negative = await client.call_tool('inspect_section', {'section_id': 'case-0', 'offset': -1000})
                    self.assertTrue(negative.isError)
                    self.assertIn('nonnegative', negative.content[0].text)
                    query = await client.call_tool('query_structure', {'section_id': 'case-0', 'query': 'ln-events'})
                    self.assertFalse(query.isError)
                    self.assertGreater(json.loads(query.content[0].text)['total'], 0)
                    image = await client.call_tool('render_section', {'section_id': 'case-0'})
                    self.assertFalse(image.isError)
                    self.assertEqual([c.type for c in image.content], ['text', 'image'])
                    self.assertEqual(image.content[1].mimeType, 'image/png')
            records = [json.loads(line) for line in trace.read_text().splitlines()]
            self.assertEqual(records[-1]['tool'], 'render_section')
            self.assertGreater(records[-1]['imageBytes'], 0)
            self.assertNotIn('png', records[-1]['response'])
            self.assertEqual(sum(record['failed'] for record in records), 1)
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
