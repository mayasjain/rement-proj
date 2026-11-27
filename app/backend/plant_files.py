from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory

from pydantic import ValidationError
import yaml

from .models import Component, Connections, Equipment, Factory, Plant, Requirements

APP = Path(__file__).resolve().parents[1]
BASELINE = APP / "baseline"
DEFAULT_PLANT = APP.parent / "demo-plant"


class PlantError(Exception):
    """An actionable error reading or initializing a plant."""


def read_yaml(path, model, content: bytes):
    try:
        return model.model_validate(yaml.safe_load(content.decode("utf-8")))
    except (UnicodeError, yaml.YAMLError, ValidationError) as error:
        raise PlantError(f"{path}: {error}") from error


def plant_documents(root: Path) -> dict[Path, bytes]:
    paths = [root / name for name in ("factory.yaml", "requirements.yaml", "connections.yaml")]
    for directory in ("equipment", "components"):
        path = root / directory
        if path.is_symlink():
            raise PlantError(f"{path} must be a plant directory, not a symbolic link.")
        paths.extend(sorted(path.glob("*.yaml")))
    documents = {}
    for path in paths:
        try:
            if path.is_symlink() or not path.is_file():
                raise PlantError(f"{path} must be a regular YAML file.")
            documents[path.relative_to(root)] = path.read_bytes()
        except OSError as error:
            raise PlantError(f"{path}: {error}") from error
    return documents


def parse_plant(root: Path, documents: dict[Path, bytes]) -> Plant:
    def read(name, model):
        return read_yaml(root / name, model, documents[Path(name)])

    def read_group(directory, model):
        return [read(path, model) for path in documents if path.parent == Path(directory)]

    try:
        return Plant(
            factory=read("factory.yaml", Factory),
            requirements=read("requirements.yaml", Requirements),
            equipment=read_group("equipment", Equipment),
            components=read_group("components", Component),
            connections=read("connections.yaml", Connections).connections,
        )
    except ValidationError as error:
        raise PlantError(f"{root}: {error}") from error


def load_plant(root: Path) -> Plant:
    return parse_plant(root, plant_documents(root))


def git(root: Path, *args: str) -> str:
    try:
        result = subprocess.run(["git", "-C", str(root), *args], check=True,
                                capture_output=True, text=True)
    except subprocess.CalledProcessError as error:
        raise PlantError(f"Git {args[0]} failed in {root}: {error.stderr.strip()}") from error
    except OSError as error:
        raise PlantError(f"Could not run Git: {error}") from error
    return result.stdout.strip()


def initialize_plant(destination: Path) -> bool:
    """Return true on creation and false for an existing plant repository."""
    if destination.is_symlink():
        raise PlantError(f"{destination} is a symbolic link. Choose a plant directory.")
    if (destination / ".git").is_dir():
        git(destination, "rev-parse", "--verify", "HEAD")
        return False
    if destination.exists():
        raise PlantError(f"{destination} already exists. Choose a new directory for the demo plant.")

    load_plant(BASELINE)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".plant-setup-", dir=destination.parent) as directory:
        working_tree = Path(directory) / "plant"
        shutil.copytree(BASELINE, working_tree)
        git(working_tree, "init", "--initial-branch=main", "--template=")
        git(working_tree, "add", "--force", "--", "factory.yaml", "requirements.yaml",
            "connections.yaml", "equipment", "components")
        git(working_tree, "-c", "user.name=Plant-as-Code Demo",
            "-c", "user.email=demo@plant-as-code.invalid",
            "-c", "core.hooksPath=/dev/null",
            "commit", "--no-gpg-sign", "-m", "Seed aggregate recycling baseline")
        working_tree.rename(destination)
    return True
