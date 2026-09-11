#!/usr/bin/env python3
"""Create one explicit symlink without replacing existing content."""

import argparse
import os
from pathlib import Path
import sys


def link(source, destination, dry_run=False):
    source = Path(source).expanduser().resolve(strict=True)
    # Do not resolve the destination: that would hide existing parent symlinks.
    destination = Path(os.path.abspath(Path(destination).expanduser()))
    if not source.is_file() and not source.is_dir():
        raise ValueError(f"Source must be a file or directory: {source}")
    if destination.is_symlink():
        try:
            if destination.resolve(strict=True) == source:
                return f"Already linked: {destination} -> {source}"
        except (OSError, RuntimeError):
            pass
    if os.path.lexists(destination):
        raise FileExistsError(f"Conflict: destination already exists: {destination}")
    for parent in destination.parents:
        if parent.is_symlink():
            raise ValueError(f"Parent must be a real directory: {parent}")
        if parent.exists() and not parent.is_dir():
            raise NotADirectoryError(f"Parent is not a directory: {parent}")
    if dry_run:
        return f"Would link: {destination} -> {source}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Never replace a destination that appeared since the checks above.
    destination.symlink_to(os.path.relpath(source, destination.parent))
    if destination.resolve(strict=True) != source:
        raise OSError(f"Link verification failed: {destination}")
    return f"Linked: {destination} -> {source}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Existing source file or directory")
    parser.add_argument("destination", help="Exact installation path")
    parser.add_argument("--dry-run", action="store_true", help="Preview without creating anything")
    args = parser.parse_args()
    try:
        print(link(args.source, args.destination, args.dry_run))
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
