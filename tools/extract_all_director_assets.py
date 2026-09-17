#!/usr/bin/env python3
"""Compile the Java exporter and extract all recovered Director movies."""

from __future__ import annotations

import argparse
import os
import subprocess
import tempfile
from pathlib import Path


MOVIES = {
    "client": "client.dir",
    "tutorial": "tutorial.dir",
    "host": "host.dir",
    "goMU": "goMU.dir",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk-jar", required=True, type=Path)
    parser.add_argument("--javac", default="javac")
    parser.add_argument("--java", default="java")
    parser.add_argument("--movie-dir", type=Path,
                        default=Path("recovered/director/movies/original"))
    parser.add_argument("--output", type=Path, default=Path("recovered/director/assets"))
    args = parser.parse_args()
    sdk = args.sdk_jar.resolve()
    source = Path(__file__).with_name("DirectorAssetExtractor.java").resolve()
    with tempfile.TemporaryDirectory(prefix="gutfeel-director-assets-") as classes:
        subprocess.run(
            [args.javac, "--release", "21", "-cp", str(sdk), "-d", classes, str(source)],
            check=True,
        )
        for role, filename in MOVIES.items():
            subprocess.run(
                [args.java, "-cp", f"{classes}{os.pathsep}{sdk}", "DirectorAssetExtractor",
                 str(args.movie_dir / filename), str(args.output / role)],
                check=True,
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
