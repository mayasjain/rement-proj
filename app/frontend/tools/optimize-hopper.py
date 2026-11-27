"""Resize embedded textures in the original Innerscene GLB (CC0) with macOS sips."""
import argparse
import json
from pathlib import Path
import struct
import subprocess
from tempfile import TemporaryDirectory


def optimize(source: Path, target: Path) -> None:
    raw = source.read_bytes()
    magic, version, size = struct.unpack_from("<4sII", raw)
    if (magic, version, size) != (b"glTF", 2, len(raw)):
        raise ValueError("Expected a glTF 2.0 binary.")
    length, kind = struct.unpack_from("<I4s", raw, 12)
    if kind != b"JSON":
        raise ValueError("Missing JSON chunk.")
    model = json.loads(raw[20:20 + length])
    binary = raw[28 + length:]
    images = {image["bufferView"]: image["mimeType"] for image in model["images"]}
    output = bytearray()
    with TemporaryDirectory() as folder:
        for index, view in enumerate(model["bufferViews"]):
            start = view.get("byteOffset", 0)
            data = binary[start:start + view["byteLength"]]
            if index in images:
                media = images[index]
                path = Path(folder) / ("texture.png" if media == "image/png" else "texture.jpg")
                path.write_bytes(data)
                args = ["sips", "-Z", "384"]
                if media == "image/jpeg":
                    args.extend(["-s", "formatOptions", "74"])
                subprocess.run([*args, str(path)], check=True, capture_output=True)
                data = path.read_bytes()
            view.update(byteOffset=len(output), byteLength=len(data))
            output.extend(data)
            output.extend(b"\x00" * (-len(output) % 4))
    model["buffers"][0]["byteLength"] = len(output)
    metadata = json.dumps(model, separators=(",", ":")).encode()
    metadata += b" " * (-len(metadata) % 4)
    target.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 28 + len(metadata) + len(output))
        + struct.pack("<I4s", len(metadata), b"JSON") + metadata
        + struct.pack("<I4s", len(output), b"BIN\x00") + output
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    options = parser.parse_args()
    optimize(options.source, options.target)
