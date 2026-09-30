#!/usr/bin/env python3
"""Portable ywdj record/evidence backup. Not a complete D1/R2 disaster-recovery image."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Refusing HTTP redirect; credentials must remain on the chosen origin")

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def checked_path(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    candidate.relative_to(root.resolve())
    return candidate

def backup(base: str, output: Path) -> dict:
    token = os.environ.get("MEMOS_TOKEN", "")
    if not token:
        raise ValueError("Set MEMOS_TOKEN securely in the environment; do not put it in command-line arguments")
    base = base.rstrip("/") + "/"
    origin = urlsplit(base)
    if origin.username or origin.password or origin.query or origin.fragment or origin.path != "/":
        raise ValueError("Use a site origin without credentials, path, query or fragment")
    if origin.scheme != "https" and not (origin.scheme == "http" and origin.hostname in {"localhost", "127.0.0.1", "::1"}):
        raise ValueError("Use HTTPS except for an explicit localhost test server")
    opener = build_opener(NoRedirect())
    def get(path: str, limit: int = 32 * 1024 * 1024) -> bytes:
        url = urljoin(base, path)
        target = urlsplit(url)
        if (target.scheme, target.netloc) != (origin.scheme, origin.netloc):
            raise ValueError("Evidence URL is not same-origin")
        request = Request(url, headers={"Authorization": f"Bearer {token}"})
        with opener.open(request, timeout=60) as response:
            data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Response exceeds safe backup size limit")
        return data
    def pages(endpoint: str, initial: dict | None = None) -> tuple[list, int]:
        query = dict(initial or {})
        rows = []
        previous = 0
        snapshot = 0
        while True:
            page = json.loads(get(endpoint + "?" + urlencode(query)))
            rows.extend(page["items"])
            snapshot = int(page["snapshotMaxId"])
            after = page.get("nextCursor", "")
            if not after:
                return rows, snapshot
            if int(after) <= previous:
                raise ValueError("Pagination did not advance; backup aborted")
            previous = int(after)
            query.update(after=after, until=snapshot)
    metadata = json.loads(get("/api/audit/meta"))
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    (output / "attachments").mkdir(mode=0o700)
    records, snapshot = pages("/api/audit/export", {"all": "1"})
    evidence = {}
    for record in records:
        for item in record["attachments"]:
            if item["id"] in evidence:
                continue
            # Untrusted original filenames are metadata only, never filesystem paths.
            relative = f"attachments/{item['id']}"
            path = checked_path(output, relative)
            data = get(item["url"])
            if len(data) != item["size"] or digest(data) != item["sha256"]:
                raise ValueError("Evidence size or SHA-256 mismatch; backup is incomplete")
            path.write_bytes(data)
            evidence[item["id"]] = {**item, "backupPath": relative}
    try:
        logs, log_snapshot = pages("/api/audit/logs")
        log_status = "included"
    except HTTPError as error:
        if error.code != 403:
            raise
        logs, log_snapshot, log_status = [], 0, "not-authorized"
    record_bytes = json.dumps(records, ensure_ascii=False, indent=2).encode("utf-8")
    log_bytes = json.dumps(logs, ensure_ascii=False, indent=2).encode("utf-8")
    (output / "records.json").write_bytes(record_bytes)
    (output / "audit-log.json").write_bytes(log_bytes)
    manifest = {"schemaVersion": "ywdj-portable-1", "complete": True, "origin": base, "metadata": metadata,
        "recordSnapshotMaxId": snapshot, "logSnapshotMaxId": log_snapshot, "logStatus": log_status,
        "recordCount": len(records), "attachments": evidence,
        "files": {"records.json": digest(record_bytes), "audit-log.json": digest(log_bytes)},
        "scope": "Formal records and their original evidence; available operation logs. Excludes account credentials, settings, unsubmitted drafts and legacy personal notes."}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return verify(output)

def verify(directory: Path) -> dict:
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != "ywdj-portable-1" or not manifest.get("complete"):
        raise ValueError("Unsupported or incomplete backup manifest")
    for relative, expected in manifest["files"].items():
        if digest(checked_path(directory, relative).read_bytes()) != expected:
            raise ValueError(f"Metadata checksum mismatch: {relative}")
    records = json.loads((directory / "records.json").read_text(encoding="utf-8"))
    if len(records) != manifest["recordCount"]:
        raise ValueError("Record count mismatch")
    for item in manifest["attachments"].values():
        data = checked_path(directory, item["backupPath"]).read_bytes()
        if digest(data) != item["sha256"] or len(data) != item["size"]:
            raise ValueError("Evidence checksum/size mismatch")
    for record in records:
        for item in record["attachments"]:
            saved = manifest["attachments"].get(item["id"])
            if not saved or saved["sha256"] != item["sha256"] or saved["size"] != item["size"]:
                raise ValueError("Record evidence is missing from the backup")
    return {"status": "verified", "records": len(records), "attachments": len(manifest["attachments"]), "logStatus": manifest["logStatus"]}

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    save = subs.add_parser("backup")
    save.add_argument("--url", required=True)
    save.add_argument("--output", type=Path, required=True)
    check = subs.add_parser("verify")
    check.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = backup(args.url, args.output) if args.command == "backup" else verify(args.directory)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        # Never include token/header dumps. An absent final manifest means incomplete output.
        print(f"Backup failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)

if __name__ == "__main__":
    main()
