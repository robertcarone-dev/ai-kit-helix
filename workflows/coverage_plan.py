"""Plan missing reference and candidate captures from pinned, annotated evidence."""
import hashlib
import json
import subprocess
import sys
from contextlib import ExitStack
from pathlib import Path, PurePosixPath
from zipfile import BadZipFile, ZipFile

from evidence_utils import digest, fresh, image_dimensions, inside, read, save
from recovery import Board, attachment_path
from workflow import owner_root


def dimensions(size):
    pair = [size["width"], size["height"]]
    if any(type(n) is not int or n <= 0 for n in pair):
        raise ValueError("Invalid capture dimensions")
    return pair


def unique(values, label):
    if not isinstance(values, list) or not values or any(not isinstance(v, str) or not v for v in values) or len(set(values)) != len(values):
        raise ValueError("Expected distinct nonempty " + label)
    return values


class Files:
    def __init__(self, root, archives, stack):
        self.root = root
        self.archives = archives
        self.handles = {}
        self.stack = stack
        self.board = Board(owner_root(root), None)

    def member(self, name, archives):
        for key in archives:
            try:
                return self.get({"path": name, "archive": key})
            except KeyError:
                if key not in self.handles:
                    raise
        raise ValueError("Missing archived frame: " + name)

    def get(self, location):
        name = location["path"]
        if not name or PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts:
            raise ValueError("Expected a relative artifact path")
        if "archive" in location:
            key = location["archive"]
            if key not in self.handles:
                pin = self.archives[key]
                folder, attachments = self.board.issue(pin["attachment"].split("#")[0])
                matches = [a for a in attachments if a["id"] == pin["attachment"] and a["sha256"] == pin["sha256"]]
                if len(matches) != 1:
                    raise ValueError("Board attachment unavailable or changed: " + pin["attachment"])
                self.handles[key] = self.stack.enter_context(ZipFile(attachment_path(folder, matches[0])))
            return self.handles[key].read(name)
        data = inside(self.root / name, self.root).read_bytes()
        if hashlib.sha256(data).hexdigest() != location["sha256"]:
            raise ValueError("Evidence digest changed: " + name)
        return data


def inspect(files, item):
    receipt = json.loads(files.get(item["receipt"]))
    if receipt.get("errors") or receipt.get("error"):
        raise ValueError("Recorder reported errors")
    kind, side = item["kind"], item["side"]
    if kind == "motion" and side == "unity":
        logical = dimensions(receipt["screen"])
        saved = dimensions(receipt["frameSize"])
        if not receipt["frames"] or receipt["droppedFrames"]:
            raise ValueError("Recording has missing or dropped frames")
        last = None
        for frame in receipt["frames"]:
            location = dict(item["receipt"], path=str(PurePosixPath(item["receipt"]["path"]).parent / frame["file"]))
            if "archive" not in location:
                location["sha256"] = item["frameHashes"][frame["file"]]
            data = files.member(location["path"], item["frameArchives"]) if "frameArchives" in item else files.get(location)
            if list(image_dimensions(data)[:2]) != saved:
                raise ValueError("Frame size disagrees with recording receipt")
            if last is not None and (frame["t"] <= last["t"] or frame["frame"] <= last["frame"]):
                raise ValueError("Recording frame order is ambiguous")
            last = frame
    else:
        media = files.get(item["media"])
        if hashlib.sha256(media).hexdigest() != receipt["sha256"]:
            raise ValueError("Media does not match receipt")
        if kind == "motion":
            logical = dimensions(receipt["viewport"])
            result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                                     "-of", "json", "pipe:0"], input=media, capture_output=True, check=True)
            saved = dimensions(json.loads(result.stdout)["streams"][0])
            if saved != dimensions(receipt["encoded"]):
                raise ValueError("Encoded dimensions disagree with receipt")
        else:
            logical = dimensions(receipt["native"])
            saved = list(image_dimensions(media)[:2])
            if saved != logical:
                raise ValueError("Still dimensions disagree with receipt")
    for pointer, expected in item["checks"].items():
        value = receipt
        for part in pointer.split("."):
            value = value[int(part)] if isinstance(value, list) else value[part]
        if value != expected:
            raise ValueError("Receipt predicate differs: " + pointer)
    return logical, saved, receipt


def observed(rule, receipt):
    """Recognize one action sequence without crossing a different player input."""
    patterns = rule["orderedSetup"]
    setup = receipt["setup"]
    def matches(step, pattern):
        return step["status"] == "completed" and all(step.get(k) == v for k, v in pattern.items())
    for start, step in enumerate(setup):
        if not matches(step, patterns[0]):
            continue
        index = 1
        for step in setup[start + 1:]:
            if index == len(patterns):
                break
            if matches(step, patterns[index]):
                index += 1
            elif step["kind"] in ("press", "drag", "hover", "pointerDown", "pointerUp", "wheel"):
                break
        if index == len(patterns):
            return True
    return False


