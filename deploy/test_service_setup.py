import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parent
SERVICE_NAMES = ("authelia", "pi-remote", "caddy")


class ServiceSetupTests(unittest.TestCase):
    def test_installer_provisions_every_runtime_service(self):
        installer = (ROOT / "install-service.sh").read_text()

        for name in SERVICE_NAMES:
            template = ROOT / f"{name}.service"
            self.assertTrue(template.is_file(), f"Missing {template.name}")
            unit = template.read_text()
            self.assertIn("Restart=on-failure", unit)
            self.assertIn("WantedBy=default.target", unit)
            self.assertIn(f'"$directory/deploy/{name}.service"', installer)

        # easy-install.sh links npm and npx in ~/.local/bin. Stdio MCP servers start
        # through npx or uvx, so the app unit must carry them on PATH.
        app_unit = (ROOT / "pi-remote.service").read_text()
        self.assertIn("Environment=PATH=", app_unit)
        self.assertIn("%h/.local/bin", app_unit)

    def test_deploy_ships_deploy_files_and_renders_the_unit(self):
        receive = (ROOT / "receive.sh").read_text()
        installer = (ROOT / "install-service.sh").read_text()
        workflow = (ROOT.parent / ".github" / "workflows" / "ci.yml").read_text()

        # The tar carries deploy/, so unit templates and receive.sh ride with every build
        # instead of waiting for a host-side git pull.
        self.assertRegex(workflow, r"tar -c[^\n]*\bdeploy\b")

        # receive.sh renders the app unit from the received template and reloads systemd
        # when it differs, and replaces itself by rename only after the health check.
        self.assertIn("pi-remote.service", receive)
        self.assertIn("systemctl --user daemon-reload", receive)
        self.assertIn("--exclude=receive.sh", receive)
        self.assertIn("receive.sh.new", receive)
        self.assertIn("systemctl --user enable", installer)
        self.assertIn("systemctl --user start", installer)

    def test_checker_waits_for_services_to_be_ready(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            binary_directory = pathlib.Path(temporary_directory)
            self.write_executable(binary_directory / "systemctl", "exit 0")
            self.write_executable(binary_directory / "sleep", "exit 0")
            self.write_executable(binary_directory / "curl", """
case "$*" in
  *7710*) name=app ;;
  *9091*) name=authelia ;;
  *) printf 302; exit 0 ;;
esac
count_file="$TMPDIR/$name-count"
count=$(($(cat "$count_file" 2>/dev/null || true) + 1))
printf '%s' "$count" > "$count_file"
[ "$count" -ge 3 ]
""")
            environment = {**os.environ, "PATH": f"{binary_directory}:{os.environ['PATH']}", "TMPDIR": temporary_directory}
            result = subprocess.run(
                ["bash", ROOT / "check-services.sh", "pi.example.com"],
                text=True, capture_output=True, env=environment,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("authelia: healthy", result.stdout)
            self.assertIn("caddy: 302", result.stdout)

    def write_executable(self, path: pathlib.Path, body: str):
        path.write_text(f"#!/usr/bin/env bash\n{body}\n")
        path.chmod(0o755)


if __name__ == "__main__":
    unittest.main()
