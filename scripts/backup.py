#!/usr/bin/env python3
"""Portable notes + original attachments backup (Python 3.10+, no third-party packages).

  MEMOS_TOKEN=<personal access token> python3 scripts/backup.py backup --url https://notes.example.com --output backup-2026-09-24
  python3 scripts/backup.py verify --directory backup-2026-09-24

This is a user-content export, not a full D1/R2 disaster-recovery snapshot.
Accounts/settings, unattached uploads, and externally hosted Markdown images are
not downloaded. Relationships/comments are retained in the JSON manifest.
Pause edits during export. Tokens never appear in files or command-line arguments.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit, quote
from urllib.request import Request, build_opener, HTTPRedirectHandler

MAX_JSON_BYTES = 24 * 1024 * 1024
MAX_FILE_BYTES = 32 * 1024 * 1024
UID = re.compile(r"^[A-Za-z0-9-]{1,64}$")
EXTENSIONS = {"image/png":".png", "image/jpeg":".jpg", "image/gif":".gif", "image/webp":".webp", "image/avif":".avif", "application/pdf":".pdf"}

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward an Authorization header through a server redirect.
        raise ValueError("服务器返回重定向；请直接填写实际 HTTPS 域名")


def resource_id(name: str, prefix: str) -> str:
    expected = prefix + "/"
    if not isinstance(name, str) or not name.startswith(expected) or not UID.fullmatch(name[len(expected):]):
        raise ValueError(f"无效资源名称：{name!r}")
    return name[len(expected):]


def safe_path(root: Path, relative: str) -> Path:
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or "\\" in relative:
        raise ValueError("备份路径不能超出备份目录")
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError("备份路径或符号链接越界")
    return resolved


def sha256_file(path: Path) -> tuple[str, int]:
    digest, size = hashlib.sha256(), 0
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


class Client:
    def __init__(self, base_url: str, token: str):
        parsed = urlsplit(base_url)
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError("URL 必须是实例根地址，不能包含账号、路径或查询参数")
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")):
            raise ValueError("必须使用 HTTPS；仅本机测试允许 HTTP")
        if not parsed.hostname or not token:
            raise ValueError("需要实例地址及 MEMOS_TOKEN 环境变量（个人访问令牌）")
        self.base_url, self.token = base_url.rstrip("/"), token
        self.opener = build_opener(NoRedirect())

    def get(self, path: str):
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("仅允许读取当前实例")
        return self.opener.open(Request(self.base_url + path, headers={"Authorization":f"Bearer {self.token}"}), timeout=60)

    def page(self, path: str) -> dict:
        with self.get(path) as response:
            data = response.read(MAX_JSON_BYTES + 1)
        if len(data) > MAX_JSON_BYTES:
            raise ValueError("单页数据超过安全限制")
        result = json.loads(data)
        if not isinstance(result, dict):
            raise ValueError("实例返回的 JSON 格式不正确")
        return result

    def download(self, path: str, destination: Path, expected_size: int) -> dict:
        if expected_size < 1 or expected_size > MAX_FILE_BYTES:
            raise ValueError("附件大小不在支持范围内")
        with self.get(path) as response, destination.open("xb") as file:
            size = 0
            digest = hashlib.sha256()
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise ValueError("下载附件超过安全限制")
                file.write(chunk)
                digest.update(chunk)
        if size != expected_size:
            raise ValueError("附件实际大小与元数据不一致，请暂停编辑后重新备份")
        return {"size":size,"sha256":digest.hexdigest()}


def backup(client: Client, destination: Path) -> dict:
    destination = destination.resolve()
    if destination.exists():
        raise ValueError("目标目录已存在；为避免覆盖，请指定新的备份目录")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Atomic publish: incomplete downloads never become a 'complete' backup folder.
    with tempfile.TemporaryDirectory(prefix=".memos-export-", dir=destination.parent) as tmp:
        stage = Path(tmp)
        (stage / "notes").mkdir()
        (stage / "attachments").mkdir()
        memos, attachments, files, seen, cursors = [], {}, {}, set(), set()
        after, until = "0", None
        while True:
            query = {"after":after}
            if until is not None:
                query["until"] = str(until)
            page = client.page("/api/personal/export?" + urlencode(query))
            if page.get("schemaVersion") != 1 or not isinstance(page.get("memos"), list):
                raise ValueError("不支持的导出接口版本")
            if until is None:
                until = page["snapshotMaxId"]
            elif until != page["snapshotMaxId"]:
                raise ValueError("导出快照范围发生变化")
            for memo in page["memos"]:
                uid = resource_id(memo["name"], "memos")
                if uid in seen:
                    raise ValueError("分页出现重复笔记，停止备份以免静默遗漏")
                seen.add(uid)
                links = []
                for attachment in memo.get("attachments", []):
                    name = attachment["name"]
                    aid = resource_id(name, "attachments")
                    if attachment.get("externalLink"):
                        raise ValueError("发现旧版外部附件；请先迁移到 R2，不能将其误报为已备份")
                    if name not in attachments:
                        relative = f"attachments/{aid}{EXTENSIONS.get(attachment['type'], '.bin')}"
                        info = client.download(f"/file/{name}/{quote(attachment['filename'], safe='')}", stage / relative, int(attachment["size"]))
                        files[relative] = info
                        attachments[name] = {**attachment, "backupPath":relative, **info}
                    label = re.sub(r"[\[\]\\]", "_", attachment["filename"])
                    mark = "!" if attachment["type"].startswith("image/") else ""
                    links.append(f"{mark}[{label}](../{attachments[name]['backupPath']})")
                text = "\n".join([f"<!-- {memo['name']} -->", f"<!-- created: {memo.get('createTime', '')}; updated: {memo.get('updateTime', '')} -->", "", memo.get("content", ""), "", *links, ""])
                relative = f"notes/{uid}.md"
                (stage / relative).write_text(text, encoding="utf-8")
                digest, size = sha256_file(stage / relative)
                files[relative] = {"sha256":digest,"size":size}
                memos.append(memo)
            print(f"已备份 {len(memos)} 条笔记、{len(attachments)} 个附件", flush=True)
            after = page.get("nextCursor", "")
            if not after:
                break
            if after in cursors or not str(after).isdigit():
                raise ValueError("无效或循环的分页游标")
            cursors.add(after)
        manifest = {"schemaVersion":1,"complete":True,"source":client.base_url,
                    "exportedAt":datetime.now(timezone.utc).isoformat(), "snapshotMaxId":until,
                    "scope":"own notes including archived/comments, plus attached R2 files; excludes users/settings/unattached files/remote markdown images",
                    "memos":memos,"attachments":attachments,"files":files}
        (stage / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        verify(stage)
        if destination.exists():
            raise ValueError("目标目录在备份期间已被创建，取消发布")
        stage.rename(destination)
    return manifest


def verify(directory: Path) -> dict:
    directory = directory.resolve()
    manifest_path = safe_path(directory, "manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or manifest.get("complete") is not True:
        raise ValueError("不是受支持的完整备份")
    for relative, expected in manifest["files"].items():
        path = safe_path(directory, relative)
        if not path.is_file():
            raise ValueError(f"备份文件缺失：{relative}")
        digest, size = sha256_file(path)
        if digest != expected["sha256"] or size != expected["size"]:
            raise ValueError(f"备份文件校验失败：{relative}")
    for memo in manifest["memos"]:
        if f"notes/{resource_id(memo['name'], 'memos')}.md" not in manifest["files"]:
            raise ValueError("笔记 Markdown 文件不完整")
        for attachment in memo.get("attachments", []):
            data = manifest["attachments"].get(attachment["name"])
            if not data or data["backupPath"] not in manifest["files"]:
                raise ValueError("附件清单不完整")
    return {"memos":len(manifest["memos"]),"attachments":len(manifest["attachments"]),"files":len(manifest["files"])}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    export = sub.add_parser("backup", help="导出笔记和原始附件到新的本地目录")
    export.add_argument("--url", required=True)
    export.add_argument("--output", required=True, type=Path)
    check = sub.add_parser("verify", help="离线核对所有文件的大小和 SHA-256")
    check.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "backup":
            backup(Client(args.url, os.environ.get("MEMOS_TOKEN", "")), args.output)
            print(f"备份完成并已通过文件校验：{args.output}")
        else:
            print(json.dumps(verify(args.directory), ensure_ascii=False))
        return 0
    except HTTPError as error:
        print(f"操作失败：HTTP {error.code}，请检查域名、权限和令牌", file=sys.stderr)
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f"操作失败：{error}", file=sys.stderr)
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
