from shutil import copytree

from fastapi.testclient import TestClient
import pytest
import yaml

from app.backend import plant_git
from app.backend.api import create_app
from app.backend.plant_files import BASELINE, PlantError, git, initialize_plant, plant_documents


@pytest.fixture
def repository(tmp_path):
    root = tmp_path / "plant"
    initialize_plant(root)
    with TestClient(create_app(root)) as client:
        yield root, client


def saved_upgrade(root):
    requirements = root / "requirements.yaml"
    requirements.write_text("requested_feed_tph: 13.2\nscreen_fine_fraction: 0.6\n")
    crusher = root / "equipment/C-001.yaml"
    contents = yaml.safe_load(crusher.read_text())
    contents["specifications"]["max_solids_throughput_tph"] = 15
    crusher.write_text(yaml.safe_dump(contents))


def state(client):
    status = client.get("/plant/git").raise_for_status().json()
    plant = client.get("/plant").raise_for_status().json()
    return status, {"expected_head": status["head"], "expected_revision": plant["revision"]}


def test_commit_diff_and_restore(repository):
    root, client = repository
    baseline, _ = state(client)
    before = plant_documents(root)
    saved_upgrade(root)
    draft, expected = state(client)
    assert draft["branch"] == "main" and draft["dirty"]
    changes = client.get("/plant/git/diff", params={"commit": baseline["head"]}).raise_for_status().json()
    assert changes == [
        {"field": "equipment.C-001.specifications.max_solids_throughput_tph", "before": 12, "after": 15},
        {"field": "requirements.requested_feed_tph", "before": 11, "after": 13.2},
    ]
    assert client.post("/plant/git/restore", json={**expected, "commit": baseline["head"]}).status_code == 409
    assert client.post("/plant/git/commit", json={**expected, "message": "Upgrade demo crusher"}).is_success
    upgraded, expected = state(client)
    assert upgraded["head"] != baseline["head"] and not upgraded["dirty"]
    assert client.get("/plant/git/diff", params={
        "commit": baseline["head"], "against": "head",
    }).raise_for_status().json() == changes
    restored = client.post("/plant/git/restore", json={
        **expected, "commit": baseline["head"],
    }).raise_for_status().json()
    assert restored["result"]["sand_output_tph"] == pytest.approx(6.6)
    assert restored["result"]["gravel_output_tph"] == pytest.approx(4.4)
    assert restored["result"]["equipment"]["C-001"]["capacity_tph"] == 12
    assert plant_documents(root) == before
    current, _ = state(client)
    assert not current["dirty"]
    assert [commit["hash"] for commit in current["history"][1:]] == [upgraded["head"], baseline["head"]]
    assert current["history"][0]["subject"].startswith("Restore plant snapshot")
    assert git(root, "rev-parse", "HEAD^") == upgraded["head"]
    assert git(root, "rev-parse", "HEAD^{tree}") == git(root, "rev-parse", f"{baseline['head']}^{{tree}}")


def test_commit_leaves_unrelated_file_and_handles_renamed_yaml(repository):
    root, client = repository
    (root / "notes.txt").write_text("Keep this local")
    (root / "equipment/C-001.yaml").rename(root / "equipment/crusher.yaml")
    _, expected = state(client)
    client.post("/plant/git/commit", json={**expected, "message": "Rename crusher YAML"}).raise_for_status()
    assert git(root, "status", "--porcelain") == "?? notes.txt"
    assert git(root, "show", "--format=", "--name-status", "HEAD").endswith(
        "equipment/C-001.yaml\tequipment/crusher.yaml"
    )


def test_rejects_stale_requests_staged_files_and_invalid_selectors(repository):
    root, client = repository
    initial, old_expected = state(client)
    saved_upgrade(root)
    assert client.post("/plant/git/commit", json={**old_expected, "message": "Stale"}).status_code == 409
    assert client.get("/plant/git/diff", params={"commit": "--all"}).status_code == 422
    _, expected = state(client)
    git(root, "add", "--", "requirements.yaml")
    assert client.post("/plant/git/commit", json={**expected, "message": "Staged"}).status_code == 409
    assert git(root, "rev-parse", "HEAD") == initial["head"]


def test_git_routes_do_not_fall_back_to_parent_repository(tmp_path):
    parent = tmp_path / "plant"
    initialize_plant(parent)
    nested = copytree(BASELINE, parent / "nested")
    with TestClient(create_app(nested)) as client:
        assert client.get("/plant").is_success
        assert client.get("/plant/git").status_code == 409


def test_restore_rolls_back_when_ref_cannot_be_updated(repository, monkeypatch):
    root, client = repository
    baseline, _ = state(client)
    saved_upgrade(root)
    _, expected = state(client)
    client.post("/plant/git/commit", json={**expected, "message": "Upgrade"}).raise_for_status()
    upgraded, expected = state(client)
    before = plant_documents(root)

    def fail_update(path, *args):
        if args[0] == "update-ref":
            raise PlantError("Simulated ref write failure")
        return git(path, *args)

    monkeypatch.setattr(plant_git, "git", fail_update)
    response = client.post("/plant/git/restore", json={**expected, "commit": baseline["head"]})
    assert response.status_code == 503
    assert plant_documents(root) == before
    assert git(root, "status", "--porcelain") == ""
    assert state(client)[0] == upgraded


def test_restore_does_not_change_non_plant_files(repository):
    root, client = repository
    baseline, _ = state(client)
    (root / "notes.txt").write_text("A file outside the plant design")
    git(root, "add", "--", "notes.txt")
    git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
        "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "-m", "Add notes")
    current, expected = state(client)
    response = client.post("/plant/git/restore", json={**expected, "commit": baseline["head"]})
    assert response.status_code == 409
    assert "outside the plant YAML" in response.json()["detail"]
    assert (root / "notes.txt").read_text() == "A file outside the plant design"
    assert git(root, "rev-parse", "HEAD") == current["head"]
