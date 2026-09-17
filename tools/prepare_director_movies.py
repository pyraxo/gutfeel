#!/usr/bin/env python3
"""Prepare recovered Director movies for browser runtime testing.

Disable the host's Windows installation guard and route client/host goMU
startup straight to the native browser adapter. Tutorial and goMU stay
byte-identical. A provenance record captures every changed byte and digest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path


MOVIES = ("client.dir", "tutorial.dir", "host.dir", "goMU.dir")

# Lscr 1069, handler SecurityCheck, compiled bytecode offset 1148.  This exact
# sequence is unique in the recovered host DIR. Opcode 0x01 is `ret`.
SECURITY_CHECK_BYTECODE = bytes.fromhex(
    "44124301574a614b520044134301574a614b520144144c010a4415441644174304"
    "97036b52024c024c000f95000693000e441842015784420097027501"
)

# Recovered goMuInit.beginSprite ends with me.doPreload(). That loader only
# locates the obsolete linked goMU movie and can halt on its local-media guard.
# The runtime now supplies goMUstart natively, so call the existing goMUinit()
# handler directly. Only the method-name operand changes; arguments, setup,
# and all gameplay handlers remain intact. Names are resolved in the original
# LASM: client doPreload=2/goMUinit=3; host doPreload=91/goMUinit=92.
GOMU_STARTUP_BYTECODE = {
    "client.dir": ("Lscr-121550", bytes.fromhex(
        "4b0061104301570f500e4a0eae01f462114a0e611350124a0e611550144a1695000d"
        "4a1442015717420057184b00420167014b004201670201"
    ), 3),
    "host.dir": ("Lscr-1070", bytes.fromhex(
        "4b0061694301576850674a67616b506a4a67614a506c4a6d95000d4a6c4201576e"
        "420057484b004201675a4b004201675b01"
    ), 92),
}


def patch_gomu_startup(path: Path) -> dict[str, object]:
    chunk, signature, target_name_id = GOMU_STARTUP_BYTECODE[path.name]
    data = bytearray(path.read_bytes())
    first = data.find(signature)
    if first < 0 or data.find(signature, first + 1) >= 0:
        raise RuntimeError(f"{path.name} goMuInit.beginSprite signature missing or ambiguous")
    offset = first + len(signature) - 2
    assert data[offset - 1] == 0x67 and data[offset + 1] == 0x01
    old = data[offset]
    data[offset] = target_name_id
    path.write_bytes(data)
    return {
        "movie": path.name,
        "chunk": chunk,
        "handler": "goMuInit.beginSprite",
        "absolute_offset": offset,
        "change": "call existing goMUinit directly instead of legacy linked-movie doPreload",
        "requires": "runtime with native GoMuXtra goMUstart handler",
        "old_bytes": bytes([old]).hex(),
        "new_bytes": bytes([target_name_id]).hex(),
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def patch_host(path: Path) -> dict[str, object]:
    data = bytearray(path.read_bytes())
    first = data.find(SECURITY_CHECK_BYTECODE)
    if first < 0:
        raise RuntimeError("host SecurityCheck bytecode signature was not found")
    if data.find(SECURITY_CHECK_BYTECODE, first + 1) >= 0:
        raise RuntimeError("host SecurityCheck bytecode signature is not unique")

    old = bytes(data[first : first + len(SECURITY_CHECK_BYTECODE)])
    data[first] = 0x01  # ret
    path.write_bytes(data)
    return {
        "movie": path.name,
        "chunk": "Lscr-1069",
        "handler": "SecurityCheck",
        "absolute_offset": first,
        "change": "replace first opcode with ret (0x01)",
        "old_bytes": old.hex(),
        "new_bytes": bytes(data[first : first + len(old)]).hex(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path("recovered/director/movies/original"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("recovered/director/movies/browser-ready"),
    )
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, object]] = []
    for name in MOVIES:
        source = args.source_dir / name
        if not source.is_file():
            raise FileNotFoundError(source)
        destination = args.output_dir / name
        shutil.copyfile(source, destination)
        records.append(
            {
                "movie": name,
                "source": str(source),
                "source_sha256": sha256(source),
                "output": str(destination),
            }
        )

    patches = [patch_host(args.output_dir / "host.dir")]
    patches.extend(patch_gomu_startup(args.output_dir / name) for name in GOMU_STARTUP_BYTECODE)
    for record in records:
        record["output_sha256"] = sha256(Path(str(record["output"])))
        record["modified"] = record["source_sha256"] != record["output_sha256"]

    provenance = {
        "format": 1,
        "policy": "Adapt Windows install guard and goMU linked-movie startup to the native browser adapter; preserve gameplay bytecode.",
        "movies": records,
        "patches": patches,
    }
    provenance_path = args.output_dir / "provenance.json"
    provenance_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(provenance_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
