import pathlib
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

        self.assertIn("systemctl --user enable", installer)
        self.assertIn("systemctl --user start", installer)


if __name__ == "__main__":
    unittest.main()
