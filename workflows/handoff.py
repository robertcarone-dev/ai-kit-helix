"""Package one verified recording and agent/designer annotations, without an Editor or browser."""
from bisect import bisect_right
import hashlib
import json
import os
import shlex
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED


def aligned_picks(motion, notes):
    alignment = motion["alignment"]
    times = alignment["frameTimesMs"]
    anchor = alignment["anchorMs"]
    previous = alignment["previousFrameMs"]
    if not times or times[0] < 0 or times[-1] > 125000:
        raise ValueError("Event alignment exceeds the recorder's supported session duration.")
    index = bisect_right(times, anchor) - 1
    if not (0 < index < len(times) and times[index] == anchor and times[index-1] == previous and
            all(b > a >= 0 for a, b in zip(times, times[1:])) and alignment["method"] == "first-marked-video-frame"):
        raise ValueError("Invalid video alignment timeline.")
    picks = []
    for i, note in enumerate(notes):
        if type(note["timeMs"]) is not int or note["timeMs"] < 0 or not isinstance(note["text"], str) or not note["text"].strip():
            raise ValueError("Invalid timestamped handoff note.")
        pick = dict(index=i, timeMs=note["timeMs"], text=note["text"])
        time = note["timeMs"]
        if time < anchor or time > times[-1]:
            pick["status"] = "outside-anchored-recording"
        elif anchor - previous > 100:
            pick["status"] = "anchor-frame-gap"
        else:
            displayed = times[bisect_right(times, time) - 1]
            pick.update(status="ready", displayedFrameMs=displayed, offsetMs=displayed-anchor,
                        latestOffsetMs=displayed-previous)
        picks.append(pick)
    return dict(event=alignment["event"], predicateSha256=alignment["predicateSha256"], unity=alignment["unity"], anchorMs=anchor, picks=picks)


def read_alignment(archive_path):
    with ZipFile(archive_path) as archive:
        handoff = json.loads(archive.read("handoff.json"))
        motion = json.loads(archive.read("motion.json"))
        digest = hashlib.sha256()
        with archive.open("motion.webm") as clip:
            while chunk := clip.read(1024*1024):
                digest.update(chunk)
        if (handoff["clipSha256"] != digest.hexdigest() or motion["sha256"] != digest.hexdigest() or
                handoff["scenario"] != motion["scenario"] or motion["errors"]):
            raise ValueError("Handoff recording identity or integrity mismatch.")
        if "alignment" not in motion:
            raise ValueError("This recording has no event alignment. Record the aligned fixture again.")
        plan = aligned_picks(motion, handoff["notes"])
        if handoff.get("alignment") != plan:
            raise ValueError("Handoff picks disagree with recorded alignment.")
        return dict(**plan, reference={key: motion["referenceIdentity"][key] for key in ("project", "name", "variant", "variantName")},
                    scenario=motion["scenario"], clipSha256=digest.hexdigest())


def package(folder, note_file, destination, viewports=None):
    receipt = json.loads((folder / "motion.json").read_text())
    metadata = folder / "fixture.json"
    # Earlier CLI recordings carry their scenario and identity in motion.json alone.
    fixture = json.loads(metadata.read_text()) if metadata.exists() else {
        "id": receipt["scenario"], "label": receipt["scenario"], "feature": receipt["referenceIdentity"]["project"],
        "clipSha256": receipt["sha256"],
    }
    clip = folder / "motion.webm"
    digest = hashlib.sha256(clip.read_bytes()).hexdigest()
    if receipt["scenario"] != fixture["id"] or digest != receipt["sha256"] or digest != fixture["clipSha256"] or receipt["errors"]:
        raise ValueError("Fixture identity or recorded evidence failed integrity checks.")
    notes = json.loads(note_file.read_text())
    if not isinstance(notes, list) or not notes:
        raise ValueError("Supply an array of timestamped port instructions.")
    for note in notes:
        if type(note["timeMs"]) is not int or note["timeMs"] < 0 or not isinstance(note["text"], str) or not note["text"].strip():
            raise ValueError("Each annotation needs a nonnegative integer timeMs and nonempty text.")
    notes.sort(key=lambda n: n["timeMs"])
    manifest = dict(version=1, scenario=fixture["id"], feature=fixture["feature"], case=fixture["label"],
                    clip="motion.webm", receipt="motion.json", clipSha256=digest, timeBasis="clip-start-ms", notes=notes)
    brief = [f"# {fixture['feature']} — {fixture['label']}", "", "## Port instructions", ""]
    brief.extend(f"- {n['timeMs'] / 1000:.3f} s: {n['text']}" for n in notes)
    brief.extend(["", "Times are measured from the start of motion.webm. Inspect motion.json for source identity, inputs and observed state.",
                  "", "Replay in the source checkout with a fresh output path:", ""])
    cli = "Tools/Helix/bin/helix"
    scenario = shlex.quote(fixture["id"])
    output = shlex.quote(".helix/replay/" + fixture["id"])
    if "viewport" in fixture:  # fixture-record supplies the registered viewport key.
        commands = [f"{cli} fixture-record {scenario} --out {output}"]
    else:
        size = receipt["viewport"]
        viewport = receipt.get("viewportName")
        if viewport is None:
            viewport = next((name for name, dimensions in (viewports or {}).items()
                             if all(dimensions[key] == size[key] for key in ("width", "height"))), None)
        if viewport is None:
            brief.append(f"Use `{cli} fixture-list` to find or configure a {size['width']} × {size['height']} viewport, then set VIEWPORT to its key.")
        viewport_arg = shlex.quote(viewport) if viewport is not None else '"${VIEWPORT:?Set VIEWPORT to the matching key}"'
        brief.append("Use an idle checkout and stop the browser you started when finished.")
        commands = [f"{cli} start --viewport {viewport_arg}", f"{cli} scenario {scenario}",
                    f"{cli} record {scenario} --duration {shlex.quote(str(receipt['durationSeconds']))} --out {output}", f"{cli} stop"]
    brief.extend(["", "```sh", " &&\n".join(commands), "```"])
    if "alignment" in receipt:
        manifest["alignment"] = aligned_picks(receipt, notes)
        brief.extend(["", "For the Unity clip at each selected frame, run:", "",
                      "`Tools/Helix/bin/helix handoff-owner --handoff HANDOFF.zip --unity-project IDLE_ISOLATED_PROJECT --out NEW_DIR`"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as tmp:
        archive_path = Path(tmp) / "handoff.zip"
        with ZipFile(archive_path, "x", ZIP_DEFLATED) as archive:
            for name in ("motion.webm", "motion.json"):
                archive.write(folder / name, name)
            archive.writestr("fixture.json", json.dumps(fixture, indent=2))
            archive.writestr("handoff.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            archive.writestr("README.md", "\n".join(brief) + "\n")
        os.link(archive_path, destination)
    return {"path": str(destination), "scenario": fixture["id"], "notes": len(notes), "clipSha256": digest}


if __name__ == "__main__":
    try:
        if sys.argv[1] == "read-alignment":
            print(json.dumps(read_alignment(sys.argv[2])))
            sys.exit(0)
        print(json.dumps(package(*(Path(arg) for arg in sys.argv[1:4]), viewports=json.loads(sys.argv[4]) if len(sys.argv) > 4 else {})))
    except (OSError, KeyError, ValueError, TypeError) as error:
        sys.exit(str(error))
