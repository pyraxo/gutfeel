#!/usr/bin/env python3
"""Write a deterministic summary of recovered Director artifacts."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path("recovered/director")
ROLES = ("client", "tutorial", "host", "goMU")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def directory_stats(path: Path) -> dict[str, int]:
    files = [candidate for candidate in path.rglob("*") if candidate.is_file()]
    return {"files": len(files), "bytes": sum(candidate.stat().st_size for candidate in files)}


def main() -> int:
    inventory: dict[str, object] = {"format": 1, "roles": {}}
    roles: dict[str, object] = inventory["roles"]  # type: ignore[assignment]
    for role in ROLES:
        asset_root = ROOT / "assets" / role
        lingo_root = ROOT / "lingo" / role
        role_data: dict[str, object] = {
            "assets": {},
            "lingo_source_files": len(list(lingo_root.rglob("*.ls"))),
            "lingo_assembly_files": len(list(lingo_root.rglob("*.lasm"))),
            "chunk_json_files": len(list((ROOT / "chunks" / role).glob("*.json"))),
        }
        for category in ("bitmaps", "sounds", "text", "raw_chunks", "palettes"):
            role_data["assets"][category] = directory_stats(asset_root / category)  # type: ignore[index]
        manifest = asset_root / "manifest.tsv"
        if manifest.is_file():
            role_data["manifest_sha256"] = sha256(manifest)
        movie = ROOT / "movies" / "original" / ("goMU.dir" if role == "goMU" else f"{role}.dir")
        if movie.is_file():
            role_data["movie"] = {
                "path": str(movie),
                "bytes": movie.stat().st_size,
                "sha256": sha256(movie),
            }
        roles[role] = role_data
    (ROOT / "INVENTORY.json").write_text(json.dumps(inventory, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
