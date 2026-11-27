import argparse
import json
from pathlib import Path
from shutil import copyfile, copytree

from app.backend.plant_files import BASELINE, load_plant
from app.backend.plant_git import PlantGit
from app.backend.plant_store import PlantStore

ROOT = Path(__file__).resolve().parents[2]


def stage(destination: Path, history_repo: Path | None = None) -> None:
    config = Path(__file__).resolve().parent
    frontend = ROOT / "app" / "frontend" / "dist"
    if not (frontend / "index.html").is_file():
        raise SystemExit("Build app/frontend before staging the Cloudflare Worker.")
    baseline = load_plant(BASELINE)
    history = None
    if history_repo is not None:
        store = PlantStore(history_repo)
        repository = PlantGit(store)
        status = repository.status()
        if status.dirty or store.read().plant != baseline:
            raise SystemExit("Publish history from a clean demo repository at the sample baseline.")
        history = {
            "status": status.model_dump(mode="json"),
            "comparisons": {
                commit.hash: [change.model_dump(mode="json") for change in repository.diff(commit.hash, "head")]
                for commit in status.history
            },
        }
        if repository.status() != status or store.read().plant != baseline:
            raise SystemExit("The demo repository changed while exporting history. Try staging again.")
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
    (source / "demo_fixture.py").write_text(
        f"PLANT_JSON = {baseline.model_dump_json(by_alias=True)!r}\nHISTORY_JSON = {json.dumps(history)!r}\n",
        encoding="utf-8",
    )
    copytree(frontend, destination / "public")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Stage a read-only demo for Cloudflare Workers")
    parser.add_argument("destination", type=Path, help="a new staging directory")
    parser.add_argument("--history-repo", type=Path, help="a demo Git repository whose history is safe to publish")
    args = parser.parse_args()
    stage(args.destination, args.history_repo)
