import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parent


class InstallServiceTests(unittest.TestCase):
    """Runs install-service.sh in a sandbox home with stub system tools."""

    def test_restarts_only_services_whose_unit_changed(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            sandbox = pathlib.Path(temporary_directory)
            trace = sandbox / "trace.txt"
            checkout = sandbox / "checkout"
            deploy = checkout / "deploy"
            shutil.copytree(ROOT, deploy)
            (checkout / "config.local.json").write_text('{"host": "127.0.0.1"}')

            stubs = sandbox / "stubs"
            stubs.mkdir()
            self.write_stub(stubs / "systemctl", '''
case "$*" in
  *"is-active --quiet pi-remote"*) exit 1 ;;
esac
exit 0
''')
            self.write_stub(stubs / "curl", "exit 1\n")
            self.write_stub(stubs / "sudo", "exit 0\n")
            self.write_stub(stubs / "loginctl", "exit 0\n")
            self.write_stub(stubs / "authelia", "exit 0\n")
            self.write_stub(stubs / "caddy", "exit 0\n")

            # The script expects its binaries and configs under the sandbox home.
            (sandbox / ".local" / "bin").mkdir(parents=True)
            shutil.copy(stubs / "authelia", sandbox / ".local" / "bin" / "authelia")
            shutil.copy(stubs / "caddy", sandbox / ".local" / "bin" / "caddy")
            (sandbox / ".config" / "authelia").mkdir(parents=True)
            (sandbox / ".config" / "authelia" / "configuration.yml").touch()
            (sandbox / ".config" / "pi-remote").mkdir(parents=True)
            (sandbox / ".config" / "pi-remote" / "Caddyfile").touch()

            nodes_bin = os.path.expanduser("~/.local/bin")

            def run() -> str:
                environment = {
                    **os.environ,
                    "HOME": str(sandbox),
                    "VERIFY_TRACE": str(trace),
                    "PATH": f"{stubs}:{nodes_bin}:{os.environ['PATH']}",
                }
                result = subprocess.run(
                    ["bash", deploy / "install-service.sh"],
                    text=True, capture_output=True, env=environment, cwd=checkout,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result.stdout

            unit = sandbox / ".config" / "systemd" / "user" / "pi-remote.service"

            # First run: everything is new, so every unit installs and the services start.
            trace.write_text("")
            run()
            self.assertIn("systemctl --user start authelia pi-remote caddy", trace.read_text())
            self.assertTrue(unit.is_file(), "the app unit was not installed")
            self.assertIn("ExecStart", unit.read_text())
            self.assertNotIn("__DIRECTORY__", unit.read_text())
            self.assertNotIn("__NODE__", unit.read_text())

            # Rerun with unchanged units: `start` again, but no restart.
            trace.write_text("")
            run()
            self.assertNotIn("Restarting", trace.read_text())

            # A unit change while the service runs must be restarted to take effect.
            trace.write_text("")
            unit.write_text("stale\n")
            third = run()
            self.assertIn("Restarting pi-remote: its unit changed.", third)
            self.assertNotIn("Restarting authelia", third)
            self.assertNotIn("Restarting caddy", third)

    def write_stub(self, path: pathlib.Path, body: str) -> None:
        path.write_text(f"#!/usr/bin/env bash\nprintf '{path.name} %s\\n' \"$*\" >> \"$VERIFY_TRACE\"\n{body}")
        path.chmod(0o755)


if __name__ == "__main__":
    unittest.main()
