from collections import defaultdict
from dataclasses import dataclass
from math import isclose
from typing import Literal

from .models import Connection, Plant

RELATIVE_TOLERANCE = 1e-12
MASS_BALANCE_ABS_TOLERANCE_TPH = 1e-9


@dataclass(frozen=True)
class Finding:
    rule_id: str
    severity: Literal["error"]
    equipment_ids: tuple[str, ...]
    actual: float
    limit: float
    explanation: str


@dataclass(frozen=True)
class Flow:
    required_tph: float
    achievable_tph: float


@dataclass(frozen=True)
class EquipmentFlow(Flow):
    capacity_tph: float | None
    utilization: float | None


@dataclass(frozen=True)
class ThroughputResult:
    requested_feed_tph: float
    maximum_feasible_feed_tph: float
    achievable_feed_tph: float
    sand_output_tph: float
    gravel_output_tph: float
    mass_balance_residual_tph: float
    limiting_equipment_ids: tuple[str, ...]
    equipment: dict[str, EquipmentFlow]
    streams: dict[str, Flow]
    findings: tuple[Finding, ...]

    @property
    def feasible(self) -> bool:
        return not self.findings


def evaluate(plant: Plant) -> ThroughputResult:
    """Evaluate the validated dry-solids process graph without file or Git access."""
    equipment = {item.id: item for item in plant.equipment}
    outgoing: dict[str, list[Connection]] = defaultdict(list)
    for stream in plant.connections:
        outgoing[stream.source.equipment_id].append(stream)

    hopper = next(item for item in plant.equipment if item.type == "hopper")
    requested = plant.requirements.requested_feed_tph
    fine = plant.requirements.screen_fine_fraction

    # The validated topology has one incoming stream per equipment item after the hopper.
    equipment_fractions = {hopper.id: 1.0}
    stream_fractions = {}
    pending = [hopper.id]
    while pending:
        source_id = pending.pop()
        for stream in outgoing[source_id]:
            fraction = equipment_fractions[source_id]
            if equipment[source_id].type == "screen":
                fraction *= fine if stream.material == "fine_aggregate" else 1.0 - fine
            destination_id = stream.destination.equipment_id
            stream_fractions[stream.id] = fraction
            equipment_fractions[destination_id] = fraction
            pending.append(destination_id)

    feed_limits = {}
    for item in plant.equipment:
        capacity = item.specifications.max_solids_throughput_tph
        fraction = equipment_fractions[item.id]
        if capacity is not None and fraction > 0:
            feed_limits[item.id] = capacity / fraction
    maximum = min(feed_limits.values())
    achievable = min(requested, maximum)

    equipment_flows = {}
    findings = []
    for item in plant.equipment:
        fraction = equipment_fractions[item.id]
        required = requested * fraction
        capacity = item.specifications.max_solids_throughput_tph
        utilization = required / capacity if capacity is not None else None
        equipment_flows[item.id] = EquipmentFlow(required, achievable * fraction, capacity, utilization)
        if capacity is not None and required > capacity and not isclose(
            required, capacity, rel_tol=RELATIVE_TOLERANCE
        ):
            findings.append(Finding(
                "equipment_overload", "error", (item.id,), required, capacity,
                f"{item.name} ({item.id}) requires {required:g} t/h at the requested feed "
                f"and is rated for {capacity:g} t/h.",
            ))

    stream_flows = {
        stream.id: Flow(requested * stream_fractions[stream.id],
                        achievable * stream_fractions[stream.id])
        for stream in plant.connections
    }
    output_streams = {
        stream.material: stream
        for stream in plant.connections
        if equipment[stream.destination.equipment_id].type == "storage"
    }
    sand = stream_flows[output_streams["sand"].id].achievable_tph
    gravel = stream_flows[output_streams["gravel"].id].achievable_tph
    residual = achievable - sand - gravel
    tolerance = max(MASS_BALANCE_ABS_TOLERANCE_TPH, achievable * RELATIVE_TOLERANCE)
    if abs(residual) > tolerance:
        findings.append(Finding(
            "mass_balance", "error",
            (hopper.id, *(stream.destination.equipment_id for stream in output_streams.values())),
            abs(residual), tolerance,
            f"Achievable feed and combined outputs differ by {residual:g} t/h.",
        ))

    return ThroughputResult(
        requested_feed_tph=requested,
        maximum_feasible_feed_tph=maximum,
        achievable_feed_tph=achievable,
        sand_output_tph=sand,
        gravel_output_tph=gravel,
        mass_balance_residual_tph=residual,
        limiting_equipment_ids=tuple(
            identifier for identifier, limit in feed_limits.items()
            if isclose(limit, maximum, rel_tol=RELATIVE_TOLERANCE)
        ),
        equipment=equipment_flows,
        streams=stream_flows,
        findings=tuple(findings),
    )
