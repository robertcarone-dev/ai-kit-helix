"""Project-independent evidence hashing, ledger and frame inspection."""
import hashlib
import json
import struct
from pathlib import Path

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def inside(path, parent):
    path, parent = Path(path).resolve(), Path(parent).resolve()
    if not path.is_relative_to(parent) or path == parent:
        raise ValueError(f'Path must be inside {parent}: {path}')
    return path


def fresh(path):
    path = Path(path).resolve()
    if path.exists() and any(path.iterdir()):
        raise ValueError(f'Output must be empty: {path}')
    path.mkdir(parents=True, exist_ok=True)
    return path


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def ledger_check(ledger_path, inputs_path):
    ledger_path = Path(ledger_path).resolve()
    ledger, current = read(ledger_path), read(inputs_path)
    results, seen = [], set()
    for case in ledger['cases']:
        key = case['id']
        if key in seen:
            raise ValueError(f'Duplicate case ID: {key}')
        seen.add(key)
        previous = case.get('inputs', {})
        now = current.get(key)
        reasons = []
        if not previous or now is None:
            reasons.append('Missing declared dependency inputs')
        elif previous != now:
            reasons.extend('Changed input: ' + k for k in sorted(set(previous) | set(now)) if k not in previous or k not in now or previous[k] != now[k])
        evidence = case.get('evidence', [])
        if not evidence:
            reasons.append('No evidence files')
        for item in evidence:
            path = (ledger_path.parent / item['path']).resolve()
            if not path.is_file() or digest(path) != item.get('sha256'):
                reasons.append('Missing or changed evidence: ' + item['path'])
        results.append({'id': key, 'evidenceReusable': not reasons, 'reasons': reasons,
                        'recordedVerdict': case.get('status', 'unmeasured')})
    return {'cases': results, 'scope': 'Checks declared inputs and evidence integrity only; no new acceptance verdict or dependency-completeness claim.'}


def image_size(path):
    data = Path(path).read_bytes()
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) >= 24:
        return (*struct.unpack('>II', data[16:24]), 'png')
    if not data.startswith(b'\xff\xd8'):
        raise ValueError(f'Unsupported image bytes: {path}')
    pos = 2
    while pos < len(data):
        if data[pos] != 255:
            raise ValueError(f'Invalid JPEG marker: {path}')
        while pos < len(data) and data[pos] == 255:
            pos += 1
        marker = data[pos]
        pos += 1
        if marker in (0xd8, 0xd9) or 0xd0 <= marker <= 0xd7:
            continue
        if marker == 0xda:
            break
        length = int.from_bytes(data[pos:pos+2], 'big')
        if length < 2 or pos + length > len(data):
            break
        if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf):
            h, w = struct.unpack('>HH', data[pos+3:pos+7])
            return w, h, 'jpeg'
        pos += length
    raise ValueError(f'No JPEG frame dimensions: {path}')


def recording_check(path, width, height, first_frame=None, last_frame=None):
    path = Path(path).resolve()
    record = read(path)
    expected = {'width': width, 'height': height}
    if record.get('screen') != expected or record.get('frameSize') != expected:
        raise ValueError('Recording source or saved dimensions differ from requested native dimensions')
    frames = record.get('frames', [])
    if not frames:
        raise ValueError('Recording has no frames')
    formats, hashes, numbers, times = set(), {}, [], []
    for frame in frames:
        image = inside(path.parent / frame['file'], path.parent)
        w, h, kind = image_size(image)
        if (w, h) != (width, height):
            raise ValueError(f'Frame is not native: {image}')
        formats.add(kind)
        hashes[frame['file']] = digest(image)
        numbers.append(frame['frame'])
        times.append(frame['t'])
    if any(b <= a for a, b in zip(numbers, numbers[1:])) or any(b < a for a, b in zip(times, times[1:])):
        raise ValueError('Frame numbers or timestamps are not ordered')
    if first_frame is not None and numbers[0] > first_frame:
        raise ValueError('Recording misses the required start frame')
    if last_frame is not None and numbers[-1] < last_frame:
        raise ValueError('Recording misses the required endpoint frame')
    return {'native': True, 'dimensions': expected, 'frames': len(frames), 'formats': sorted(formats),
            'lossy': 'jpeg' in formats, 'firstFrame': numbers[0], 'lastFrame': numbers[-1],
            'maxGapSeconds': max((b-a for a,b in zip(times,times[1:])), default=0),
            'reportedDrops': record.get('droppedFrames', record.get('dropped')),
            'sha256': digest(path), 'frameHashes': hashes,
            'scope': 'Dimensions read from encoded image headers; endpoint coverage checked only when requested. No visual or timing acceptance inferred.'}