def main(spec_path, output, root, basis, extra=None):
    spec, root = read(spec_path), Path(root)
    if spec["schemaVersion"] != 1 or basis not in ("retained", "current"):
        raise ValueError("Expected coverage schema 1 and basis retained or current")
    inventories = [read(inside(Path(spec_path).parent / name, root)) for name in spec["inventories"]]
    if extra:
        inventories.append(read(extra))
    archives, evidence = {}, []
    for inventory in inventories:
        if inventory["schemaVersion"] != 1 or inventory["feature"] != spec["feature"]:
            raise ValueError("Inventory feature or schema mismatch")
        for key, pin in inventory.get("archives", {}).items():
            if key in archives and archives[key] != pin:
                raise ValueError("Conflicting archive pin: " + key)
            archives[key] = pin
        evidence.extend(inventory["evidence"])
    if evidence:
        unique([e["id"] for e in evidence], "evidence IDs")
    requirements = spec["requirements"]
    unique([r["id"] for r in requirements], "requirement IDs")
    moments = {}
    for req in requirements:
        if req["kind"] not in ("motion", "still") or not req["state"]:
            raise ValueError("Each requirement needs a capture kind and a state")
        for moment in unique(req["moments"], "moments"):
            key = req["id"] + "/" + moment
            if key in moments:
                raise ValueError("Duplicate moment: " + key)
            moments[key] = req
    if not spec["viewports"]:
        raise ValueError("Declare at least one viewport")
    views = {v: dimensions(size) for v, size in spec["viewports"].items()}
    tolerance = spec.get("motionEncoderTolerancePx", 0)
    if type(tolerance) is not int or tolerance < 0:
        raise ValueError("Expected a nonnegative motion encoder tolerance")
    rules = spec.get("helixMotionRules", [])
    for rule in rules:
        if not rule["orderedSetup"] or any(not isinstance(p, dict) or not p for p in rule["orderedSetup"]) or any(m not in moments or moments[m]["kind"] != "motion" for m in unique(rule["covers"], "rule moments")):
            raise ValueError("Invalid Helix motion rule")
    catalogue = []
    with ExitStack() as stack:
        files = Files(root, archives, stack)
        for item in evidence:
            derive = item.get("deriveHelixMotion", False)
            covers = unique(item["covers"], "covered moments") if "covers" in item else []
            if not covers and not derive:
                raise ValueError("Declare coverage annotations or enable Helix motion rules")
            if derive and (not rules or (item["side"], item["kind"]) != ("helix", "motion")):
                raise ValueError("Motion rules require a Helix recording")
            if item["view"] not in views or item["side"] not in ("helix", "unity") or any(k not in moments or moments[k]["kind"] != item["kind"] for k in covers):
                raise ValueError("Unknown viewport, side or coverage claim: " + item["id"])
            row = {k: item[k] for k in ("id", "view", "side", "kind", "state", "receipt", "observation")}
            row["covers"] = list(covers)
            catalogue.append(row)
            try:
                logical, saved, receipt = inspect(files, item)
                if derive:
                    matches = [m for rule in rules if observed(rule, receipt) for m in rule["covers"]]
                    row["covers"] = sorted(set(covers + matches))
                row.update(logical=logical, saved=saved)
                expected = views[item["view"]]
                if logical != expected or any(not 0 <= a-b <= (tolerance if item["kind"] == "motion" else 0) for a,b in zip(expected,saved)):
                    row.update(status="context-only", reason="Capture dimensions differ from required viewport")
                    continue
                if not any(moments[m]["state"] == item["state"] for m in row["covers"]):
                    row.update(status="context-only", reason="No required moment matches the recorded state and observations")
                    continue
                inputs = item.get("captureInputs", {})
                changed = [p for p, h in inputs.items() if not (root/p).is_file() or digest(inside(root/p, root)) != h]
                if changed:
                    row.update(status="historical", reason="Capture inputs changed: " + ", ".join(changed))
                elif inputs:
                    row.update(status="current", reason="Declared capture inputs match")
                else:
                    row.update(status="historical", reason="Capture-time dependency hashes unavailable")
            except (OSError, ValueError, KeyError, IndexError, BadZipFile, subprocess.CalledProcessError) as exc:
                row.update(status="unavailable", reason=str(exc))
    allowed = {"current", "historical"} if basis == "retained" else {"current"}
    plan = {}
    for view in views:
        plan[view] = {}
        for side in ("helix", "unity"):
            capture, reuse = [], {}
            for key, req in moments.items():
                usable = [e["id"] for e in catalogue if e["side"] == side and e["view"] == view and key in e["covers"] and
                          e["state"] == req["state"] and e["status"] in allowed]
                if usable:
                    reuse[key] = usable
                else:
                    capture.append(key)
            plan[view][side] = dict(capture=capture, reuse=reuse)
    pairs = {view: {k: ("paired-for-review" if k in sides["helix"]["reuse"] and k in sides["unity"]["reuse"] else "capture-required")
                    for k in moments} for view,sides in plan.items()}
    report = dict(schemaVersion=1, feature=spec["feature"], basis=basis, viewports=spec["viewports"], requirements=requirements,
                  specSha256=digest(spec_path), archives=archives, evidence=catalogue, plan=plan, comparisons=pairs, review=spec.get("review", []))
    folder = fresh(output)
    save(folder/"coverage.json", report)
    return dict(reportPath=str(folder/"coverage.json"), basis=basis, captureCounts={v:{s:len(d["capture"]) for s,d in sides.items()} for v,sides in plan.items()})


if __name__ == "__main__":
    try:
        print(json.dumps(main(*sys.argv[1:])))
    except (OSError, KeyError, ValueError, TypeError) as error:
        sys.exit(str(error))
