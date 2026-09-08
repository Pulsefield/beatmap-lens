"""Verify source-frontend parity and source-aligned, sealed audio artifacts."""
import json
import math
import os
from pathlib import Path
import struct
import subprocess
from tempfile import TemporaryDirectory
import unittest
import wave

from learning_audio import render_audio
from learning_corpus import LearningCorpus, digest, prepare_corpus, read
from learning_experience import recall, remember
from test_learning_corpus import source_text


PULSEFIELD = Path(os.environ.get('PULSEFIELD_ROOT', Path(__file__).resolve().parents[4] / 'Pulsefield-model'))
PYTHON = Path(os.environ.get('PULSEFIELD_PYTHON', PULSEFIELD / '.venv/bin/python'))


@unittest.skipUnless(PYTHON.is_file(), 'Requires Pulsefield source and its existing audio Python runtime')
class LearningAudioTest(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        dataset = self.root / 'dataset'
        self.source = dataset / '0/10/First.osu'
        self.source.parent.mkdir(parents=True)
        self.source.write_text(source_text(101, 10, 'First').replace('song.mp3', 'song.wav')
                               .replace('AudioLeadIn: 0', 'AudioLeadIn: 725'))
        self.audio = self.source.with_name('song.wav')
        # A short stereo WAV exercises the real loader's downmix/resampling/global
        # normalization. This is an adapter fixture, not a research beatmap variant.
        sample_rate, duration_ms = 44100, 1733
        samples = []
        for i in range(round(sample_rate * duration_ms / 1000)):
            amplitude = 28000 if i / sample_rate > 1.71 else 3000
            value = int(amplitude * math.sin(2 * math.pi * 437 * i / sample_rate))
            samples.extend((value, value // 2))
        with wave.open(str(self.audio), 'wb') as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(sample_rate)
            output.writeframes(struct.pack(f'<{len(samples)}h', *samples))
        bundle = self.root / 'bundle'
        prepare_corpus(dataset, [10], None, bundle)
        self.corpus = LearningCorpus(bundle)
        self.handle = 'chart:' + digest(self.source)

    def check_source_parity(self, features_path):
        script = '''
import json
from pathlib import Path
import sys
import numpy as np
sys.path.insert(0, str(Path(sys.argv[1]) / 'src'))
from pulsefield_model.features.audio import load_audio_file
from pulsefield_model.features.mel_base import MUSIC_MEL_CACHE_CONFIG, compute_log_mel_10ms
c = MUSIC_MEL_CACHE_CONFIG
wave = load_audio_file(sys.argv[2], c.sample_rate, speed=1.0, normalize=True)
full = compute_log_mel_10ms(wave, sample_rate=c.sample_rate, config=c)
with np.load(sys.argv[3]) as sliced:
    indexes = sliced['frame_indexes']
    np.testing.assert_array_equal(sliced['log_mel'], full[indexes])
    np.testing.assert_array_equal(sliced['support_start_ms'], indexes * c.hop_ms)
    np.testing.assert_array_equal(sliced['support_end_ms'], indexes * c.hop_ms + 40)
    np.testing.assert_array_equal(sliced['center_ms'], indexes * c.hop_ms + 20)
    assert sliced['log_mel'].shape == (len(indexes), 128)
    print(json.dumps({'indexes': indexes.tolist(), 'sampleCount': len(wave),
                      'fullFrames': len(full), 'melConfigHash': c.mel_config_hash,
                      'waveformPeak': float(np.abs(wave).max())}))
'''
        result = subprocess.run([str(PYTHON), '-c', script, str(PULSEFIELD), str(self.audio), str(features_path)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_off_grid_view_matches_full_source_and_seals_shared_scope(self):
        before = {str(path): digest(path) for path in self.root.rglob('*') if path.is_file()}
        result = render_audio(self.corpus, self.handle, 1257, 1703, self.root / 'view', PULSEFIELD)
        reference = self.check_source_parity(result['featuresPath'])
        metadata = read(result['evidencePath'])
        scope = {'startMs': 1257, 'endMs': 1703}
        self.assertEqual(reference['indexes'], list(range(122, 171)))
        self.assertAlmostEqual(reference['waveformPeak'], 1.0, places=6)
        self.assertEqual(metadata['config']['name'], 'MUSIC_MEL_CACHE_CONFIG')
        self.assertEqual(metadata['config']['values']['sample_rate'], 24000)
        self.assertEqual(metadata['config']['values']['mel_bins'], 128)
        self.assertEqual(metadata['config']['values']['n_fft'], 960)
        self.assertEqual(metadata['config']['melConfigHash'], reference['melConfigHash'])
        self.assertEqual(metadata['scope'], scope)
        self.assertEqual(metadata['display']['audioScope'], scope)
        self.assertEqual(metadata['display']['chartScope'], scope)
        self.assertEqual(metadata['frames']['selectedSupport'], {'startMs': 1220, 'endMs': 1740})
        self.assertEqual([(note['kind'], note['startMs'], note['endMs'])
                          for note in metadata['display']['chartNotes']],
                         [('long', 1000, 1750), ('normal', 1500, 1500)])
        self.assertEqual(metadata['audio']['audioLeadInMs'], 725)
        self.assertEqual(metadata['alignment']['appliedAudioLeadInShiftMs'], 0)
        self.assertEqual(metadata['audio']['sha256'], digest(self.audio))
        self.assertEqual(metadata['sourceSha256'], digest(self.source))
        self.assertEqual(metadata['corpusManifestSha256'], digest(self.corpus.bundle / 'manifest.json'))
        self.assertEqual(result['evidenceSha256'], digest(result['evidencePath']))
        for name, expected in metadata['files'].items():
            self.assertEqual(digest(Path(result['evidencePath']).parent / name), expected)
        png = Path(result['imagePath']).read_bytes()
        self.assertEqual(png[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(struct.unpack('>II', png[16:24]), (2250, 1050))
        self.assertFalse(metadata['listened'])
        self.assertFalse(metadata['frames']['sectionBoundaryPadding'])
        self.assertEqual(before, {path: digest(path) for path in before})

    def test_eof_uses_only_source_frontend_padding_and_fixed_color_scale(self):
        result = render_audio(self.corpus, self.handle, 1703, 1751, self.root / 'tail', PULSEFIELD)
        reference = self.check_source_parity(result['featuresPath'])
        metadata = read(result['evidencePath'])
        self.assertEqual(reference['indexes'], list(range(167, 174)))
        self.assertEqual(reference['fullFrames'], 174)
        self.assertEqual(metadata['frames']['selectedFramesTouchingEofPadding'], 4)
        self.assertEqual(metadata['frames']['fullTrackRightPadSamples'],
                         173 * 240 + 960 - reference['sampleCount'])
        self.assertEqual(metadata['frames']['stopIndexExclusive'], reference['fullFrames'])
        self.assertLess(metadata['audio']['durationMs'], metadata['scope']['endMs'])
        self.assertEqual(metadata['display']['color']['max'], 8.0)
        self.assertAlmostEqual(metadata['display']['color']['min'], math.log(1e-5))
        self.assertFalse(metadata['frames']['sectionBoundaryPadding'])
        with self.assertRaisesRegex(FileExistsError, 'fresh audio output'):
            render_audio(self.corpus, self.handle, 1703, 1751, self.root / 'tail', PULSEFIELD)

    def test_missing_external_audio_is_explicit(self):
        self.audio.unlink()
        with self.assertRaisesRegex(FileNotFoundError, 'Audio unavailable'):
            render_audio(self.corpus, self.handle, 1257, 1703, self.root / 'missing', PULSEFIELD)
        self.assertFalse((self.root / 'missing').exists())

    def test_view_can_ground_a_revision_without_becoming_human_evidence(self):
        result = render_audio(self.corpus, self.handle, 1257, 1703, self.root / 'view', PULSEFIELD)
        metadata = read(result['evidencePath'])
        sha, scope = metadata['sourceSha256'], metadata['scope']
        value = {'id': 'retained-hold', 'title': 'A tap within a retained hold',
                 'time': 'The tap occurs while a hold continues.',
                 'action': 'The held column remains occupied during another attack.',
                 'organization': 'A retained role accompanies an intervening attack.',
                 'instances': [{'sourceSha256': sha, 'scope': scope,
                                'sourceLines': [note['sourceLine'] for note in metadata['display']['chartNotes']]}]}
        memory = self.root / 'experience'
        first = remember(self.corpus, memory, value, 'audio-adapter-test')
        value.update(audioEvidence=[result['evidencePath']],
                     updateReason='Added a source-aligned Mel view of the inspected action scope.')
        second = remember(self.corpus, memory, value, 'audio-adapter-test')
        stored = recall(memory, identity=value['id'])['history'][-1]
        self.assertEqual(stored['previousSha256'], first['sha256'])
        self.assertEqual(stored['status'], 'agent-hypothesis')
        self.assertEqual(stored['humanEvidence'], [])
        self.assertEqual(stored['audioEvidence'], [{'modality': 'mel-view',
                         'evidencePath': result['evidencePath'], 'evidenceSha256': result['evidenceSha256'],
                         'sourceSha256': sha, 'scope': scope, 'audioSha256': digest(self.audio)}])
        value['updateReason'] = 'Attempt to reuse a changed artifact.'
        Path(result['imagePath']).write_bytes(b'changed after inspection')
        with self.assertRaisesRegex(ValueError, 'Audio view artifact changed: view.png'):
            remember(self.corpus, memory, value, 'audio-adapter-test')
        self.assertEqual(digest(second['path']), second['sha256'])
        self.assertEqual(len(list(memory.glob('*.json'))), 2)


if __name__ == '__main__':
    unittest.main()
