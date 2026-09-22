"""Source-aligned Mel and chart views using ensomi's existing music frontend."""
from dataclasses import asdict
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import subprocess
import sys


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def render_audio(corpus, handle, start_ms, end_ms, out: Path, ensomi_root: Path):
    """Create a fresh image, raw feature slice and sealed provenance record."""
    section, chart, start, end = corpus.bounds(handle, start_ms, end_ms)
    sha = section['sourceSha256']
    ref = corpus.manifest['charts'][sha]
    audio = ref['audio']
    if not audio or not Path(audio['path']).is_file():
        raise FileNotFoundError(f'Audio unavailable for {handle}.')
    out, ensomi_root = Path(out).resolve(), Path(ensomi_root).resolve()
    if out.exists():
        raise FileExistsError(f'Choose a fresh audio output directory: {out}')
    python = Path(os.environ.get('ENSOMI_PYTHON', ensomi_root / '.venv/bin/python'))
    if not python.is_file():
        raise FileNotFoundError(f'ensomi Python runtime unavailable: {python}')
    notes = [note for note in chart['notes']
             if (note['startMs'] < end and note['endMs'] >= start if note['kind'] == 'long'
                 else start <= note['startMs'] < end)]
    payload = {'ensomiRoot': str(ensomi_root), 'out': str(out),
               'sourceSha256': sha, 'source': chart['source'], 'handle': handle,
               'scope': {'startMs': start, 'endMs': end}, 'notes': notes,
               'audio': {'path': str(Path(audio['path']).resolve()),
                         'audioLeadInMs': audio.get('audioLeadInMs', 0)},
               'corpusManifestSha256': digest(corpus.bundle / 'manifest.json')}
    result = subprocess.run([str(python), str(Path(__file__).resolve()), '--extract'],
                            input=json.dumps(payload), capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip().splitlines()[-1])
    return json.loads(result.stdout)


