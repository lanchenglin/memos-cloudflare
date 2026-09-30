import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('audit_backup', Path(__file__).resolve().parents[1] / 'audit_backup.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class AuditBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'attachments').mkdir()
        data = b'original-evidence'
        self.item = {'id':'test-file','filename':'中文证据.png','sha256':module.digest(data),'size':len(data),'backupPath':'attachments/test-file'}
        (self.root / 'attachments/test-file').write_bytes(data)
        records = json.dumps([{'id':'YW-test','attachments':[self.item]}]).encode()
        (self.root / 'records.json').write_bytes(records)
        (self.root / 'audit-log.json').write_bytes(b'[]')
        self.manifest = {'schemaVersion':'ywdj-portable-1','complete':True,'recordCount':1,'logStatus':'included',
          'attachments':{'test-file':self.item},'files':{'records.json':module.digest(records),'audit-log.json':module.digest(b'[]')}}
        self.write_manifest()
    def write_manifest(self):
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest))
    def tearDown(self):
        self.temp.cleanup()
    def test_verifies_records_and_original_evidence(self):
        self.assertEqual(module.verify(self.root),{'status':'verified','records':1,'attachments':1,'logStatus':'included'})
    def test_detects_changed_evidence(self):
        (self.root / 'attachments/test-file').write_bytes(b'changed')
        with self.assertRaises(ValueError): module.verify(self.root)
    def test_detects_changed_record_metadata(self):
        (self.root / 'records.json').write_text('[]')
        with self.assertRaises(ValueError): module.verify(self.root)
    def test_requires_every_record_attachment(self):
        self.manifest['attachments'] = {}
        self.write_manifest()
        with self.assertRaises(ValueError): module.verify(self.root)
    def test_rejects_path_traversal_and_absent_complete_marker(self):
        for path in ['../escape','/tmp/escape']:
            with self.assertRaises(ValueError): module.checked_path(self.root,path)
        self.manifest['complete'] = False
        self.write_manifest()
        with self.assertRaises(ValueError): module.verify(self.root)
    def test_rejects_unsafe_origin_and_missing_credentials_before_any_network_access(self):
        with patch.dict('os.environ',{'MEMOS_TOKEN':''}):
            with self.assertRaises(ValueError): module.backup('https://test.invalid',self.root/'new')
        with patch.dict('os.environ',{'MEMOS_TOKEN':'synthetic-test-token'}):
            for origin in ['http://test.invalid','https://user:pass@test.invalid','https://test.invalid/api','https://test.invalid/?token=x']:
                with self.assertRaises(ValueError): module.backup(origin,self.root/'new')

if __name__ == '__main__': unittest.main()
