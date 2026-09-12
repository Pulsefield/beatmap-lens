"""Read-only, on-demand annotation tools over a frozen source and human-example bundle."""
import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time
from typing import Literal

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'annotation'))

from playback_rate import normalize_playback_rate, same_playback_rate
from harness_examples import get_example, public_example, search_examples
from harness_inspection import chart_context, inspect, perspective
from harness_playback import timing_context
from harness_render import render_section


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


class Harness:
    def __init__(self, bundle, trace=None):
        self.bundle = Path(bundle).resolve()
        self.manifest = read(self.bundle / 'manifest.json')
        self.trace = Path(trace) if trace else None
        self.sections = {s['sectionId']: s for s in self.manifest['sections']}
        for section in self.sections.values():
            normalize_playback_rate(section.get('playbackRate'))
        for name in self.manifest['files']:
            if name.startswith('tools/') and digest(self.bundle / name) != self.manifest['files'][name]:
                raise ValueError(f'Frozen harness tool changed: {name}')
        self.examples = self.load('examples.json')
        self.example_refs = self.load('example-refs.json') if 'example-refs.json' in self.manifest['files'] else {}
        self.contrast_sets = self.load('contrast-sets.json')['sets']
        if 'sections.json' in self.manifest['files'] and self.load('sections.json') != self.manifest['sections']:
            raise ValueError('Frozen harness section targets changed.')
        self.exclusions = {'excluded_sources': self.manifest['excludedSources'],
                           'excluded_groups': self.manifest['excludedGroups']}
        self.calls = Counter()
        if self.trace:
            # An initialized, empty trace distinguishes no tool evidence from a
            # legacy or missing trace whose dependencies are unknown.
            self.trace.parent.mkdir(parents=True, exist_ok=True)
            self.trace.touch(exist_ok=True)

    def load(self, relative):
        path = self.bundle / relative
        if digest(path) != self.manifest['files'][relative]:
            raise ValueError(f'Frozen harness input changed: {relative}')
        return read(path)

    @lru_cache(maxsize=4)
    def chart(self, source_sha):
        return self.load(self.manifest['charts'][source_sha]['path'])

    def section(self, section_id):
        if section_id.startswith('example:'):
            example = get_example(self.examples, section_id[8:], **self.exclusions)
            if example is None:
                raise ValueError('Example is unavailable in this job. Use find_human_examples for allowed IDs.')
            return example
        if section_id not in self.sections:
            raise ValueError('Unknown section ID. Use the IDs in the supplied section brief.')
        return self.sections[section_id]

    def bounds(self, section_id, start_ms=None, end_ms=None):
        section = self.section(section_id)
        chart = self.chart(section['sourceSha256'])
        start = section['scope']['startMs'] if start_ms is None else start_ms
        end = section['scope']['endMs'] if end_ms is None else end_ms
        if not chart['range']['startMs'] <= start < end <= chart['range']['endMs']:
            raise ValueError(f"Choose increasing source milliseconds inside {chart['range']}.")
        return section, chart, start, end

    def context(self, section_id, start_ms=None, end_ms=None, timing_offset=0, timing_limit=12):
        section, chart, start, end = self.bounds(section_id, start_ms, end_ms)
        result = chart_context(chart, start, end, timing_offset, timing_limit, section.get('playbackRate', 1))
        result['reviewContext'] = {key: section['reviewContext'][key] for key in ('startMs', 'endMs')}
        result['sectionId'] = section_id
        if self.manifest['mode'] == 'annotation':
            result['existingHumanJudgments'] = [
                public_example(e)
                for e in self.examples if e['sourceSha256'] == section['sourceSha256']
                and same_playback_rate(e, section)
                and max(start, e['scope']['startMs']) < min(end, e['scope']['endMs'])]
        return result

    def rows(self, section_id, start_ms=None, end_ms=None, view='rows', offset=0, limit=32):
        section, chart, start, end = self.bounds(section_id, start_ms, end_ms)
        return inspect(chart, start, end, view, offset, limit, section.get('playbackRate', 1))

    def perspective(self, section_id, start_ms=None, end_ms=None):
        section, chart, start, end = self.bounds(section_id, start_ms, end_ms)
        return perspective(chart, start, end, section.get('playbackRate', 1))

    def search(self, tag_id='tech', assessment=None, text='', offset=0, limit=3, contrast_set=None, playback_rate=None,
               confidence=None, note_kind=None, key_count=None):
        result = search_examples(self.examples, tag_id, assessment, text, offset, limit,
                                 contrast_sets=self.contrast_sets, contrast_set=contrast_set,
                                 playback_rate=playback_rate, confidence=confidence,
                                 note_kind=note_kind, key_count=key_count, **self.exclusions)
        # Keep long source IDs behind the stable example handle.
        for card in result['cards']:
            source = self.manifest['charts'][card.pop('sourceSha256')]['source']
            card.update({key: source[key] for key in ('title', 'difficulty') if key in source})
            card['sectionId'] = 'example:' + card['id']
        return result

    def example(self, example_id):
        result = get_example(self.examples, example_id, **self.exclusions)
        if result is None:
            raise ValueError('Example is unavailable in this job. Use find_human_examples for allowed IDs.')
        source = self.manifest['charts'][result['sourceSha256']]['source']
        return public_example(result) | {
            'sectionId': 'example:' + result['id'],
            'source': {key: source[key] for key in ('sha256', 'title', 'artist', 'difficulty', 'creator',
                                                    'keyCount', 'beatmapId', 'beatmapSetId') if key in source}}

    def query(self, section_id, query, start_ms=None, end_ms=None, columns=None, offset=0, limit=3):
        section, chart, start, end = self.bounds(section_id, start_ms, end_ms)
        rate = normalize_playback_rate(section.get('playbackRate'))
        path = Path(__file__).with_name('annotation-queries.py')
        spec = importlib.util.spec_from_file_location('annotation_queries', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if (query == 'repeated-subset') != bool(columns):
            raise ValueError('Supply columns only for repeated-subset, e.g. [0,1].')
        notes = [{'source_line': n['sourceLine'], 'column': n['column'], 'kind': n['kind'],
                  'start_ms': n['startMs'], 'end_ms': n['endMs']} for n in chart['notes']]
        matches = list(module.query_chart(query, notes, start, end, tuple(columns or [])))
        limit, offset = min(6, max(1, limit)), max(0, offset)
        cards = []
        for match in matches[offset:offset + limit]:
            card = {k: match[k] for k in ('bounds', 'groups', 'columns', 'direction', 'selectionRule') if k in match}
            if 'rows' in match:
                card.update(rowCount=len(match['rows']),
                            gapCounts=Counter(match['rowGapsMs']).most_common(6),
                            witnessLines=[n['sourceLine'] for row in match['rows'][:4] for n in row],
                            witnessPreview=True)
            else:
                card.update({key: [[n['sourceLine'], n['column'], n['startMs'], n['endMs']] for n in match[key]]
                             for key in ('attacks', 'releases', 'continuingHolds', 'heldAfter')})
            cards.append(card)
        result = {'sourceSha256': chart['source']['sha256'], 'query': query, 'scope': {'startMs': start, 'endMs': end},
                'matches': cards, 'total': len(matches),
                'nextOffset': offset + limit if offset + limit < len(matches) else None,
                'interpretation': 'Structural candidates only. Inspect complete rows/context before assigning style or absence.'}
        if rate != 1:
            result.update(playbackRate=rate, performanceTiming=timing_context(start, end, rate) | {
                'matches': [{
                    'elapsedBoundsMs': {key: (value - start) / rate for key, value in card['bounds'].items()},
                    **({'gapCounts': [(gap / rate, count) for gap, count in card['gapCounts']]}
                       if 'gapCounts' in card else {}),
                } for card in cards],
            })
        return result

    def render(self, section_id, start_ms=None, end_ms=None, view='time', page=0):
        section, chart, start, end = self.bounds(section_id, start_ms, end_ms)
        return render_section(chart, start, end, view, page, section.get('playbackRate', 1))

    def call(self, name, arguments):
        methods = {'chart_context': self.context, 'inspect_section': self.rows,
                   'section_perspective': self.perspective, 'find_human_examples': self.search,
                   'get_human_example': self.example, 'query_structure': self.query,
                   'render_section': self.render}
        started = time.perf_counter()
        identity = name + compact(arguments)
        self.calls[identity] += 1
        response, png, failed = {}, None, False
        try:
            response = methods[name](**arguments)
            png = response.pop('png', None)
            return compact(response), png
        except Exception as error:
            response, failed = {'error': str(error)}, True
            raise
        finally:
            if self.trace:
                self.trace.parent.mkdir(parents=True, exist_ok=True)
                record = {'at': datetime.now(timezone.utc).isoformat(), 'tool': name, 'arguments': arguments,
                          'elapsedMs': round((time.perf_counter() - started) * 1000, 3),
                          'responseBytes': len(compact(response).encode()), 'response': response, 'failed': failed,
                          'repeatCount': self.calls[identity],
                          'imageBytes': len(png) if png else 0,
                          'imageSha256': hashlib.sha256(png).hexdigest() if png else None}
                if self.manifest.get('humanEvidenceTracking') == 'returned-examples-v1':
                    examples = (response.get('cards', []) if name == 'find_human_examples' else
                                [response] if name == 'get_human_example' and not failed else
                                response.get('existingHumanJudgments', []) if name == 'chart_context' else [])
                    section_id = arguments.get('section_id', '')
                    if not failed and section_id.startswith('example:'):
                        examples = [*examples, {'id': section_id[8:]}]
                    refs = [self.example_refs.get(example['id']) for example in examples]
                    record['humanEvidenceRefs'] = list({compact(ref): ref for ref in refs if ref is not None}.values())
                    record['humanEvidenceTrackingComplete'] = all(ref is not None for ref in refs)
                with self.trace.open('a') as stream:
                    stream.write(compact(record) + '\n')


def create_server(harness):
    from mcp.server.fastmcp import FastMCP
    from mcp.types import CallToolResult, ImageContent, TextContent, ToolAnnotations

    server = FastMCP('beatmap-lens', instructions=(
        'Read-only evidence tools. Source milliseconds and columns are zero-based; scopes are half-open. '
        'A section or human example owns its playbackRate (omitted means 1x); performanceTiming contains effective timing. '
        'Never transfer a human judgment to another playback rate. Query bounds always use source milliseconds. '
        'Use tools only to answer an inspection question; reuse evidence already visible. '
        'Search returns small human-example cards; expand only useful comparisons. '
        'The player-action perspective supplies facts and questions, never a Tech verdict.'))
    annotations = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)

    def result(name, arguments):
        text, png = harness.call(name, arguments)
        content = [TextContent(type='text', text=text)]
        if png:
            content.append(ImageContent(type='image', data=base64.b64encode(png).decode(), mimeType='image/png'))
        return CallToolResult(content=content)

    @server.tool(annotations=annotations, structured_output=False)
    def chart_context(section_id: str, start_ms: int | None = None, end_ms: int | None = None,
                      timing_offset: int = 0, timing_limit: int = 12) -> CallToolResult:
        """Get readable metadata, active tempo, arrangement overview and nearby context when needed. Follow timingChanges.nextOffset for more tempo/SV points."""
        return result('chart_context', {'section_id': section_id, 'start_ms': start_ms, 'end_ms': end_ms, 'timing_offset': timing_offset,
                                        'timing_limit': timing_limit})

    @server.tool(annotations=annotations, structured_output=False)
    def inspect_section(section_id: str, start_ms: int | None = None, end_ms: int | None = None,
                        view: Literal['rows', 'actions', 'articulation'] = 'rows', offset: int = 0, limit: int = 32) -> CallToolResult:
        """Inspect exact rows, press/hold/release actions, or articulation: complete attack rows plus neutral LN duration, interior-attack and release relationships. Full refs and entering holds remain intact; no playable-role or style verdict. Follow nextOffset if needed."""
        return result('inspect_section', {'section_id': section_id, 'start_ms': start_ms, 'end_ms': end_ms,
                                         'view': view, 'offset': offset, 'limit': limit})

    @server.tool(annotations=annotations, structured_output=False)
    def section_perspective(section_id: str, start_ms: int | None = None, end_ms: int | None = None) -> CallToolResult:
        """For difficult Tech or strength judgments, view the episode through player actions: familiar organization, pulse changes and articulation. Facts, not labels."""
        return result('section_perspective', {'section_id': section_id, 'start_ms': start_ms, 'end_ms': end_ms})

    @server.tool(annotations=annotations, structured_output=False)
    def find_human_examples(tag_id: str = 'tech', assessment: Literal['absent', 'supporting', 'prominent', 'present'] | None = None,
                            text: str = '', offset: int = 0, limit: int = 3, contrast_set: str | None = None,
                            playback_rate: float | None = None, confidence: Literal['high', 'low', 'unspecified'] | None = None,
                            note_kind: Literal['tap-only', 'with-ln'] | None = None, key_count: int | None = None) -> CallToolResult:
        """Find human references for a specific presence/strength question. Filter by tag, assessment, human confidence, literal human-comment/title/difficulty words, source note_kind/key_count, or contrast_set. Cards include sourceFacts, not inferred style. Inspect useful example sectionIds. Counts expose missing contrasts; broaden filters after misses. Unset confidence is unspecified, never low or high. No agent reasoning/evidence or relevance ranking."""
        return result('find_human_examples', {'tag_id': tag_id, 'assessment': assessment, 'text': text,
                                            'offset': offset, 'limit': limit, 'contrast_set': contrast_set,
                                            'playback_rate': playback_rate, 'confidence': confidence,
                                            'note_kind': note_kind, 'key_count': key_count})

    @server.tool(annotations=annotations, structured_output=False)
    def get_human_example(example_id: str) -> CallToolResult:
        """Open one final human judgment with source/scope/facts, optional explicit humanConfidence and exact humanComment. No agent reasoning/evidence; generic confirmations have no comment. Returned sectionId works with source inspection tools."""
        return result('get_human_example', {'example_id': example_id})

    @server.tool(annotations=annotations, structured_output=False)
    def query_structure(section_id: str, query: Literal['fixed-group', 'repeated-subset', 'alternation', 'roll', 'ln-events'],
                        start_ms: int | None = None, end_ms: int | None = None, columns: list[int] | None = None,
                        offset: int = 0, limit: int = 3) -> CallToolResult:
        """Check a specific structural hypothesis. Compact candidate previews retain their bounds; query misses do not prove style absence."""
        return result('query_structure', {'section_id': section_id, 'query': query, 'start_ms': start_ms,
                                         'end_ms': end_ms, 'columns': columns, 'offset': offset, 'limit': limit})

    @server.tool(annotations=annotations, structured_output=False)
    def render_section(section_id: str, start_ms: int | None = None, end_ms: int | None = None,
                        view: Literal['time', 'rows'] = 'time', page: int = 0) -> CallToolResult:
        """See a bounded native image when spatial grouping is unclear. Time view preserves rhythm; rows view distorts time. Optional, not required for every section."""
        return result('render_section', {'section_id': section_id, 'start_ms': start_ms, 'end_ms': end_ms,
                                        'view': view, 'page': page})

    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--trace', type=Path)
    parser.add_argument('--call', help='Call one tool as compact JSON instead of serving MCP over stdio.')
    parser.add_argument('--arguments', default='{}', help='JSON tool arguments for --call.')
    parser.add_argument('--image-out', type=Path, help='PNG destination for a CLI render call.')
    args = parser.parse_args()
    harness = Harness(args.bundle, args.trace)
    if args.call:
        body, png = harness.call(args.call, json.loads(args.arguments))
        if png and args.image_out:
            args.image_out.write_bytes(png)
        print(body)
    else:
        create_server(harness).run(transport='stdio')


if __name__ == '__main__':
    main()
