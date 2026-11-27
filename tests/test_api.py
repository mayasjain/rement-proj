from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from shutil import copytree

from fastapi.testclient import TestClient
import pytest
import yaml

from app.backend.api import create_app
from app.backend import plant_store
from app.backend.plant_files import BASELINE, git, initialize_plant, load_plant, plant_documents
from app.backend.preview import DesignDraft, apply_design, create_preview_app


def design_from(snapshot):
    snapshot = deepcopy(snapshot)
    return {
        "expected_revision": snapshot["revision"],
        "requirements": snapshot["plant"]["requirements"],
        "equipment": {
            item["id"]: {"specifications": item["specifications"], **{
                field: item["geometry"][field] for field in ("position_m", "rotation_deg", "dimensions_m")
            }}
            for item in snapshot["plant"]["equipment"]
        },
    }


def upgrade(snapshot):
    draft = design_from(snapshot)
    draft["requirements"]["requested_feed_tph"] = 13.2
    draft["equipment"]["C-001"]["specifications"]["max_solids_throughput_tph"] = 15
    return draft


def test_baseline_and_read_only_previews(tmp_path):
    plant = copytree(BASELINE, tmp_path / "plant")
    before = {path: path.read_bytes() for path in plant.rglob("*.yaml")}

    with TestClient(create_app(plant)) as client:
        baseline = client.get("/plant").raise_for_status().json()
        assert baseline["result"]["requested_feed_tph"] == 11
        assert baseline["result"]["sand_output_tph"] == pytest.approx(6.6)
        assert len(baseline["plant"]["equipment"]) == 7
        assert len(baseline["plant"]["components"]) == 3
        assert len(baseline["plant"]["connections"]) == 6
        assert baseline["plant"]["connections"][0]["from"]["equipment_id"] == "F-001"

        draft = {"requested_feed_tph": 13.2, "equipment_capacities_tph": {}}
        overloaded = client.post("/plant/simulate", json=draft).raise_for_status().json()
        assert overloaded["result"]["achievable_feed_tph"] == 12
        assert overloaded["result"]["findings"][0]["equipment_ids"] == ["C-001"]

        draft["equipment_capacities_tph"]["C-001"] = 15
        upgraded = client.post("/plant/simulate", json=draft).raise_for_status().json()
        assert upgraded["result"]["achievable_feed_tph"] == 13.2
        assert upgraded["result"]["sand_output_tph"] == pytest.approx(7.92)
        assert upgraded["result"]["gravel_output_tph"] == pytest.approx(5.28)
        assert upgraded["result"]["findings"] == []
        assert client.get("/plant").raise_for_status().json() == baseline
        assert client.put("/plant", json=draft).status_code == 422

    assert before == {path: path.read_bytes() for path in plant.rglob("*.yaml")}


@pytest.mark.parametrize("feed, ratings", [
    (-1, {}), (11, {"C-001": 0}), (11, {"A-001": 10}), (11, {"UNKNOWN": 10}),
])
def test_rejects_invalid_drafts(tmp_path, feed, ratings):
    with TestClient(create_app(copytree(BASELINE, tmp_path / "plant"))) as client:
        response = client.post("/plant/simulate", json={
            "requested_feed_tph": feed, "equipment_capacities_tph": ratings,
        })
    assert response.status_code == 422


