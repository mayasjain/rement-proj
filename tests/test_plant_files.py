from pathlib import Path
import shutil
import subprocess
import sys

import pytest
import yaml

from app.backend.plant_files import BASELINE, PlantError, load_plant


@pytest.fixture
def plant_dir(tmp_path):
    return shutil.copytree(BASELINE, tmp_path / "plant")


def edit_yaml(path, edit):
    data = yaml.safe_load(path.read_text())
    edit(data)
    path.write_text(yaml.safe_dump(data))


def test_baseline():
    plant = load_plant(BASELINE)
    assert len(plant.equipment) == 7
    assert len(plant.connections) == 6
    assert plant.requirements.requested_feed_tph == 11
    assert plant.requirements.screen_fine_fraction == 0.60
    crusher = next(item for item in plant.equipment if item.type == "crusher")
    assert crusher.specifications.max_solids_throughput_tph == 12
    assert crusher.component_ids == ["C-001-motor", "C-001-jaw", "C-001-frame"]


@pytest.mark.parametrize(("file", "edit", "message"), [
    ("equipment/F-001.yaml", lambda data: data.update(id="C-001"), "Duplicate plant object ID C-001"),
    ("equipment/C-001.yaml", lambda data: data["ports"].append(data["ports"][0]), "Duplicate port on C-001"),
    ("equipment/C-001.yaml", lambda data: data["component_ids"].append("missing"), "missing component missing"),
    ("connections.yaml", lambda data: data["connections"][0]["from"].update(equipment_id="missing"),
     "missing equipment missing"),
    ("connections.yaml", lambda data: data["connections"][0]["from"].update(port_id="missing"),
     "missing port F-001.missing"),
    ("connections.yaml", lambda data: data["connections"][0].update(material="sand"), "incompatible with F-001"),
    ("connections.yaml", lambda data: data["connections"][0]["to"].update(port_id="outlet"),
     "needs an input port"),
    ("connections.yaml", lambda data: data["connections"].pop(), "Disconnected process ports"),
    ("equipment/C-001.yaml", lambda data: data["specifications"].update(max_solids_throughput_tph=-1),
     "max_solids_throughput_tph"),
    ("equipment/C-001.yaml", lambda data: data["geometry"].update(dimensions_m=[0, 2, 3]), "dimensions_m"),
    ("requirements.yaml", lambda data: data.update(screen_fine_fraction=1.1), "screen_fine_fraction"),
    ("requirements.yaml", lambda data: data.update(screen_fine_fraction=True), "screen_fine_fraction"),
    ("requirements.yaml", lambda data: data.update(requested_feed_tph=float("inf")), "requested_feed_tph"),
])
def test_invalid_models(plant_dir, file, edit, message):
    edit_yaml(plant_dir / file, edit)
    with pytest.raises(PlantError, match=message):
        load_plant(plant_dir)


def test_cycle(plant_dir):
    edit_yaml(plant_dir / "equipment/F-001.yaml", lambda data: data["ports"].append(
        {"id": "return", "direction": "input", "material": "crushed_aggregate"}
    ))
    edit_yaml(plant_dir / "connections.yaml", lambda data: data["connections"][1]["to"].update(
        equipment_id="F-001", port_id="return"
    ))
    with pytest.raises(PlantError, match="Process cycle"):
        load_plant(plant_dir)


def test_unsupported_shared_storage(plant_dir):
    edit_yaml(plant_dir / "equipment/A-001.yaml", lambda data: data["ports"].append(
        {"id": "gravel", "direction": "input", "material": "gravel"}
    ))
    edit_yaml(plant_dir / "equipment/B-001.yaml", lambda data: data.update(ports=[]))
    edit_yaml(plant_dir / "connections.yaml", lambda data: data["connections"][-1]["to"].update(
        equipment_id="A-001", port_id="gravel"
    ))
    with pytest.raises(PlantError, match="Unsupported process layout"):
        load_plant(plant_dir)


def test_unsafe_yaml_tag(plant_dir):
    (plant_dir / "requirements.yaml").write_text("!!python/name:builtins.print")
    with pytest.raises(PlantError, match="requirements.yaml.*could not determine a constructor"):
        load_plant(plant_dir)


def test_cli_from_clean_source_copy(tmp_path):
    source = tmp_path / "application"
    shutil.copytree(BASELINE.parent, source / "app",
                    ignore=shutil.ignore_patterns("__pycache__"))

    def cli(command):
        return subprocess.run([sys.executable, "-m", "app.backend", command], cwd=source,
                              check=True, capture_output=True, text=True).stdout

    plant = source / "demo-plant"

    def git(*args):
        return subprocess.run(["git", "-C", str(plant), *args], check=True,
                              capture_output=True, text=True).stdout.strip()

    assert "Initialized plant repository" in cli("init")
    assert Path(git("rev-parse", "--show-toplevel")) == plant.resolve()
    baseline = git("rev-parse", "HEAD")
    assert git("rev-list", "--count", "HEAD") == "1"
    assert git("status", "--porcelain") == ""
    output = cli("validate")
    for label in ["Requested feed: 11 t/h", "Screen fine fraction: 60%", "Equipment (7)",
                  "Material streams (6)", "C-001-motor", "C-001-jaw", "C-001-frame"]:
        assert label in output

    edit_yaml(plant / "requirements.yaml", lambda data: data.update(requested_feed_tph=10))
    assert "already exists" in cli("init")
    assert git("rev-parse", "HEAD") == baseline
    assert git("status", "--porcelain") == "M requirements.yaml"
    assert "Requested feed: 10 t/h" in cli("validate")


def test_cli_preserves_non_repository_directory(tmp_path):
    marker = tmp_path / "existing.txt"
    marker.write_text("keep")
    result = subprocess.run([sys.executable, "-m", "app.backend", "init", "--plant", str(tmp_path)],
                            capture_output=True, text=True)
    assert result.returncode == 1
    assert "already exists" in result.stderr
    assert list(tmp_path.iterdir()) == [marker]
