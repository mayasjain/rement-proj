from shutil import copytree

from fastapi.testclient import TestClient
import pytest

from app.backend.api import create_app
from app.backend.plant_files import BASELINE


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
        assert client.put("/plant", json=draft).status_code == 405

    assert before == {path: path.read_bytes() for path in plant.rglob("*.yaml")}


@pytest.mark.parametrize("feed, ratings", [
    (-1, {}), (11, {"C-001": 0}), (11, {"A-001": 10}), (11, {"UNKNOWN": 10}),
])
def test_rejects_invalid_drafts(feed, ratings):
    with TestClient(create_app(BASELINE)) as client:
        response = client.post("/plant/simulate", json={
            "requested_feed_tph": feed, "equipment_capacities_tph": ratings,
        })
    assert response.status_code == 422


def test_missing_plant_has_actionable_error(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        response = client.get("/plant")
    assert response.status_code == 503
    assert "factory.yaml" in response.json()["detail"]
