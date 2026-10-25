import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import struct
import subprocess
import tempfile
import termios
import time
import unittest


HELPER = Path(__file__).with_name("set-authelia-password.sh")
PASSWORD = b"disposable-terminal-regression-password"


class TerminalSession:
    def __init__(self, directory):
        self.descriptor, terminal = pty.openpty()
        fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 100, 0, 0))
        self.output = bytearray()
        self.process = subprocess.Popen(
            ["bash", str(HELPER), "test-user", "test@example.com", directory],
            stdin=terminal, stdout=terminal, stderr=terminal, start_new_session=True,
        )
        os.close(terminal)

    def read_until(self, text):
        deadline = time.monotonic() + 10
        while text not in self.output:
            if time.monotonic() >= deadline:
                raise AssertionError(f"Timed out waiting for {text!r}: {bytes(self.output)!r}")
            if not select.select([self.descriptor], [], [], 0.1)[0]:
                continue
            try:
                data = os.read(self.descriptor, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                data = b""
            if not data:
                raise AssertionError(f"Terminal closed before {text!r}: {bytes(self.output)!r}")
            self.output.extend(data)

    def enter_password(self, password, confirmation):
        self.read_until(b"Enter Password:")
        os.write(self.descriptor, password + b"\r")
        self.read_until(b"Confirm Password:")
        os.write(self.descriptor, confirmation + b"\r")

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=5)
        os.close(self.descriptor)


class PasswordSetupTests(unittest.TestCase):
    def start_session(self):
        directory = tempfile.TemporaryDirectory(prefix="pi-remote-password-test-")
        self.addCleanup(directory.cleanup)
        session = TerminalSession(directory.name)
        self.addCleanup(session.close)
        return session, Path(directory.name)

    def test_interactive_password_is_hidden_and_hash_file_is_protected(self):
        session, directory = self.start_session()
        session.enter_password(PASSWORD, PASSWORD)
        session.read_until(b"Saved the hashed password")
        self.assertEqual(session.process.wait(timeout=5), 0)
        self.assertNotIn(PASSWORD, session.output)
        path = directory / "users.json"
        user = json.loads(path.read_text())["users"]["test-user"]
        self.assertTrue(user["password"].startswith("$argon2id$"))
        validation = subprocess.run(
            [str(Path.home() / ".local/bin/authelia"), "crypto", "hash", "validate",
             "--password", PASSWORD.decode(), "--", user["password"]],
            capture_output=True,
        )
        self.assertEqual(validation.returncode, 0, validation.stderr)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(directory.glob("password.*")), [])
        result = subprocess.run(
            ["bash", str(HELPER), "test-user", "test@example.com", str(directory)],
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"already exists", result.stderr)
        self.assertEqual(json.loads(path.read_text())["users"]["test-user"], user)

    def test_mismatched_passwords_leave_no_user_or_capture_file(self):
        session, directory = self.start_session()
        session.enter_password(PASSWORD, b"different-disposable-password")
        self.assertNotEqual(session.process.wait(timeout=5), 0)
        self.assertFalse((directory / "users.json").exists())
        self.assertEqual(list(directory.glob("password.*")), [])


if __name__ == "__main__":
    unittest.main()
