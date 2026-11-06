"""Relate saved-image intervals to Unity frame IDs and optional player-loop samples."""
from bisect import bisect_left, bisect_right
from math import isfinite
from pathlib import Path

from evidence_utils import digest, read


def milliseconds(seconds):
    return round(seconds * 1000, 4)


def ordered_frames(rows, clock):
    previous = None
    for row in rows:
        if type(row['frame']) is not int or not isfinite(row[clock]):
            raise ValueError('Invalid frame number or clock sample')
        if previous and (row['frame'] <= previous['frame'] or row[clock] < previous[clock]):
            raise ValueError('Frame IDs must increase and clock samples must be ordered')
        previous = row
    if not rows:
        raise ValueError('Empty frame sequence')


def marker(document, name):
    matches = [e for e in document['events'] if e['action'] == name]
    if len(matches) != 1 or type(matches[0]['frame']) is not int:
        raise ValueError(f'Expected one frame-numbered event named {name!r}')
    return matches[0]


def load_trace(path):
    data = read(path)
    if data['schemaVersion'] != 1 or data['clock'] != 'monotonic-seconds':
        raise ValueError('Expected a schema 1 monotonic-seconds player-loop trace')
    ordered_frames(data['frames'], 't')
    return data


def trace_interval(samples, ids, start, end):
    observed = samples[bisect_left(ids, start):bisect_right(ids, end)]
    deltas = [(milliseconds(b['t'] - a['t']), a['frame'], b['frame'])
              for a, b in zip(observed, observed[1:]) if b['frame'] == a['frame'] + 1]
    peak = max(deltas) if deltas else None
    return {'coverage': 'complete' if len(observed) == end - start + 1 else 'partial' if observed else 'absent',
            'sampleCount': len(observed), 'longestObservedStep': None if peak is None else
            {'ms': peak[0], 'fromFrame': peak[1], 'toFrame': peak[2]}}


def sample(row):
    return {'file': row['file'], 'frame': row['frame'], 'captureMs': milliseconds(row['t'])}


def visual_runs(path, record, frames, low, high):
    data = read(path)
    if Path(data['record']).name != record['id'] or data['dimensions'] != record['frameSize']:
        raise ValueError('Visual observations belong to a different recording or frame size')
    groups = []
    for obs in (data['samples'] if 'samples' in data else data['navySamples']):
        i = obs['i']
        if type(i) is not int or not 0 <= i < len(frames) or frames[i]['t'] != obs['t']:
            raise ValueError('Visual sample index/time differs from recording')
        if groups and i <= groups[-1][-1]:
            raise ValueError('Visual sample indices must increase')
        if groups and i == groups[-1][-1] + 1:
            groups[-1].append(i)
        else:
            groups.append([i])
    runs = []
    for group in groups:
        a, b = group[0], group[-1]
        if frames[b]['t'] < low or frames[a]['t'] > high:
            continue
        runs.append({'preceding': sample(frames[a-1]) if a else None, 'first': sample(frames[a]),
                     'last': sample(frames[b]), 'following': sample(frames[b+1]) if b+1 < len(frames) else None,
                     'sampleCount': len(group), 'observedSpanMs': milliseconds(frames[b]['t']-frames[a]['t'])})
    return {'method': data['method'], 'sha256': digest(path), 'runs': runs}


def event_window(record, events_path, name, before_ms, after_ms, trace_path=None, visual_path=None, baseline_path=None):
    if record['clock'] != 'realtime' or record.get('fixedFps'):
        raise ValueError('Event-window analysis requires a realtime game recording')
    if min(before_ms, after_ms) < 0 or before_ms + after_ms == 0:
        raise ValueError('Event window needs nonnegative bounds and a positive duration')
    events = read(events_path)
    if events.get('recordingId', record['id']) != record['id']:
        raise ValueError('Event recordingId differs from recording')
    anchor = marker(events, name)
    frames = record['frames']
    ordered_frames(frames, 't')
    ordered_frames(frames, 'unscaledTime')
    ids = [f['frame'] for f in frames]
    if not ids[0] <= anchor['frame'] <= ids[-1]:
        raise ValueError('Event falls outside recorded frame IDs')
    right = bisect_left(ids, anchor['frame'])
    left = right if ids[right] == anchor['frame'] else right-1
    # An unsaved event has a bracket, never an invented interpolated capture time.
    low, high = frames[left]['t'] - before_ms / 1000, frames[right]['t'] + after_ms / 1000
    trace = None
    if trace_path:
        trace = load_trace(trace_path)
        if trace['recordingId'] != record['id'] or marker(trace, name)['frame'] != anchor['frame']:
            raise ValueError('Trace must match recording ID and event frame')
        trace_ids = [row['frame'] for row in trace['frames']]
    intervals = []
    for a, b in zip(frames, frames[1:]):
        if b['t'] <= low or a['t'] >= high:
            continue
        skipped = b['frame'] - a['frame'] - 1
        row = {'from': sample(a), 'to': sample(b), 'captureDeltaMs': milliseconds(b['t']-a['t']),
               'unscaledDeltaMs': milliseconds(b['unscaledTime']-a['unscaledTime']),
               'gameDeltaMs': milliseconds(b['gameTime']-a['gameTime']), 'unsavedUnityFrames': skipped}
        if trace is not None:
            row['playerLoop'] = trace_interval(trace['frames'], trace_ids, a['frame'], b['frame'])
        intervals.append(row)
    if not intervals:
        raise ValueError('No saved-image intervals overlap the requested window')
    report = {'event': anchor, 'eventsSha256': digest(events_path), 'anchorFrameBracket': [ids[left], ids[right]],
              'recordingId': record['id'], 'beforeMs': before_ms, 'afterMs': after_ms,
              'windowFullyRecorded': low >= frames[0]['t'] and high <= frames[-1]['t'],
              'maxFps': record.get('maxFps'), 'longestCaptureInterval': max(intervals, key=lambda r:r['captureDeltaMs']),
              'intervals': intervals}
    adjacent = [r for r in intervals if r['unsavedUnityFrames'] == 0]
    report['longestConsecutiveUnscaledInterval'] = max(adjacent, key=lambda r:r['unscaledDeltaMs']) if adjacent else None
    if visual_path:
        report['visualObservations'] = visual_runs(visual_path, record, frames, low, high)
    if trace_path:
        report['traceSha256'] = digest(trace_path)
        report['traceMarkers'] = [e for e in trace['events'] if intervals[0]['from']['frame'] <= e['frame'] <= intervals[-1]['to']['frame']]
    if baseline_path:
        baseline = load_trace(baseline_path)
        if baseline['recordingId'] is not None:
            raise ValueError('Comparison trace must be from an image-capture-disabled replay')
        event = marker(baseline, name)
        samples = baseline['frames']
        lo, hi = event['t'] - before_ms/1000, event['t'] + after_ms/1000
        pairs = [(a,b) for a,b in zip(samples,samples[1:]) if a['t'] < hi and b['t'] > lo]
        if not pairs or not samples[0]['frame'] <= event['frame'] <= samples[-1]['frame']:
            raise ValueError('Comparison trace has no coverage for this event window')
        report['traceOnlyReplay'] = {**trace_interval(samples, [s['frame'] for s in samples], pairs[0][0]['frame'], pairs[-1][1]['frame']),
            'event':event,'sha256':digest(baseline_path),'windowFullyRecorded':samples[0]['t'] <= lo and samples[-1]['t'] >= hi}
    return report
