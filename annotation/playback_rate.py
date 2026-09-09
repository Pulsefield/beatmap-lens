"""Supported annotation playback rates; source coordinates never change."""

SUPPORTED_PLAYBACK_RATES = (0.5, 0.75, 1, 1.25, 1.5)


def normalize_playback_rate(value=None):
    """Missing rate means historical 1x; accept only supported numeric values."""
    if value is None:
        return 1
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value not in SUPPORTED_PLAYBACK_RATES:
        raise ValueError('playbackRate must be one of 0.5, 0.75, 1, 1.25, 1.5')
    return value


def playback_rate_fields(record):
    """Preserve optional-field shape for historical 1x records."""
    rate = normalize_playback_rate(record.get('playbackRate'))
    return {'playbackRate': rate} if 'playbackRate' in record or rate != 1 else {}


def same_playback_rate(first, second):
    return normalize_playback_rate(first.get('playbackRate')) == normalize_playback_rate(second.get('playbackRate'))
