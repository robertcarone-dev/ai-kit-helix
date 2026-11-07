"""Offline, timestamped overview and event-window sheets for retained recordings."""
import bisect
import html
import json
import math
from pathlib import Path
import subprocess
import sys

from evidence_utils import digest, fresh, image_size, read, save


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=120).stdout


def recording_sheet(spec_path, out):
    spec_path = Path(spec_path).resolve()
    spec = read(spec_path)
    receipt_path = (spec_path.parent / spec['recording']).resolve()
    receipt = read(receipt_path)
    video = None
    if 'frames' in receipt:
        rows = receipt['frames']
        if not rows:
            raise ValueError('Recording has no frames')
        frames = []
        for row in rows:
            path = (receipt_path.parent / row['file']).resolve()
            if not path.is_relative_to(receipt_path.parent):
                raise ValueError('Frame path escapes recording directory')
            width, height, _ = image_size(path)
            if {'width': width, 'height': height} != receipt['frameSize']:
                raise ValueError('Frame dimensions differ from receipt')
            frames.append(dict(frame=row['frame'], seconds=row['t'], path=str(path), sha256=digest(path)))
    else:
        video = receipt_path.with_name('motion.webm')
        if digest(video) != receipt['sha256']:
            raise ValueError('Video hash differs from motion receipt')
        probe = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                                '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time',
                                '-of', 'json', str(video)]))
        frames = [dict(frame=i, seconds=float(row['best_effort_timestamp_time']))
                  for i, row in enumerate(probe['frames'])]
    if not frames:
        raise ValueError('No decoded frames')
    for i, row in enumerate(frames):
        if type(row['frame']) is not int or not math.isfinite(row['seconds']):
            raise ValueError('Invalid external frame identity or time')
        if i and (row['frame'] <= frames[i-1]['frame'] or row['seconds'] < frames[i-1]['seconds']):
            raise ValueError('Frame identities must increase and times must be ordered')
    event = spec.get('event')
    if event is None:
        return render(frames, video, receipt_path, receipt, out, None, None, set(), None, None, None)
    if not event['name'] or not event['observation'] or type(event['frame']) is not int:
        raise ValueError('Event requires a name, observed-frame description and integer frame')
    matches = [i for i, row in enumerate(frames) if row['frame'] == event['frame']]
    if len(matches) != 1:
        raise ValueError('Event must identify an actual saved or decoded frame')
    anchor = matches[0]
    before, after, interval = spec['beforeMs'], spec['afterMs'], spec.get('intervalMs', 250)
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in (before, after, interval)):
        raise ValueError('Window and sampling values must be finite numbers')
    if min(before, after) < 0 or before + after <= 0 or interval <= 0:
        raise ValueError('Window must be positive with nonnegative bounds and positive interval')
    if (before + after) / interval > 500:
        raise ValueError('Window exceeds 500 sample intervals; narrow it or increase intervalMs')
    times = [row['seconds'] for row in frames]
    low, high = times[anchor] - before/1000, times[anchor] + after/1000
    first, last = bisect.bisect_left(times, low), bisect.bisect_right(times, high)-1
    selected = {first, last, anchor}
    for n in range(math.ceil((high-low)*1000/interval)+1):
        i = bisect.bisect_left(times, low+n*interval/1000)
        if first <= i <= last:
            selected.add(i)
    return render(frames, video, receipt_path, receipt, out, event, anchor, selected, low, high, interval)


def render(frames, video, receipt_path, receipt, out, event, anchor, selected, low, high, interval):
    times = [row['seconds'] for row in frames]
    basis = 'decoded video presentation seconds and zero-based frame ordinals' if video else 'recording capture seconds and Unity frame IDs'
    overview = sorted({round(i*(len(frames)-1)/23) for i in range(24)})
    out = fresh(out)
    indexes = sorted(set(overview) | selected)
    for i in indexes:
        target = out / f'frame-{i:06d}.png'
        if video:
            # Decode by ordinal, preserving the identity even with variable frame rate.
            source = ['-i', str(video), '-vf', f'select=eq(n\\,{i}),scale=240:-1']
        else:
            source = ['-i', frames[i]['path'], '-vf', 'scale=240:-1']
        run(['ffmpeg', '-nostdin', '-v', 'error', *source, '-frames:v', '1', str(target)])
        frames[i]['thumbnail'] = target.name
        frames[i]['thumbnailSha256'] = digest(target)
        frames[i]['relativeMs'] = round((times[i]-times[anchor])*1000, 4) if anchor is not None else None
    report = dict(schemaVersion=1, recording=str(receipt_path), recordingSha256=digest(receipt_path),
                  event=event, timeBasis=basis, requestedWindowSeconds=[low, high],
                  recordedSpanSeconds=[times[0], times[-1]],
                  windowFullyRecorded=low >= times[0] and high <= times[-1] if event else None,
                  intervalMs=interval, overview=[frames[i] for i in overview],
                  window=[frames[i] for i in sorted(selected)],
                  scope='Sampled review aid. Inspect native frames for detail and all event frames for precise timing. Visual acceptance requires human or agent review.')
    if video:
        report['videoSha256'] = receipt['sha256']
    report['pages'] = []
    for kind, ids in [('overview', overview), ('window', sorted(selected))]:
        for offset in range(0, len(ids), 12):
            page_ids = ids[offset:offset+12]
            name = f'{kind}-{offset//12+1:02d}'
            listing = out/(name+'.txt')
            listing.write_text(''.join(f"file 'frame-{i:06d}.png'\n" for i in page_ids))
            run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', str(listing),
                 '-vf', 'tile=4x3', '-frames:v', '1', str(out/(name+'.png'))])
            report['pages'].append(dict(file=name+'.png', frames=[frames[i]['frame'] for i in page_ids],
                                       sha256=digest(out/(name+'.png'))))
    save(out/'sheet.json', report)
    coverage = ('Full requested window recorded' if report['windowFullyRecorded'] else 'INCOMPLETE requested window') if event else 'Overview only; locate an event before requesting its window'
    parts = ['<!doctype html><meta charset="utf-8"><title>Recording event review</title>',
             '<style>body{font:16px system-ui;background:#151515;color:#eee}section{display:flex;flex-wrap:wrap;gap:16px}figure{margin:0;width:240px}img{width:240px}figcaption{padding:8px 0}</style>',
             '<h1>'+html.escape(event['name'] if event else 'Recording overview')+'</h1><p>'+coverage+'</p><p>'+html.escape(event['observation'] if event else 'Inspect every overview page and the final frame.')+'</p>']
    for name, ids in [('Full recording overview', overview), ('Event window', sorted(selected))]:
        if not ids:
            continue
        parts.append('<h2>'+name+'</h2><section>')
        for i in ids:
            row = frames[i]
            offset = f' · event {row["relativeMs"]:+.1f}ms' if event else ''
            parts.append(f'<figure><img src="{row["thumbnail"]}"><figcaption>Frame {row["frame"]} · {row["seconds"]:.4f}s{offset}</figcaption></figure>')
        parts.append('</section>')
    parts.append('<p>'+html.escape(report['scope'])+'</p>')
    (out/'index.html').write_text('\n'.join(parts))
    return dict(report=str(out/'sheet.json'), sheet=str(out/'index.html'), windowFullyRecorded=report['windowFullyRecorded'])


if __name__ == '__main__':
    try:
        print(json.dumps(recording_sheet(sys.argv[1], sys.argv[2]), indent=2))
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
