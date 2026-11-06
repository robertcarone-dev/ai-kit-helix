"""Package one verified recording and agent/designer annotations, without an Editor or browser."""
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED


def package(folder, note_file, destination):
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
                  "", "Replay in the source checkout with a fresh output path:", "",
                  f"`Tools/Helix/bin/helix fixture-record {fixture['id']} --out .helix/replay/{fixture['id']}`"])
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
        print(json.dumps(package(*(Path(arg) for arg in sys.argv[1:]))))
    except (OSError, KeyError, ValueError, TypeError) as error:
        sys.exit(str(error))
