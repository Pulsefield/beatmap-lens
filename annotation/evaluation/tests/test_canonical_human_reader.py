"""Exercise the read-only feedback CLI against actual canonical workflow storage."""
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest


class CanonicalHumanReaderTests(unittest.TestCase):
    def test_canonical_supersession_packed_identity_and_read_only_snapshot(self):
        fixture = Path(__file__).with_name('canonical-human-reader-fixture.mjs').resolve()
        with TemporaryDirectory() as temporary:
            result = subprocess.run(
                ['node', str(fixture), str(Path(temporary) / 'workspace')],
                cwd=temporary, capture_output=True, text=True, timeout=30, check=False)
        self.assertEqual(result.returncode, 0, msg=result.stderr or result.stdout)
        self.assertEqual(result.stderr, '')
        self.assertEqual(json.loads(result.stdout)['checks'], [
            'canonical-supersession', 'observation-hashes', 'packed-identity',
            'cli-json-outside-repository', 'read-only-workspace',
            'concurrent-content-change', 'concurrent-inventory-change',
            'foundation-drift', 'empty-workspace',
        ])


if __name__ == '__main__':
    unittest.main()
