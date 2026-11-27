import argparse
from pathlib import Path
from shutil import copyfile, copytree

from app.backend.plant_files import BASELINE, load_plant

ROOT = Path(__file__).resolve().parents[2]


def stage(destination: Path) -> None:
    config = Path(__file__).resolve().parent
    frontend = ROOT / "app" / "frontend" / "dist"
    if not (frontend / "index.html").is_file():
        raise SystemExit("Build app/frontend before staging the Cloudflare Worker.")
    baseline = load_plant(BASELINE).model_dump_json(by_alias=True)
    destination.mkdir()
    source = destination / "src"
    source.mkdir()
    for name in ("wrangler.jsonc", "pyproject.toml"):
        copyfile(config / name, destination / name)
    copyfile(config / "worker.py", source / "worker.py")
    backend = source / "app" / "backend"
    backend.mkdir(parents=True)
    for name in ("engineering.py", "models.py", "preview.py"):
        copyfile(ROOT / "app" / "backend" / name, backend / name)
    (source / "demo_fixture.py").write_text(f"PLANT_JSON = {baseline!r}\n", encoding="utf-8")
    copytree(frontend, destination / "public")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Stage a read-only demo for Cloudflare Workers")
    parser.add_argument("destination", type=Path, help="a new staging directory")
    stage(parser.parse_args().destination)
