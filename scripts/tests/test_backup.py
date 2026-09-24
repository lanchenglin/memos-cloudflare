import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("memos_backup", Path(__file__).resolve().parents[1] / "backup.py")
backup_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_module)


class FakeClient:
    base_url = "https://notes.example.test"
    content = b"original-test-image-bytes"
    def page(self, path):
        return {"schemaVersion":1,"snapshotMaxId":1,"nextCursor":"", "memos":[{
            "name":"memos/test-note","content":"中文内容 #待整理", "createTime":"2026-09-24T00:00:00Z",
            "attachments":[{"name":"attachments/test-image","filename":"截图.png","type":"image/png","size":str(len(self.content))}],
        }]}
    def download(self, path, destination, expected_size):
        destination.write_bytes(self.content)
        sha, size = backup_module.sha256_file(destination)
        return {"sha256":sha,"size":size}


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def test_portable_markdown_and_original_attachment(self):
        folder = self.root / "backup"
        backup_module.backup(FakeClient(), folder)
        self.assertEqual(backup_module.verify(folder), {"memos":1,"attachments":1,"files":2})
        text = (folder / "notes/test-note.md").read_text()
        self.assertIn("中文内容", text)
        self.assertIn("../attachments/test-image.png", text)
        self.assertEqual((folder / "attachments/test-image.png").read_bytes(), FakeClient.content)
    def test_detects_corruption(self):
        folder = self.root / "backup"
        backup_module.backup(FakeClient(), folder)
        (folder / "attachments/test-image.png").write_bytes(b"corrupt")
        with self.assertRaises(ValueError): backup_module.verify(folder)
    def test_refuses_to_overwrite(self):
        folder = self.root / "existing"
        folder.mkdir()
        with self.assertRaises(ValueError): backup_module.backup(FakeClient(), folder)
    def test_failed_download_never_publishes_complete_folder(self):
        class Broken(FakeClient):
            def download(self, *args): raise OSError("simulated failure")
        folder = self.root / "backup"
        with self.assertRaises(OSError): backup_module.backup(Broken(), folder)
        self.assertFalse(folder.exists())
        self.assertEqual(list(self.root.iterdir()), [])
    def test_prevents_path_traversal(self):
        for name in ("../escape", "/absolute", "x/../../escape", "x\\escape"):
            with self.assertRaises(ValueError): backup_module.safe_path(self.root, name)
        with self.assertRaises(ValueError): backup_module.resource_id("memos/../../escape", "memos")
    def test_requires_secure_origin_and_token(self):
        for url in ("http://example.test", "https://user:password@example.test", "https://example.test/api", "https://example.test/?token=x"):
            with self.assertRaises(ValueError): backup_module.Client(url, "test-token")
        with self.assertRaises(ValueError): backup_module.Client("https://example.test", "")
        self.assertEqual(backup_module.Client("http://127.0.0.1:8787", "local-token").base_url, "http://127.0.0.1:8787")

if __name__ == "__main__": unittest.main()
