"""Exercise the exact Python sender embedded in the downloadable workflow (no network)."""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

TEMPLATE = Path(__file__).resolve().parents[1] / 'docs/templates/unpause-github.yml'
SOURCE = '\n'.join(line[10:] for line in TEMPLATE.read_text().split('        run: |\n', 1)[1].splitlines())

class Response:
    status = 200
    def __init__(self, body=b'{}'): self.body = io.BytesIO(body)
    def read(self, *args): return self.body.read(*args)
    def __enter__(self): return self
    def __exit__(self, *args): pass

class SenderTests(unittest.TestCase):
    def run_sender(self, statuses, large=False):
        attempts, waits = [], []
        class Opener:
            def open(self, request, timeout):
                if request.full_url.startswith('https://api.github.com/'):
                    commits = [{'sha': 'a' * 40, 'commit': {'message': ('ก' * 2000 if large else 'Change'), 'author': {'name': 'Dev', 'date': '2026-01-01T00:00:00Z'}}} for _ in range(100 if large else 1)]
                    return Response(json.dumps(commits).encode())
                attempts.append(request)
                code = statuses[min(len(attempts) - 1, len(statuses) - 1)]
                if code != 200:
                    raise urllib.error.HTTPError(request.full_url, code, 'error', {}, None)
                return Response()
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory) / 'event.json'
            event.write_text(json.dumps({'after': 'a'*40, 'repository': {'id': 42, 'full_name': 'solo/demo'}, 'head_commit': {'timestamp': '2026-01-01T00:00:00Z'}}))
            env = {'GITHUB_EVENT_PATH': str(event), 'UNPAUSE_DELIVERY_URL': 'https://unpause.example/api/v1/integrations/github/connection/deliveries', 'UNPAUSE_SECRET': 's'*64, 'GH_TOKEN': 'token', 'GITHUB_REF': 'refs/heads/main', 'GITHUB_RUN_ID': '123'}
            with patch.dict(os.environ, env), patch('urllib.request.build_opener', return_value=Opener()), patch('time.sleep', side_effect=waits.append), contextlib.redirect_stdout(io.StringIO()) as logs:
                error = None
                try: exec(compile(SOURCE, str(TEMPLATE), 'exec'), {})
                except SystemExit as exc: error = str(exc)
        self.assertNotIn('s'*64, logs.getvalue())
        return attempts, waits, error

    def test_temporary_failures_retry_exact_same_delivery(self):
        requests, waits, error = self.run_sender([503, 429, 200])
        self.assertIsNone(error)
        self.assertEqual(waits, [15, 30])
        self.assertEqual(len(requests), 3)
        self.assertEqual(requests[0].data, requests[2].data)
        payload = json.loads(requests[0].data)
        self.assertEqual(payload['deliveryId'], 'actions:123')
        self.assertEqual(payload['repositoryId'], 42)
        self.assertNotIn('projectId', payload)

    def test_bad_credentials_stop_immediately(self):
        requests, waits, error = self.run_sender([401])
        self.assertEqual(len(requests), 1)
        self.assertEqual(waits, [])
        self.assertIn('401', error)

    def test_retries_are_bounded_and_failure_visible(self):
        requests, waits, error = self.run_sender([503])
        self.assertEqual(len(requests), 5)
        self.assertEqual(waits, [15, 30, 60, 120])
        self.assertIn('exhausted retries', error)

    def test_multibyte_payload_is_bounded_with_truthful_gap_flag(self):
        requests, _, error = self.run_sender([200], large=True)
        self.assertIsNone(error)
        self.assertLessEqual(len(requests[0].data), 256*1024)
        payload = json.loads(requests[0].data)
        self.assertTrue(payload['incomplete'])
        self.assertLess(len(payload['commits']), 100)

if __name__ == '__main__': unittest.main()
