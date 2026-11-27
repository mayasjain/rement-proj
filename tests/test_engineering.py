import subprocess
import sys

import pytest

from app.backend.engineering import evaluate
from app.backend.models import Plant
from app.backend.plant_files import BASELINE, load_plant


def scenario(feed, crusher_capacity=12, fine=0.6):
    data = load_plant(BASELINE).model_dump(by_alias=True)
    data["requirements"].update(requested_feed_tph=feed, screen_fine_fraction=fine)
    crusher = next(item for item in data["equipment"] if item["type"] == "crusher")
    crusher["specifications"]["max_solids_throughput_tph"] = crusher_capacity
    return Plant.model_validate(data)


@pytest.mark.parametrize(
    ("feed", "rating", "maximum", "sand", "gravel", "limiter", "feasible"),
    [
        (10, 12, 12, 6, 4, ("C-001",), True),
        (11, 12, 12, 6.6, 4.4, ("C-001",), True),
        (13.2, 12, 12, 7.2, 4.8, ("C-001",), False),
        (13.2, 15, 8 / 0.6, 7.92, 5.28, ("W-001",), True),
        (14, 15, 8 / 0.6, 8, (8 / 0.6) * 0.4, ("W-001",), False),
        (8 / 0.6, 15, 8 / 0.6, 8, (8 / 0.6) * 0.4, ("W-001",), True),
    ],
)
def test_demo_scenarios(feed, rating, maximum, sand, gravel, limiter, feasible):
    result = evaluate(scenario(feed, rating))
    assert result.requested_feed_tph == feed
    assert result.maximum_feasible_feed_tph == pytest.approx(maximum)
    assert result.achievable_feed_tph == pytest.approx(min(feed, maximum))
    assert result.sand_output_tph == pytest.approx(sand)
    assert result.gravel_output_tph == pytest.approx(gravel)
    assert result.mass_balance_residual_tph == pytest.approx(0, abs=1e-9)
    assert result.limiting_equipment_ids == limiter
    assert result.feasible is feasible
    assert tuple(finding.equipment_ids[0] for finding in result.findings) == (() if feasible else limiter)


def test_crusher_upgrade_comparison():
    baseline = evaluate(scenario(13.2))
    upgraded = evaluate(scenario(13.2, crusher_capacity=15))
    crusher = baseline.equipment["C-001"]
    assert crusher.utilization == pytest.approx(1.1)
    assert crusher.required_tph == 13.2
    assert crusher.achievable_tph == 12
    fine_stream = baseline.streams["stream-03"]
    assert fine_stream.required_tph == pytest.approx(7.92)
    assert fine_stream.achievable_tph == pytest.approx(7.2)
    assert baseline.equipment["A-001"].utilization is None
    finding, = baseline.findings
    assert (finding.rule_id, finding.severity, finding.equipment_ids) == (
        "equipment_overload", "error", ("C-001",)
    )
    assert (finding.actual, finding.limit) == (13.2, 12)
    assert "Jaw crusher" in finding.explanation
    assert upgraded.achievable_feed_tph == 13.2
    assert upgraded.findings == ()


@pytest.mark.parametrize("fine", [0.0, 0.6, 1.0])
def test_zero_requested_feed(fine):
    result = evaluate(scenario(0, fine=fine))
    assert result.feasible
    assert result.achievable_feed_tph == result.sand_output_tph == result.gravel_output_tph == 0
    assert all(flow.required_tph == flow.achievable_tph == 0 for flow in result.streams.values())


@pytest.mark.parametrize(
    ("fine", "maximum", "sand", "gravel", "limiter"),
    [(0.0, 6, 0, 6, "G-001"), (1.0, 8, 8, 0, "W-001")],
)
def test_inactive_branch(fine, maximum, sand, gravel, limiter):
    result = evaluate(scenario(10, fine=fine))
    assert result.maximum_feasible_feed_tph == maximum
    assert (result.sand_output_tph, result.gravel_output_tph) == (sand, gravel)
    assert result.limiting_equipment_ids == (limiter,)
    assert result.mass_balance_residual_tph == 0


def test_equipment_ids_and_stream_order_are_data_driven():
    data = scenario(13.2).model_dump(by_alias=True)
    for item in data["equipment"]:
        item["id"] = "new-" + item["id"]
    data["connections"].reverse()
    for stream in data["connections"]:
        for endpoint in ("from", "to"):
            stream[endpoint]["equipment_id"] = "new-" + stream[endpoint]["equipment_id"]
    result = evaluate(Plant.model_validate(data))
    assert result.limiting_equipment_ids == ("new-C-001",)
    assert result.sand_output_tph == pytest.approx(7.2)


def test_cli_previews_without_writing_plant_files():
    before = {path: path.read_bytes() for path in BASELINE.rglob("*.yaml")}
    command = [sys.executable, "-m", "app.backend", "evaluate", "--plant", str(BASELINE), "--feed", "13.2"]
    overloaded = subprocess.run(command, capture_output=True, text=True, check=True).stdout
    upgraded = subprocess.run(
        [*command, "--crusher-capacity", "15"], capture_output=True, text=True, check=True
    ).stdout
    assert "Infeasible" in overloaded and "110.0%" in overloaded
    assert "Feasible" in upgraded and "Sand output: 7.92 t/h" in upgraded
    assert before == {path: path.read_bytes() for path in BASELINE.rglob("*.yaml")}
