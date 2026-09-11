"""Exercise real filesystem outcomes in isolated directories."""

import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "link.py"
spec = importlib.util.spec_from_file_location("link_helper", SCRIPT)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class LinkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / "source file"
        self.source.write_text("owned content")
        self.dest = self.root / "project with spaces" / ".claude" / "skills" / "example"

    def test_link_creates_only_selected_destination_and_follows_source_edits(self):
        helper.link(self.source, self.dest)
        self.assertTrue(self.dest.is_symlink())
        self.assertEqual(self.dest.resolve(), self.source)
        self.assertFalse(os.path.isabs(os.readlink(self.dest)))
        self.source.write_text("updated")
        self.assertEqual(self.dest.read_text(), "updated")
        self.assertEqual(list(self.dest.parent.iterdir()), [self.dest])

    def test_directory_link_includes_supporting_resources(self):
        source = self.root / "library" / "example"
        (source / "references").mkdir(parents=True)
        (source / "SKILL.md").write_text("skill")
        (source / "references" / "guide.md").write_text("guide")
        helper.link(source, self.dest)
        self.assertEqual((self.dest / "references" / "guide.md").read_text(), "guide")

    def test_correct_link_is_no_op(self):
        helper.link(self.source, self.dest)
        before = self.dest.lstat()
        self.assertIn("Already linked", helper.link(self.source, self.dest))
        self.assertEqual(self.dest.lstat().st_ino, before.st_ino)
        self.assertEqual(self.dest.lstat().st_mtime_ns, before.st_mtime_ns)

    def test_preview_makes_no_directories(self):
        self.assertIn("Would link", helper.link(self.source, self.dest, dry_run=True))
        self.assertEqual(list(self.root.iterdir()), [self.source])

    def test_conflicts_preserve_file_directory_wrong_and_broken_links(self):
        targets = [self.root / name for name in ("file", "directory", "wrong", "broken", "loop")]
        targets[0].write_text("local content")
        targets[1].mkdir()
        (targets[1] / "local").write_text("local directory content")
        targets[2].symlink_to(targets[0])
        targets[3].symlink_to(self.root / "missing")
        targets[4].symlink_to(targets[4])
        for target in targets:
            with self.subTest(target=target.name):
                before = target.lstat()
                for dry_run in (False, True):
                    with self.assertRaises(FileExistsError):
                        helper.link(self.source, target, dry_run=dry_run)
                self.assertEqual(target.lstat().st_ino, before.st_ino)
        self.assertEqual(targets[0].read_text(), "local content")
        self.assertEqual((targets[1] / "local").read_text(), "local directory content")
        self.assertEqual(os.readlink(targets[3]), str(self.root / "missing"))

    def test_missing_source_leaves_destination_untouched(self):
        with self.assertRaises(FileNotFoundError):
            helper.link(self.root / "missing", self.dest)
        self.assertEqual(list(self.root.iterdir()), [self.source])

    def test_symlinked_parent_cannot_redirect_writes(self):
        outside = self.root / "outside"
        outside.mkdir()
        parent = self.root / "redirect"
        parent.symlink_to(outside)
        for dry_run in (False, True):
            with self.assertRaises(ValueError):
                helper.link(self.source, parent / "new" / "target", dry_run=dry_run)
        self.assertEqual(list(outside.iterdir()), [])

    def test_broken_parent_link_and_file_parent_are_rejected(self):
        broken = self.root / "broken-parent"
        broken.symlink_to(self.root / "missing")
        with self.assertRaises(ValueError):
            helper.link(self.source, broken / "target")
        with self.assertRaises(NotADirectoryError):
            helper.link(self.source, self.source / "target")
        self.assertFalse((self.root / "missing").exists())
        self.assertEqual(self.source.read_text(), "owned content")

    def test_correct_link_under_linked_parent_is_no_op(self):
        helper.link(self.source, self.dest)
        alias = self.root / "alias"
        alias.symlink_to(self.dest.parent)
        self.assertIn("Already linked", helper.link(self.source, alias / self.dest.name))

    def test_source_symlink_uses_canonical_source(self):
        alias = self.root / "source-alias"
        alias.symlink_to(self.source)
        helper.link(alias, self.dest)
        alias.unlink()
        self.assertEqual(self.dest.read_text(), "owned content")

    def test_command_line_supports_paths_and_reports_conflicts(self):
        command = [sys.executable, "-W", "error", str(SCRIPT), str(self.source), str(self.dest)]
        preview = subprocess.run(command + ["--dry-run"], capture_output=True, text=True)
        self.assertEqual(preview.returncode, 0, preview.stderr)
        self.assertFalse(self.dest.parent.exists())
        applied = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertEqual(self.dest.resolve(), self.source)
        conflict = subprocess.run(command[:-1] + [str(self.source)], capture_output=True, text=True)
        self.assertEqual(conflict.returncode, 1)
        self.assertIn("Conflict", conflict.stderr)
        self.assertNotIn("Traceback", conflict.stderr)
        self.assertEqual(self.source.read_text(), "owned content")


if __name__ == "__main__":
    unittest.main()
