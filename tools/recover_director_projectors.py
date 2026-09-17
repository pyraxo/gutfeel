#!/usr/bin/env python3
"""Recover embedded Director movies, Lingo, and chunk metadata from projectors.

Requires a checkout of 59de44955ebd/unpacker.py and ProjectorRays 0.2.0 for
Windows.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path


PROJECTORS = {
    "client": (Path("gutfeel-installed/Client/Gut feel.exe"), "v0.3.6_added_WastageBlocksMsg"),
    "tutorial": (Path("gutfeel-installed/Tutorial/GutFeelTutorial.exe"), "tutorial10"),
    "host": (Path("gutfeel-installed/Host/Host.exe"), "host0.07"),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_unpacker(path: Path):
    spec = importlib.util.spec_from_file_location("director_projector_unpacker", path / "unpacker.py")
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load unpacker from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def modern_decompile(projectorrays: Path, movie: Path, output: Path, wine: str) -> Path:
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [wine, str(projectorrays), "decompile", str(movie), "--dump-scripts", "--dump-json",
         "-o", str(output)],
        check=True,
        env={**__import__("os").environ, "WINEDEBUG": "-all"},
    )
    candidates = list(output.glob("*.dir"))
    if len(candidates) != 1:
        raise RuntimeError(f"expected one decompiled DIR in {output}, found {candidates}")
    return candidates[0]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--unpacker-dir", required=True, type=Path)
    parser.add_argument("--projectorrays", required=True, type=Path)
    parser.add_argument("--wine", default="wine")
    parser.add_argument("--output", type=Path, default=Path("recovered/director"))
    args = parser.parse_args()
    root = Path.cwd()
    output = args.output.resolve()
    unpacker = load_unpacker(args.unpacker_dir.resolve())

    records: list[dict[str, object]] = []
    recovered_movies: dict[str, Path] = {}
    for role, (relative_exe, expected_stem) in PROJECTORS.items():
        executable = (root / relative_exe).resolve()
        destination = output / "projectors" / role
        destination.mkdir(parents=True, exist_ok=True)
        result_dir, movie_count, xtra_count = unpacker.unpack(
            str(executable), dest_dir=str(destination), do_decompile=True
        )
        result_dir = Path(result_dir)
        dxr = result_dir / f"{expected_stem}.dxr"
        if not dxr.is_file():
            raise FileNotFoundError(dxr)
        recovered_movies[role] = dxr
        records.append({
            "role": role,
            "projector": str(relative_exe),
            "projector_sha256": sha256(executable),
            "protected_movie": str(dxr.relative_to(output)),
            "movie_count": movie_count,
            "embedded_xtra_count": xtra_count,
        })

    go_mu = (root / "gutfeel-installed/Client/goMU.dcr").resolve()
    inputs = {**recovered_movies, "goMU": go_mu}
    canonical = {"client": "client.dir", "tutorial": "tutorial.dir", "host": "host.dir", "goMU": "goMU.dir"}
    for role, movie in inputs.items():
        dump_dir = output / "projectorrays-dumps" / role
        decompiled = modern_decompile(args.projectorrays.resolve(), movie, dump_dir, args.wine)
        original_dir = output / "movies" / "original"
        original_dir.mkdir(parents=True, exist_ok=True)
        target = original_dir / canonical[role]
        shutil.copyfile(decompiled, target)

        dump_roots = [path for path in dump_dir.iterdir() if path.is_dir()]
        if len(dump_roots) != 1:
            raise RuntimeError(f"expected one dump directory in {dump_dir}")
        dump_root = dump_roots[0]
        shutil.copytree(dump_root / "casts", output / "lingo" / role, dirs_exist_ok=True)
        shutil.copytree(dump_root / "chunks", output / "chunks" / role, dirs_exist_ok=True)
        records.append({
            "role": role,
            "source_movie": str(movie),
            "editable_movie": str(target.relative_to(output)),
            "editable_movie_sha256": sha256(target),
        })

    provenance = {
        "format": 1,
        "unpacker": str(args.unpacker_dir),
        "projectorrays": str(args.projectorrays),
        "projectorrays_sha256": sha256(args.projectorrays.resolve()),
        "records": records,
    }
    (output / "recovery-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
