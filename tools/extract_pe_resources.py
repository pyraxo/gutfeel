#!/usr/bin/env python3
"""Extract icon and raw metadata resources from Windows projector executables."""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

import pefile


RT_ICON = 3
RT_STRING = 6
RT_GROUP_ICON = 14
RT_VERSION = 16


def resource_bytes(pe: pefile.PE, entry: object) -> bytes:
    data = entry.data.struct
    return pe.get_data(data.OffsetToData, data.Size)


def leaf_entries(type_entry: object) -> list[tuple[int, int, bytes]]:
    leaves: list[tuple[int, int, bytes]] = []
    resource_id = 0
    for name_entry in type_entry.directory.entries:
        resource_id = int(name_entry.id or 0)
        for language_entry in name_entry.directory.entries:
            leaves.append((resource_id, int(language_entry.id or 0), language_entry))
    return leaves


def build_ico(group: bytes, icons: dict[int, bytes]) -> bytes:
    reserved, image_type, count = struct.unpack_from("<HHH", group, 0)
    if reserved != 0 or image_type != 1:
        raise ValueError("unsupported group icon header")
    entries: list[tuple[bytes, bytes]] = []
    for index in range(count):
        offset = 6 + index * 14
        width, height, colors, reserved2, planes, bits, size, icon_id = struct.unpack_from(
            "<BBBBHHIH", group, offset
        )
        image = icons[icon_id]
        if size != len(image):
            size = len(image)
        prefix = struct.pack("<BBBBHHI", width, height, colors, reserved2, planes, bits, size)
        entries.append((prefix, image))
    data_offset = 6 + count * 16
    directory = bytearray(struct.pack("<HHH", 0, 1, count))
    payload = bytearray()
    for prefix, image in entries:
        directory.extend(prefix)
        directory.extend(struct.pack("<I", data_offset + len(payload)))
        payload.extend(image)
    return bytes(directory + payload)


def extract(executable: Path, output: Path) -> dict[str, object]:
    pe = pefile.PE(str(executable))
    output.mkdir(parents=True, exist_ok=True)
    icons: dict[int, bytes] = {}
    groups: list[tuple[int, int, bytes]] = []
    resources: list[dict[str, object]] = []
    labels = {RT_ICON: "icon", RT_STRING: "string", RT_GROUP_ICON: "group-icon", RT_VERSION: "version"}
    for type_entry in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        resource_type = int(type_entry.id or 0)
        for resource_id, language, language_entry in leaf_entries(type_entry):
            payload = resource_bytes(pe, language_entry)
            label = labels.get(resource_type, f"type-{resource_type}")
            raw_path = output / f"{label}-{resource_id}-lang-{language}.bin"
            raw_path.write_bytes(payload)
            resources.append({
                "type": resource_type,
                "id": resource_id,
                "language": language,
                "size": len(payload),
                "path": raw_path.name,
            })
            if resource_type == RT_ICON:
                icons[resource_id] = payload
            elif resource_type == RT_GROUP_ICON:
                groups.append((resource_id, language, payload))

    for resource_id, language, payload in groups:
        (output / f"projector-{resource_id}-lang-{language}.ico").write_bytes(build_ico(payload, icons))
    result = {"source": str(executable), "resources": resources}
    (output / "manifest.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("executables", nargs="+", type=Path)
    args = parser.parse_args()
    for executable in args.executables:
        extract(executable, args.output / executable.stem.replace(" ", "-"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
