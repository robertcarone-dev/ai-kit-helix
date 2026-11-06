"""Build a diagnostic event-relative filmstrip from existing render captures."""
import bisect
import html
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

from evidence_utils import digest, image_size, inside, read, save


def require(condition, message):
    if not condition:
        raise ValueError(message)


def milliseconds(value):
    require(type(value) in (float, int) and math.isfinite(value), "Expected a finite time in milliseconds")
    return value


def execute(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise ValueError(result.stderr.strip() or f"{args[0]} exited {result.returncode}")
    return result.stdout


def inventory(side, descriptor, base):
    receipt = (base / descriptor["receipt"]).resolve()
    require(digest(receipt) == descriptor["sha256"], f"{side}: receipt hash mismatch")
    data = read(receipt)
    info = {"receipt": str(receipt), "receiptSha256": descriptor["sha256"], "anchor": descriptor["anchor"]}
    if side == "reference":
        clip = receipt.with_name("motion.webm")
        require(digest(clip) == data["sha256"] and not data["errors"], "Reference clip integrity/browser error")
        probe = json.loads(execute(["ffprobe", "-v", "error", "-protocol_whitelist","file","-f","matroska","-select_streams", "v:0", "-show_entries",
            "frame=best_effort_timestamp_time:stream=width,height", "-of", "json", str(clip)]))
        times = [float(f["best_effort_timestamp_time"]) * 1000 for f in probe["frames"]]
        ids = list(range(len(times)))
        size = {k:probe["streams"][0][k] for k in ("width","height")}
        require(size == data["encoded"], "Encoded size differs from the receipt")
        info.update(clock="encoded presentation time", screen=data["viewport"], size=size, scenario=data["scenario"],
                    clipSha256=data["sha256"], source=data["referenceIdentity"])
        files = None
    else:
        require(not data["error"] and data["endedBy"] in ("duration", "stopped"), "Incomplete Unity recording")
        frames = data["frames"]
        times = [milliseconds(f["t"]) * 1000 for f in frames]
        ids = [f["frame"] for f in frames]
        require(all(type(i) is int for i in ids) and all(b > a for a,b in zip(ids,ids[1:])), "Invalid Unity frame order")
        files = [inside(receipt.parent / f["file"], receipt.parent) for f in frames]
        info.update(clock=data["clock"], source=data["source"], screen=data["screen"], size=data["frameSize"],
                    recordingId=data["id"], droppedFrames=data["droppedFrames"])
    require(times and all(math.isfinite(t) for t in times) and all(b > a for a,b in zip(times,times[1:])),
            f"{side}: frame timestamps must strictly increase")
    anchor = descriptor["anchor"]
    require(isinstance(anchor["observation"], str) and anchor["observation"].strip(), "Describe the observed event")
    require(type(anchor["frame"]) is int and anchor["frame"] in ids, f"{side}: anchor is not a saved frame")
    index = ids.index(anchor["frame"])
    info.update(anchorTimeMs=times[index], precedingAnchorGapMs=times[index]-times[index-1] if index else None,
                nativeDimensions=info["screen"] == info["size"])
    if "crop" in descriptor:
        rect = descriptor["crop"]
        require(len(rect) == 4 and all(type(v) is int for v in rect), "Expected pixel crop [x,y,width,height]")
        x,y,w,h = rect
        require(min(x,y) >= 0 and min(w,h) > 0 and x+w <= info["size"]["width"] and y+h <= info["size"]["height"],
                f"{side}: crop outside encoded frames")
        info["crop"] = rect
    return info, times, ids, files


def samples(info, times, ids, beats, max_gap):
    rows = []
    selected = set()
    for beat in beats:
        target = info["anchorTimeMs"] + beat["offsetMs"]
        right = bisect.bisect_left(times, target)
        exact = right < len(times) and abs(times[right]-target) < 0.000001
        indices = [right] if exact else [n for n in (right-1,right) if 0 <= n < len(times)]
        bracketed = exact or len(indices) == 2
        gap = times[indices[-1]]-times[indices[0]] if bracketed else None
        frames = [{"index": n, "frame": ids[n], "timeMs": times[n], "eventOffsetMs": times[n]-info["anchorTimeMs"]} for n in indices]
        selected.update(indices)
        status = "sampled" if bracketed and gap <= max_gap else "unmeasured"
        rows.append({**beat, "frames": frames, "gapMs": gap, "status":status,
                     "reason": "outside-recording" if not bracketed else "sampling-gap" if gap > max_gap else None})
    return rows, sorted(selected)


def retain(side, info, files, indices, output):
    folder = output / side
    folder.mkdir()
    if files is None:
        select = "+".join(f"eq(n\\,{n})" for n in indices)
        execute(["ffmpeg","-nostdin","-v","error","-protocol_whitelist","file","-f","matroska","-i",str(Path(info["receipt"]).with_name("motion.webm")),
                 "-map","0:v:0","-vf","select="+select,"-fps_mode","passthrough","-start_number","0",str(folder/"%04d.png")])
    result = {}
    for sequence,n in enumerate(indices):
        if files is None:
            image = folder / f"{sequence:04d}.png"
        else:
            image = folder / (str(n) + files[n].suffix.lower())
            shutil.copyfile(files[n],image)
        w,h,_ = image_size(image)
        require((w,h) == (info["size"]["width"],info["size"]["height"]), f"{side}: saved frame size mismatch")
        result[n] = {"image": image.relative_to(output).as_posix(), "sha256": digest(image)}
    return result


def render(report):
    esc = html.escape
    content = ['<!doctype html><meta charset="utf-8"><title>Transient VFX comparison</title>',
        '<style>body{font:15px system-ui;margin:2rem;background:#f6f7f4;color:#182622}article{display:flex;gap:2rem;flex-wrap:wrap}section{margin-bottom:1rem}figure{display:inline-block;margin:0 .6rem .5rem 0}img,svg{display:block;max-width:22vw;height:260px}figcaption{font:12px monospace}h3{margin-bottom:.3rem}</style>',
        '<h1>'+esc(report["caseId"])+'</h1>', '<p>Event: '+esc(report["event"])+'</p>', '<p>'+esc(report["scope"])+'</p>']
    for i,beat in enumerate(report["beats"]):
        content.append(f'<h2>{esc(beat["name"])} · {beat["offsetMs"]:+g} ms</h2><article>')
        for side in ("reference","candidate"):
            if side not in report["sides"]:
                content.append('<section><h3>Unity</h3>Unmeasured — no candidate recording</section>')
                continue
            info = report["sides"][side]
            row = info["samples"][i]
            screen, size = info["screen"], info["size"]
            content.append(f'<section><h3>{side.title()} · {row["status"]}</h3><p>{esc(info["clock"])} · {esc(info["anchor"]["observation"])}<br>Saved {size["width"]} × {size["height"]} of {screen["width"]} × {screen["height"]} · preceding anchor gap {info["precedingAnchorGapMs"]} ms<br>Bracket gap: {row["gapMs"]} ms · {row["reason"] or "in coverage"}</p>')
            for frame in row["frames"]:
                src = esc(frame["image"], quote=True)
                content.append(f'<figure><a href="{src}"><img src="{src}" alt="Rendered frame"></a>')
                if "crop" in info:
                    box = " ".join(map(str,info["crop"]))
                    size = info["size"]
                    content.append(f'<svg viewBox="{box}" aria-label="Region of interest"><image href="{src}" width="{size["width"]}" height="{size["height"]}"/></svg>')
                content.append(f'<figcaption>Frame {frame["frame"]} · {frame["eventOffsetMs"]:+.1f} ms</figcaption></figure>')
            content.append('</section>')
        content.append('</article>')
    return '\n'.join(content)


def compare(spec_file, output):
    spec = read(spec_file)
    require(spec["schemaVersion"] == 1 and all(isinstance(spec[k],str) and spec[k].strip() for k in ("event","caseId")),
            "Expected schemaVersion 1, event and caseId")
    beats = spec["beats"]
    require(isinstance(beats,list) and 1 <= len(beats) <= 64, "Specify 1–64 named event-relative beats")
    for beat in beats:
        require(isinstance(beat["name"],str) and beat["name"].strip(), "Missing beat name")
        milliseconds(beat["offsetMs"])
    limit = milliseconds(spec["maxGapMs"])
    require(limit >= 0, "maxGapMs must be nonnegative")
    report = {"schemaVersion":1, "caseId":spec["caseId"], "event":spec["event"], "specSha256":digest(spec_file),
              "beats":beats, "maxGapMs":limit, "sides":{}, "scope":"Rendered-frame evidence anchored to the declared observed event. Encoded frames may repeat. Sampling coverage alone does not establish visual parity or simulation timing."}
    output.mkdir(parents=True,exist_ok=False)
    for side in (["reference","candidate"] if "candidate" in spec else ["reference"]):
        info,times,ids,files = inventory(side,spec[side],spec_file.parent)
        rows,indices = samples(info,times,ids,beats,limit)
        retained = retain(side,info,files,indices,output)
        for row in rows:
            for frame in row["frames"]:
                frame.update(retained[frame["index"]])
        report["sides"][side] = {**info, "samples":rows}
    report["coverage"] = [{"beat":b["name"], "status":"paired-samples" if len(report["sides"]) == 2 and
        all(info["samples"][i]["status"] == "sampled" for info in report["sides"].values()) else "unmeasured"} for i,b in enumerate(beats)]
    save(output / "report.json",report)
    (output / "index.html").write_text(render(report))
    return {"report":str(output/"report.json"),"filmstrip":str(output/"index.html"),"coverage":report["coverage"]}


if __name__ == "__main__":
    try:
        print(json.dumps(compare(*(Path(a).resolve() for a in sys.argv[1:]))))
    except (OSError,KeyError,TypeError,ValueError,subprocess.TimeoutExpired) as error:
        sys.exit(str(error))
