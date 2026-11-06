"""Recover pinned evidence from the receiving lane's AI Kit board. Never restore source dependencies."""
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

from delivery import digest, verify_package
from evidence_utils import inside, read
from workflow import owner_root


def attachment_path(issue, attachment):
    directory = inside(issue / "attachments", issue)
    path = inside(directory / attachment["file"], directory)
    if path.stat().st_size != attachment["bytes"] or digest(path) != attachment["sha256"]:
        raise ValueError("Attachment bytes differ from board metadata: " + attachment["id"])
    return path


class Board:
    def __init__(self, owner, temp):
        self.owner = owner
        self.temp = temp
        self.archives = {}
        self.issues = {}

    def issue(self, key):
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9]*-[0-9]+", key):
            raise ValueError("Invalid board issue: " + key)
        if key not in self.issues:
            folder = inside(self.owner / ".aikit/assistant/issues" / key, self.owner)
            data = read(inside(folder / "issue.json", folder))
            if data["key"] != key:
                raise ValueError("Board issue identity mismatch")
            self.issues[key] = folder, data["attachments"]
        return self.issues[key]

    def archive(self, folder, attachments, manifest, record):
        key = record["sha256"]
        if key in self.archives:
            return self.archives[key]
        directory = Path(tempfile.mkdtemp(dir=self.temp))
        shutil.copyfile(attachment_path(folder, record), directory / "manifest.json")
        for part in manifest["parts"]:
            if not re.fullmatch(r"evidence\.zip\.part\d{3,}", part["path"]):
                raise ValueError("Invalid archive part name")
            matches = [a for a in attachments if a["sha256"] == part["sha256"]]
            if not matches:
                raise ValueError("Missing archive part " + part["path"])
            shutil.copyfile(attachment_path(folder, matches[0]), directory / part["path"])
        verify_package(directory)
        path = directory / "archive.zip"
        with path.open("xb") as stream:
            for part in manifest["parts"]:
                with (directory / part["path"]).open("rb") as source:
                    shutil.copyfileobj(source, stream)
        if digest(path) != manifest["archiveSha256"]:
            raise ValueError("Reassembled archive digest mismatch")
        self.archives[key] = path
        return path

    def fetch(self, evidence, issue_hint, staged):
        locator = evidence.get("recovery")
        if locator:
            key, _ = locator["attachment"].split("#")
        elif issue_hint:
            key = issue_hint
        else:
            # Legacy text can identify a board to search, never the bytes to trust.
            hint = evidence.get("recoverFrom", "")
            keys = set(re.findall(r"(?<![\w-])[A-Z][A-Z0-9]*-[0-9]+(?![\w-])", hint))
            keys = {candidate for candidate in keys if (self.owner / ".aikit/assistant/issues" / candidate / "issue.json").is_file()}
            if len(keys) != 1:
                raise ValueError("No unique source issue in recovery hint; supply --issue for verified content lookup")
            key = keys.pop()
        folder, attachments = self.issue(key)
        if locator:
            records = [a for a in attachments if a["id"] == locator["attachment"]]
            if len(records) != 1:
                raise ValueError("Expected one exact board attachment: " + locator["attachment"])
        else:
            records = attachments
        wanted = evidence["sha256"]
        if not locator or "member" not in locator:
            for record in records:
                if record["sha256"] == wanted:
                    shutil.copyfile(attachment_path(folder, record), staged)
                    return {"attachment": record["id"]}
            if locator:
                raise ValueError("Direct attachment digest differs from evidence pin")
        diagnostics = []
        for record in records:
            if not locator and record["title"] != "manifest.json":
                continue
            try:
                manifest = read(attachment_path(folder, record))
                if manifest["schemaVersion"] != 1:
                    raise ValueError("Unsupported package format")
                for item in manifest["payloads"]:
                    member = item["path"]
                    if item["sha256"] != wanted or (locator and member != locator["member"]):
                        continue
                    path = self.archive(folder, attachments, manifest, record)
                    with zipfile.ZipFile(path) as archive:
                        entries = [i for i in archive.infolist() if i.filename == member]
                        if len(entries) != 1 or entries[0].file_size != item["bytes"]:
                            raise ValueError("Invalid archived member: " + member)
                        # Never extract a member name as a filesystem path.
                        with archive.open(entries[0]) as source, staged.open("wb") as target:
                            shutil.copyfileobj(source, target)
                    if digest(staged) != wanted:
                        raise ValueError("Archive member digest differs from evidence pin")
                    return {"attachment": record["id"], "member": member}
            except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
                diagnostics.append(f"{record['id']}: {error}")
        raise ValueError("Pinned payload unavailable in " + key + ("; " + "; ".join(diagnostics) if diagnostics else ""))


def recover(root, record, issue_hint, owner):
    results = []
    with tempfile.TemporaryDirectory(prefix="helix-recovery-") as temp:
        board = Board(owner, temp)
        for evidence in record["evidence"]:
            rel = evidence["path"]
            item = {"path": rel, "sha256": evidence["sha256"]}
            results.append(item)
            try:
                if not re.fullmatch(r"[a-f0-9]{64}", evidence["sha256"]):
                    raise ValueError("Invalid evidence digest")
                if Path(rel).is_absolute() or any(part in ("", ".", "..") for part in rel.split("/")) or "\\" in rel:
                    raise ValueError("Expected a portable checkout-relative evidence path")
                original = root / rel
                if original.resolve() != original:
                    raise ValueError("Refusing symlink in evidence path")
                if original.exists():
                    item["status"] = "present" if original.is_file() and digest(original) == evidence["sha256"] else "conflict"
                    continue
                scratch = rel.startswith((".aikit/scratch/", ".helix/evidence/"))
                dest = original if scratch else root / ".helix/recovered" / evidence["sha256"]
                if dest.resolve() != dest:
                    raise ValueError("Refusing symlink in recovery destination")
                item["localPath"] = str(dest.relative_to(root))
                if dest.is_file() and digest(dest) == evidence["sha256"]:
                    item["status"] = "present"
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(dir=dest.parent) as stage:
                    staged = Path(stage) / "payload"
                    item["source"] = board.fetch(evidence, issue_hint, staged)
                    if digest(staged) != evidence["sha256"]:
                        raise ValueError("Recovered payload digest differs from evidence pin")
                    try:
                        os.link(staged, dest)
                    except FileExistsError:
                        if not dest.is_file() or digest(dest) != evidence["sha256"]:
                            raise ValueError("Destination conflict")
                    if digest(dest) != evidence["sha256"]:
                        raise ValueError("Receiving checkout readback failed")
                item["status"] = "recovered"
            except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
                item.update(status="unavailable", reason=str(error))
    return results


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve()
    owner = Path(sys.argv[3]).resolve() if sys.argv[3] else owner_root(root)
    print(json.dumps(recover(root, json.load(sys.stdin), sys.argv[2], owner)))
