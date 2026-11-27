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


def read_yaml(path, model):
    try:
        with path.open(encoding="utf-8") as stream:
            data = yaml.safe_load(stream)
        return model.model_validate(data)
    except (OSError, UnicodeError, yaml.YAMLError, ValidationError) as error:
        raise PlantError(f"{path}: {error}") from error


def load_plant(root: Path) -> Plant:
    factory = read_yaml(root / "factory.yaml", Factory)
    requirements = read_yaml(root / "requirements.yaml", Requirements)
    connections = read_yaml(root / "connections.yaml", Connections).connections
    equipment = [read_yaml(path, Equipment) for path in sorted((root / "equipment").glob("*.yaml"))]
    components = [read_yaml(path, Component) for path in sorted((root / "components").glob("*.yaml"))]
    try:
        return Plant(factory=factory, requirements=requirements, equipment=equipment,
                     components=components, connections=connections)
    except ValidationError as error:
        raise PlantError(f"{root}: {error}") from error


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