def test_missing_plant_has_actionable_error(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        response = client.get("/plant")
    assert response.status_code == 503
    assert "factory.yaml" in response.json()["detail"]


def test_save_and_restart(tmp_path):
    plant = tmp_path / "plant"
    initialize_plant(plant)
    with TestClient(create_app(plant)) as client:
        baseline = client.get("/plant").raise_for_status().json()
        assert baseline["git_dirty"] is False
        draft = upgrade(baseline)
        draft["equipment"]["C-001"]["position_m"] = [4, 0, 1]
        draft["equipment"]["C-001"]["specifications"]["rated_power_kw"] = 24
        saved = client.put("/plant", json=draft).raise_for_status().json()
        assert saved["git_dirty"] is True
        assert saved["revision"] != baseline["revision"]
        assert saved["result"]["achievable_feed_tph"] == 13.2
        assert saved["result"]["sand_output_tph"] == pytest.approx(7.92)
        assert saved["result"]["findings"] == []
        assert client.put("/plant", json=draft).status_code == 409

    assert yaml.safe_load((plant / "requirements.yaml").read_text())["requested_feed_tph"] == 13.2
    crusher = yaml.safe_load((plant / "equipment/C-001.yaml").read_text())
    assert crusher["specifications"] == {"max_solids_throughput_tph": 15, "rated_power_kw": 24}
    assert crusher["geometry"]["position_m"] == [4, 0, 1]
    assert git(plant, "diff", "--name-only").splitlines() == ["equipment/C-001.yaml", "requirements.yaml"]
    with TestClient(create_app(plant)) as restarted:
        assert restarted.get("/plant").raise_for_status().json() == saved


def test_external_edits_and_malformed_yaml(tmp_path):
    plant = copytree(BASELINE, tmp_path / "plant")
    requirements = plant / "requirements.yaml"
    with TestClient(create_app(plant)) as client:
        draft = upgrade(client.get("/plant").raise_for_status().json())
        requirements.write_text("requested_feed_tph: 10\nscreen_fine_fraction: 0.5\n")
        response = client.put("/plant", json=draft)
        assert response.status_code == 409
        assert "Reload" in response.json()["detail"]
        current = client.get("/plant").raise_for_status().json()
        assert current["result"]["sand_output_tph"] == 5
        crusher = plant / "equipment/C-001.yaml"
        data = yaml.safe_load(crusher.read_text())
        data["geometry"]["position_m"] = [4, 0, 2]
        crusher.write_text(yaml.safe_dump(data))
        loaded = client.get("/plant").raise_for_status().json()
        model = next(item for item in loaded["plant"]["equipment"] if item["id"] == "C-001")
        assert model["geometry"]["position_m"] == [4, 0, 2]
        assert loaded["revision"] != current["revision"]
        requirements.write_text("requested_feed_tph: [")
        assert client.put("/plant", json=draft).status_code == 409
        error = client.get("/plant")
        assert error.status_code == 503 and "requirements.yaml" in error.json()["detail"]
        assert requirements.read_text() == "requested_feed_tph: ["


def test_validate_whole_draft_and_save_overload(tmp_path):
    plant = copytree(BASELINE, tmp_path / "plant")
    before = plant_documents(plant)
    with TestClient(create_app(plant)) as client:
        draft = upgrade(client.get("/plant").raise_for_status().json())
        draft["equipment"]["C-001"]["dimensions_m"][0] = 0
        assert client.put("/plant", json=draft).status_code == 422
        assert plant_documents(plant) == before
        draft["equipment"]["C-001"]["dimensions_m"][0] = 2
        draft["equipment"]["C-001"]["specifications"]["max_solids_throughput_tph"] = 12
        preview = client.post("/plant/simulate", json={
            key: value for key, value in draft.items() if key != "expected_revision"
        }).raise_for_status().json()
        assert preview["result"]["achievable_feed_tph"] == 12
        assert plant_documents(plant) == before
        saved = client.put("/plant", json=draft).raise_for_status().json()
        assert saved["result"] == preview["result"]
        assert saved["result"]["findings"][0]["equipment_ids"] == ["C-001"]


def test_concurrent_saves_share_one_revision_check(tmp_path):
    plant = copytree(BASELINE, tmp_path / "plant")
    with TestClient(create_app(plant)) as client, ThreadPoolExecutor(2) as pool:
        baseline = client.get("/plant").raise_for_status().json()
        first, second = upgrade(baseline), design_from(baseline)
        second["requirements"]["requested_feed_tph"] = 10
        requests = [pool.submit(client.put, "/plant", json=body) for body in (first, second)]
        responses = [request.result() for request in requests]
        assert sorted(response.status_code for response in responses) == [200, 409]
        committed = next(response.json() for response in responses if response.status_code == 200)
        assert client.get("/plant").raise_for_status().json() == committed


@pytest.mark.parametrize("failure", [OSError, KeyboardInterrupt])
def test_failed_and_interrupted_save_recovers(tmp_path, monkeypatch, failure):
    plant = tmp_path / "plant"
    initialize_plant(plant)
    before = plant_documents(plant)
    store = plant_store.PlantStore(plant)
    write = plant_store.atomic_write

    def fail_after_first_file(path, content):
        if path.name == "C-001.yaml":
            raise failure("simulated interruption")
        write(path, content)

    with TestClient(create_app(plant)) as client:
        baseline = client.get("/plant").raise_for_status().json()
        with monkeypatch.context() as patch:
            patch.setattr(plant_store, "atomic_write", fail_after_first_file)
            if failure is KeyboardInterrupt:
                body = upgrade(baseline)
                expected_revision = body.pop("expected_revision")
                draft = DesignDraft.model_validate(body)
                with pytest.raises(KeyboardInterrupt):
                    store.save(expected_revision, lambda current: apply_design(current, draft))
                assert store.journal.exists()
            else:
                response = client.put("/plant", json=upgrade(baseline))
                assert response.status_code == 503
                assert not store.journal.exists()
                assert plant_documents(plant) == before

    with TestClient(create_app(plant)) as restarted:
        assert restarted.get("/plant").raise_for_status().json() == baseline
    assert not store.journal.exists()
    assert plant_documents(plant) == before


def test_cloud_preview_has_no_save_endpoint():
    with TestClient(create_preview_app(lambda: load_plant(BASELINE), prefix="/api")) as client:
        assert client.get("/api/plant").raise_for_status().json()["revision"] is None
        assert client.put("/api/plant", json={}).status_code == 405
