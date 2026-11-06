import { execFileSync } from 'node:child_process';
import type { Page } from 'playwright';

// The marker is part of the recorded image. Navigation time, browser clock origins and
// encoder startup delays therefore do not need to be estimated from wall time.
export async function armAlignment(page: Page, visible: string) {
  await page.evaluate((expression) => {
    const observe = new Function('return (' + expression + ')');
    if (observe()) throw new Error('Alignment event was already active when armed.');
    const marker = document.createElement('canvas');
    marker.width = 32;
    marker.height = 16;
    marker.style.cssText =
      'position:fixed;top:0;left:0;width:32px;height:16px;pointer-events:none;z-index:2147483647';
    const ctx = marker.getContext('2d')!;
    let seen = false;
    let previous = false;
    function frame() {
      const active = Boolean(observe());
      if (active && !previous) {
        if (seen) throw new Error('Alignment event repeated during capture.');
        seen = true;
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(0, 0, 16, 16);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(16, 0, 16, 16);
        document.documentElement.appendChild(marker);
      }
      previous = active;
      requestAnimationFrame(frame);
    }
    frame();
  }, visible);
}

export function readAlignment(video: string) {
  const timestamps: number[] = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_frames',
        '-show_entries',
        'frame=best_effort_timestamp_time',
        '-of',
        'json',
        video,
      ],
      { encoding: 'utf8' },
    ),
  ).frames.map((f: any) => Number(f.best_effort_timestamp_time) * 1000);
  const pixels = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    video,
    '-vf',
    'crop=32:16:0:0,format=rgb24,scale=2:1:flags=area',
    '-fps_mode',
    'passthrough',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  if (
    pixels.length !== timestamps.length * 6 ||
    !timestamps.length ||
    timestamps.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= timestamps[i - 1]))
  )
    throw new Error('Cannot correlate marker pixels with video presentation timestamps.');
  const marked = timestamps.map((_, i) => {
    const [r, g, b, r2, g2, b2] = pixels.subarray(i * 6, i * 6 + 6);
    return r > 175 && b > 175 && g < 80 && g2 > 175 && r2 < 80 && b2 < 80;
  });
  const first = marked.indexOf(true);
  if (first < 1 || marked.slice(first).includes(false))
    throw new Error('Video lacks a unique observable alignment-marker onset.');
  return {
    anchorMs: timestamps[first],
    previousFrameMs: timestamps[first - 1],
    frameTimesMs: timestamps,
    method: 'first-marked-video-frame',
  };
}
