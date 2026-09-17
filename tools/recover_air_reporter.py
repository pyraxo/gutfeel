#!/usr/bin/env python3
"""Unpack the original AIR reporter and export its SWF with JPEXS FFDec."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


EXPECTED_AIR_SHA256 = "e04104b1c46128962d10196cd6b849fed49cd89f81ecc4081612847d38916800"
EXPECTED_FFDEC_ZIP_SHA256 = "35f4930eb7c380afe66f2117f90b006deac0631473ad7500bb39c78f68645ecd"

WEB_ASSETS = {
    "ICON/128.png": "icon.png",
    "images/133.png": "anatomy.png",
    "images/174.png": "objective-table.png",
    "images/241.png": "brain.png",
    "images/247.png": "saliva.png",
    "images/251.png": "biting.png",
    "images/255.png": "oesophagus.png",
    "images/259.png": "hcl.png",
    "images/263.png": "churning.png",
    "images/268.png": "turret-1.png",
    "images/275.png": "turret-2.png",
    "images/282.png": "absorption.png",
    "fonts/122_Copperplate Gothic Bold.ttf": "copperplate-gothic-bold.ttf",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--air", type=Path, default=Path("gutfeel-installed/report/GutFeelReporter.air"))
    parser.add_argument("--ffdec-dir", required=True, type=Path)
    parser.add_argument("--java", default="java")
    parser.add_argument("--seven-zip", default="7z")
    parser.add_argument("--output", type=Path, default=Path("recovered/report"))
    parser.add_argument("--web-assets", type=Path, default=Path("web/public/report-assets"))
    args = parser.parse_args()

    air = args.air.resolve()
    if sha256(air) != EXPECTED_AIR_SHA256:
        raise RuntimeError("GutFeelReporter.air does not match the recovered source hash")
    original = args.output / "original"
    decompiled = args.output / "decompiled"
    original.mkdir(parents=True, exist_ok=True)
    decompiled.mkdir(parents=True, exist_ok=True)
    shutil.copy2(air, original / air.name)

    unpacked = args.output / "unpacked"
    unpacked.mkdir(parents=True, exist_ok=True)
    # The signed AIR has a deliberately mismatched CRC on META-INF/AIR/hash.
    # 7-Zip reports that one header error but still recovers every payload.
    extraction = subprocess.run(
        [args.seven_zip, "x", "-y", f"-o{unpacked}", str(air)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if extraction.returncode not in (0, 2):
        raise RuntimeError(f"7-Zip failed with status {extraction.returncode}")
    swf = unpacked / "GutFeelReporter.swf"
    ffdec = args.ffdec_dir.resolve() / "ffdec-cli.jar"
    subprocess.run(
        [args.java, "-jar", str(ffdec), "-onerror", "abort", "-timeout", "120",
         "-export", "all", str(decompiled), str(swf)],
        check=True,
    )

    args.web_assets.mkdir(parents=True, exist_ok=True)
    for source_name, target_name in WEB_ASSETS.items():
        source_root = unpacked if source_name.startswith("ICON/") else decompiled
        shutil.copy2(source_root / source_name, args.web_assets / target_name)

    provenance = {
        "format": 1,
        "air": str(air),
        "air_sha256": sha256(air),
        "swf_sha256": sha256(swf),
        "ffdec_cli": str(ffdec),
        "jpexs_release": "26.3.0",
        "expected_ffdec_release_zip_sha256": EXPECTED_FFDEC_ZIP_SHA256,
    }
    (args.output / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
