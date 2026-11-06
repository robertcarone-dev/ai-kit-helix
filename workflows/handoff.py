"""Package one verified recording and agent/designer annotations, without an Editor or browser."""
import hashlib
import json
import os
import shlex
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED


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
        print(json.dumps(package(*(Path(arg) for arg in sys.argv[1:4]), viewports=json.loads(sys.argv[4]) if len(sys.argv) > 4 else {})))
    except (OSError, KeyError, ValueError, TypeError) as error:
        sys.exit(str(error))
