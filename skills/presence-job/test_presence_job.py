#!/usr/bin/env python3
"""Regression tests for the stdlib-only Presence job callback helper."""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# The skill directory is not a Python package (and deliberately has a hyphen in
# its path), so import the sibling helper by placing this directory on sys.path.
SKILL_DIR = Path(__file__).resolve().parent
if str(SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(SKILL_DIR))

import presence_job  # noqa: E402


class FakeHttpResponse:
    def __init__(self, payload: dict):
        self._body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self) -> bytes:
        return self._body


class PresenceJobTests(unittest.TestCase):
    def setUp(self) -> None:
        self.base_env = {
            "PRESENCE_GATEWAY_URL": "https://presence.example.com/",
            "AICIV_CALLBACK_API_KEY": "callback-secret-at-least-24-characters",
        }

    def test_success_posts_bearer_authenticated_event(self) -> None:
        captured: dict = {}

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["authorization"] = request.get_header("Authorization")
            captured["content_type"] = request.get_header("Content-type")
            captured["body"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return FakeHttpResponse({"job": {"status": "succeeded"}})

        argv = [
            "presence_job.py",
            "job_0123456789abcdef01234567",
            "succeeded",
            "--event-id",
            "evt_stable_0001",
            "--message",
            "Done",
        ]

        stdout = io.StringIO()
        with patch.dict(os.environ, self.base_env, clear=False), patch.object(sys, "argv", argv), patch(
            "presence_job.urllib.request.urlopen", side_effect=fake_urlopen
        ), patch("sys.stdout", stdout):
            rc = presence_job.main()

        self.assertEqual(rc, 0)
        self.assertEqual(
            captured["url"],
            "https://presence.example.com/v1/delegations/job_0123456789abcdef01234567/events",
        )
        self.assertEqual(captured["authorization"], "Bearer callback-secret-at-least-24-characters")
        self.assertEqual(captured["content_type"], "application/json")
        self.assertEqual(captured["body"]["eventId"], "evt_stable_0001")
        self.assertEqual(captured["body"]["type"], "succeeded")
        self.assertEqual(captured["body"]["message"], "Done")
        self.assertNotIn("callback-secret", stdout.getvalue())

    def test_result_and_receipt_files_are_loaded_as_structured_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result_path = Path(tmp) / "result.json"
            receipts_path = Path(tmp) / "receipts.json"
            result_path.write_text(json.dumps({"summary": "11.7% faster"}), encoding="utf-8")
            receipts_path.write_text(
                json.dumps([{"kind": "file", "uri": "file:///tmp/report.md"}]),
                encoding="utf-8",
            )

            captured: dict = {}

            def fake_urlopen(request, timeout):
                captured["body"] = json.loads(request.data.decode("utf-8"))
                return FakeHttpResponse({"ok": True})

            argv = [
                "presence_job.py",
                "job_0123456789abcdef01234567",
                "succeeded",
                "--result-file",
                str(result_path),
                "--receipts-file",
                str(receipts_path),
            ]
            with patch.dict(os.environ, self.base_env, clear=False), patch.object(sys, "argv", argv), patch(
                "presence_job.urllib.request.urlopen", side_effect=fake_urlopen
            ):
                rc = presence_job.main()

            self.assertEqual(rc, 0)
            self.assertEqual(captured["body"]["result"], {"summary": "11.7% faster"})
            self.assertEqual(
                captured["body"]["receipts"],
                [{"kind": "file", "uri": "file:///tmp/report.md"}],
            )

    def test_failed_requires_reason_before_network_call(self) -> None:
        argv = ["presence_job.py", "job_0123456789abcdef01234567", "failed"]
        stderr = io.StringIO()
        with patch.dict(os.environ, self.base_env, clear=False), patch.object(sys, "argv", argv), patch(
            "presence_job.urllib.request.urlopen"
        ) as urlopen, patch("sys.stderr", stderr):
            rc = presence_job.main()

        self.assertEqual(rc, 2)
        urlopen.assert_not_called()
        self.assertIn("requires --error or --message", stderr.getvalue())

    def test_succeeded_rejects_error_before_network_call(self) -> None:
        argv = [
            "presence_job.py",
            "job_0123456789abcdef01234567",
            "succeeded",
            "--error",
            "this should not coexist with success",
        ]
        with patch.dict(os.environ, self.base_env, clear=False), patch.object(sys, "argv", argv), patch(
            "presence_job.urllib.request.urlopen"
        ) as urlopen:
            rc = presence_job.main()

        self.assertEqual(rc, 2)
        urlopen.assert_not_called()

    def test_receipts_file_must_be_array_of_objects(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            receipts_path = Path(tmp) / "receipts.json"
            receipts_path.write_text(json.dumps({"kind": "not-an-array"}), encoding="utf-8")
            argv = [
                "presence_job.py",
                "job_0123456789abcdef01234567",
                "succeeded",
                "--receipts-file",
                str(receipts_path),
            ]
            with patch.dict(os.environ, self.base_env, clear=False), patch.object(sys, "argv", argv), patch(
                "presence_job.urllib.request.urlopen"
            ) as urlopen:
                rc = presence_job.main()

            self.assertEqual(rc, 2)
            urlopen.assert_not_called()

    def test_invalid_job_id_is_rejected_locally(self) -> None:
        argv = ["presence_job.py", "job_bad", "running"]
        with patch.dict(os.environ, self.base_env, clear=False), patch.object(sys, "argv", argv), patch(
            "presence_job.urllib.request.urlopen"
        ) as urlopen:
            rc = presence_job.main()

        self.assertEqual(rc, 2)
        urlopen.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