def _extract(payload):
    # Imports stay in the configured runtime; the learning CLI needs no ML packages.
    sys.path.insert(0, str(Path(payload['ensomiRoot']) / 'src'))
    import numpy as np
    from ensomi_model.features import audio, mel_base

    config = mel_base.MUSIC_MEL_CACHE_CONFIG
    audio_path = Path(payload['audio']['path'])
    audio_sha = digest(audio_path)
    waveform = audio.load_audio_file(audio_path, config.sample_rate, speed=1.0, normalize=True)
    # Full-track extraction preserves global normalization, the source frame grid,
    # and real right context. Only the source frontend adds padding at audio EOF.
    full_mel = mel_base.compute_log_mel_10ms(waveform, sample_rate=config.sample_rate, config=config)
    scope = payload['scope']
    start, end = scope['startMs'], scope['endMs']
    window_ms = config.n_fft * 1000 / config.sample_rate
    first = max(0, math.floor((start - window_ms) / config.hop_ms) + 1)
    stop = min(len(full_mel), math.ceil(end / config.hop_ms))
    first = min(first, stop)
    indexes = np.arange(first, stop, dtype=np.int64)
    frame_start = indexes * config.hop_ms
    frame_end = frame_start + window_ms
    centers = (frame_start + frame_end) / 2
    mel = full_mel[first:stop]
    duration_ms = len(waveform) * 1000 / config.sample_rate
    out = Path(payload['out'])
    out.mkdir(parents=True, exist_ok=False)
    np.savez_compressed(out / 'features.npz', log_mel=mel, frame_indexes=indexes,
                        support_start_ms=frame_start, support_end_ms=frame_end,
                        center_ms=centers, mel_bin_indexes=np.arange(config.mel_bins))
    color = {'scale': 'natural logarithm of floored Mel power',
             'min': float(np.log(mel_base.LOG_MEL_FLOOR)), 'max': 8.0,
             'comparison': 'Fixed bounds across all views; full-track peak normalization precedes extraction. '
                           'No section-dependent color rescaling; cross-track absolute loudness is not preserved.',
             'valuesAboveMax': int(np.count_nonzero(mel > 8.0)),
             'valuesBelowMin': int(np.count_nonzero(mel < np.float32(np.log(mel_base.LOG_MEL_FLOOR))))}
    _plot(payload, mel, centers, config, color, duration_ms, out / 'view.png')
    config_values = asdict(config)
    config_values['cache_root'] = str(config_values['cache_root'])
    config_values['hop_length'] = config.hop_length
    implementation_paths = {'mel_base': Path(mel_base.__file__), 'audio': Path(audio.__file__),
                            'adapter': Path(__file__).resolve()}
    support = {'startMs': float(frame_start[0]), 'endMs': float(frame_end[-1])} if len(indexes) else None
    metadata = {
        'kind': 'beatmap-lens-audio-evidence-v1', 'modality': 'mel-view', 'listened': False,
        'sourceSha256': payload['sourceSha256'], 'handle': payload['handle'], 'scope': scope,
        'corpusManifestSha256': payload['corpusManifestSha256'],
        'audio': {**payload['audio'], 'sha256': audio_sha, 'sampleCount': len(waveform),
                  'sampleRate': config.sample_rate, 'durationMs': duration_ms},
        'alignment': {'origin': 'Audio file origin equals source chart zero milliseconds.',
                      'appliedAudioLeadInShiftMs': 0,
                      'audioLeadInMeaning': 'Pre-play wait; not an audio-to-chart timestamp shift.',
                      'playbackRate': 1.0, 'scopeConvention': '[startMs,endMs)'},
        'config': {'name': 'MUSIC_MEL_CACHE_CONFIG', 'values': config_values,
                   'melConfigHash': config.mel_config_hash,
                   'frontend': {'window': 'hann', 'center': False, 'power': 2.0, 'norm': 1,
                                'logFloor': mel_base.LOG_MEL_FLOOR}},
        'implementation': {
            'ensomiRoot': payload['ensomiRoot'],
            'sources': {name: {'path': str(path), 'sha256': digest(path)}
                        for name, path in implementation_paths.items()},
            'versions': {name: importlib.metadata.version(name)
                         for name in ('nnAudio', 'torch', 'numpy', 'pydub', 'matplotlib')},
            'ffmpeg': subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True,
                                     check=True).stdout.splitlines()[0]},
        'normalization': {'loader': 'ensomi_model.features.audio.load_audio_file',
                          'mono': True, 'speed': 1.0, 'normalize': True,
                          'scope': 'Entire decoded, resampled, mono track; global absolute peak scaled to 1 when nonzero.'},
        'frames': {'fullTrackCount': len(full_mel), 'selectedCount': len(indexes),
                   'firstIndex': first, 'stopIndexExclusive': stop, 'hopMs': config.hop_ms,
                   'windowMs': window_ms, 'selectedSupport': support,
                   'selection': 'Keep frames whose half-open support overlaps the requested source scope.',
                   'supportFormulaMs': '[frame_index * hopMs, frame_index * hopMs + windowMs)',
                   'plottedAt': 'Window center; image cells span center +/- half a hop, clipped to requested scope.',
                   'precision': f'A {config.hop_ms} ms sampling hop does not imply {config.hop_ms} ms onset precision; '
                                f'every frame uses {window_ms:g} ms support.',
                   'fullTrackRightPadSamples': max(0, (len(full_mel) - 1) * config.hop_length + config.n_fft - len(waveform))
                   if len(full_mel) else 0,
                   'selectedFramesTouchingEofPadding': int(np.count_nonzero(frame_end > duration_ms)),
                   'sectionBoundaryPadding': False},
        'display': {'audioScope': scope, 'chartScope': scope, 'horizontalAxis': 'Source seconds, absolute',
                    'verticalAudioAxis': f'Mel bin index, 0–{config.mel_bins - 1}; {config.fmin:g}–{config.fmax:g} Hz frontend range',
                    'color': color, 'chartNotes': payload['notes'],
                    'chartLegend': {'attack': 'filled circle', 'hold': 'thick segment', 'release': 'open circle'}},
        'files': {name: digest(out / name) for name in ('view.png', 'features.npz')},
        'interpretation': 'A visual audio feature observation, not playback or a human label. '
                          'Mel energy alone does not establish note correspondence, musical intent, action demands or Tech.'}
    evidence = out / 'evidence.json'
    evidence.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    return {'evidencePath': str(evidence), 'imagePath': str(out / 'view.png'),
            'featuresPath': str(out / 'features.npz'), 'evidenceSha256': digest(evidence),
            'sourceSha256': payload['sourceSha256'], 'scope': scope,
            'modality': 'mel-view', 'melConfigHash': config.mel_config_hash,
            'selectedFrames': len(indexes)}


