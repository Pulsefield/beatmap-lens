"""Explore natural mania charts with human experience and retain revisable readings."""
import argparse
import json
import os
from pathlib import Path

from learning_corpus import LearningCorpus, prepare_corpus
from learning_experience import recall, remember


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('prepare', help='Snapshot natural charts, selected sibling difficulties and optional human evidence.')
    prepare.add_argument('--dataset', type=Path, required=True)
    prepare.add_argument('--beatmapset', type=int, action='append', default=[])
    prepare.add_argument('--human-bundle', type=Path)
    prepare.add_argument('--out', type=Path, required=True)
    for name in ('catalog', 'context', 'inspect', 'perspective', 'render', 'audio', 'examples', 'example', 'remember'):
        command = commands.add_parser(name)
        command.add_argument('--bundle', type=Path, required=True)
        if name in ('context', 'inspect', 'perspective', 'render', 'audio'):
            command.add_argument('--handle', required=True, help='chart:<sha> or example:<human-id>')
            command.add_argument('--start-ms', type=int)
            command.add_argument('--end-ms', type=int)
        if name in ('catalog', 'examples'):
            command.add_argument('--text', default='')
        if name in ('catalog', 'examples', 'inspect'):
            command.add_argument('--offset', type=int, default=0)
            command.add_argument('--limit', type=int, default=8 if name == 'catalog' else 3 if name == 'examples' else 32)
        if name == 'catalog':
            command.add_argument('--community-tag', default='')
        if name == 'context':
            command.add_argument('--timing-offset', type=int, default=0)
            command.add_argument('--timing-limit', type=int, default=12)
        if name == 'inspect':
            command.add_argument('--view', choices=['rows', 'actions', 'articulation'], default='actions')
        if name == 'render':
            command.add_argument('--view', choices=['time', 'rows'], default='time')
            command.add_argument('--page', type=int, default=0)
            command.add_argument('--out', type=Path, required=True)
        if name == 'audio':
            command.add_argument('--out', type=Path, required=True, help='Fresh directory for the Mel view, numerical frames, and evidence.')
            command.add_argument('--ensomi-root', type=Path,
                                 default=Path(os.environ.get('ENSOMI_ROOT', Path(__file__).resolve().parents[3] / 'ensomi-model')),
                                 help='ensomi checkout with its existing .venv music frontend.')
        if name == 'examples':
            command.add_argument('--tag', default='tech')
            command.add_argument('--assessment', choices=['absent', 'supporting', 'prominent', 'present'])
        if name == 'example':
            command.add_argument('--id', required=True)
        if name == 'remember':
            command.add_argument('--memory', type=Path, required=True)
            command.add_argument('--input', type=Path, required=True)
            command.add_argument('--producer', required=True)
    memory = commands.add_parser('recall', help='Retrieve agent hypotheses separately from human evidence.')
    memory.add_argument('--memory', type=Path, required=True)
    memory.add_argument('--text', default='')
    memory.add_argument('--id')
    memory.add_argument('--limit', type=int, default=5)
    args = parser.parse_args()
    if args.command == 'prepare':
        result = prepare_corpus(args.dataset, args.beatmapset, args.human_bundle, args.out)
    elif args.command == 'recall':
        result = recall(args.memory, args.text, args.id, args.limit)
    else:
        corpus = LearningCorpus(args.bundle)
        match args.command:
            case 'catalog':
                result = corpus.catalog(args.text, args.community_tag, args.offset, args.limit)
            case 'context':
                result = corpus.context(args.handle, args.start_ms, args.end_ms, args.timing_offset, args.timing_limit)
            case 'inspect':
                result = corpus.inspect(args.handle, args.start_ms, args.end_ms, args.view, args.offset, args.limit)
            case 'perspective':
                result = corpus.perspective(args.handle, args.start_ms, args.end_ms)
            case 'render':
                result = corpus.render(args.handle, args.start_ms, args.end_ms, args.view, args.page)
                args.out.parent.mkdir(parents=True, exist_ok=True)
                args.out.write_bytes(result.pop('png'))
                result['imagePath'] = str(args.out.resolve())
            case 'audio':
                from learning_audio import render_audio
                result = render_audio(corpus, args.handle, args.start_ms, args.end_ms, args.out, args.ensomi_root)
            case 'examples':
                result = corpus.search(args.tag, args.assessment, args.text, args.offset, args.limit)
            case 'example':
                result = corpus.example(args.id)
            case 'remember':
                result = remember(corpus, args.memory, json.loads(args.input.read_text()), args.producer)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