def _plot(payload, mel, centers, config, color, duration_ms, target):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    from matplotlib.ticker import ScalarFormatter
    import numpy as np

    start, end = payload['scope']['startMs'], payload['scope']['endMs']
    fig = plt.figure(figsize=(15, 7), layout='constrained')
    grid = fig.add_gridspec(2, 2, width_ratios=[1, 0.018], height_ratios=[3, 1.35])
    spectrum = fig.add_subplot(grid[0, 0])
    notes = fig.add_subplot(grid[1, 0], sharex=spectrum)
    color_axis = fig.add_subplot(grid[0, 1])
    if len(centers):
        time_edges = np.append(centers - config.hop_ms / 2, centers[-1] + config.hop_ms / 2) / 1000
        mesh = spectrum.pcolormesh(time_edges, np.arange(config.mel_bins + 1) - 0.5,
                                  mel.T, shading='flat', cmap='magma',
                                  vmin=color['min'], vmax=color['max'], rasterized=True)
        fig.colorbar(mesh, cax=color_axis, label='ln Mel power (fixed scale)', extend='max')
    else:
        color_axis.set_visible(False)
        spectrum.text(0.5, 0.5, 'No source audio frames overlap this scope',
                      transform=spectrum.transAxes, ha='center')
    spectrum.set_ylim(-0.5, config.mel_bins - 0.5)
    spectrum.set_yticks([0, 32, 64, 96, config.mel_bins - 1])
    spectrum.set_ylabel(f'Mel bin ({config.fmin:g}–{config.fmax:g} Hz)')
    spectrum.set_title(f'Music Mel: {config.sample_rate / 1000:g} kHz · {config.mel_bins} bins · '
                       f'{config.hop_ms} ms hop · {config.n_fft * 1000 / config.sample_rate:g} ms support · window-center placement',
                       fontsize=11, loc='left')
    spectrum.tick_params(labelbottom=False)
    if start <= duration_ms < end:
        spectrum.axvline(duration_ms / 1000, color='#69cfff', linewidth=1, linestyle='--')
        spectrum.text(duration_ms / 1000, 126, ' Audio EOF; source frontend right-pads',
                      color='#1681a5', fontsize=8, va='top', clip_on=True)
    colors = ['#2768a6', '#27836f', '#ad5c28', '#8154a1']
    for note in payload['notes']:
        x, tail, lane = note['startMs'], note['endMs'], note['column']
        if note['kind'] == 'long':
            notes.plot([max(start, x) / 1000, min(end, tail) / 1000], [lane, lane],
                       color=colors[lane], linewidth=5, alpha=0.5, solid_capstyle='butt')
            if start <= tail < end:
                notes.plot(tail / 1000, lane, 'o', markerfacecolor='white',
                           markeredgecolor=colors[lane], markersize=5)
        if start <= x < end:
            notes.plot(x / 1000, lane, 'o', color=colors[lane], markersize=4)
    notes.set_yticks(range(4), labels=['1', '2', '3', '4'])
    notes.set_ylim(3.5, -0.5)
    notes.set_ylabel('Column (1-based)')
    notes.set_xlim(start / 1000, end / 1000)
    notes.set_xlabel('Source time (seconds, audio file origin; no AudioLeadIn shift)')
    notes.xaxis.set_major_formatter(ScalarFormatter(useOffset=False))
    notes.grid(axis='x', color='#999999', alpha=0.25)
    notes.grid(axis='y', color='#999999', alpha=0.15)
    notes.legend(handles=[Line2D([], [], marker='o', color='#555', linestyle='', markersize=4, label='Attack'),
                          Line2D([], [], color='#555', linewidth=5, alpha=0.5, label='Hold'),
                          Line2D([], [], marker='o', markerfacecolor='white', markeredgecolor='#555',
                                 linestyle='', markersize=5, label='Release')],
                 loc='lower right', bbox_to_anchor=(1, 1), ncol=3, framealpha=0.9, fontsize=8)
    source = payload['source']
    fig.suptitle(f"{source.get('title', '')} [{source.get('difficulty', '')}]   |   [{start}, {end}) ms\n"
                 'Full-track peak normalization · fixed color scale · Mel view, not playback or a style verdict',
                 fontsize=12)
    fig.savefig(target, dpi=150)
    plt.close(fig)


if __name__ == '__main__':
    if sys.argv[1:] != ['--extract']:
        raise SystemExit('Use beatmap-learning.py audio to create a source-bound Mel view.')
    print(json.dumps(_extract(json.load(sys.stdin)), ensure_ascii=False))
