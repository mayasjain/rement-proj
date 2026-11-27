from collections import Counter
from graphlib import CycleError, TopologicalSorter
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")]
Name = Annotated[str, Field(min_length=1)]
Number = Annotated[FiniteFloat, Field(strict=True)]
Nonnegative = Annotated[Number, Field(ge=0)]
Positive = Annotated[Number, Field(gt=0)]
Vector = tuple[Number, Number, Number]
Dimensions = tuple[Positive, Positive, Positive]
EquipmentType = Literal["hopper", "crusher", "screen", "washer", "conveyor", "storage"]
Material = Literal[
    "mixed_aggregate", "crushed_aggregate", "fine_aggregate", "coarse_aggregate",
    "sand", "gravel",
]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Versioned(Model):
    schema_version: Literal[1]


class Factory(Versioned):
    name: Name


class Requirements(Model):
    requested_feed_tph: Nonnegative
    screen_fine_fraction: Annotated[Number, Field(ge=0, le=1)]


class Geometry(Model):
    model_key: Identifier
    position_m: Vector
    rotation_deg: Vector
    dimensions_m: Dimensions


class ComponentGeometry(Model):
    model_key: Identifier
    local_position_m: Vector
    dimensions_m: Dimensions


class EquipmentSpecifications(Model):
    max_solids_throughput_tph: Positive | None = None
    rated_power_kw: Nonnegative


class ComponentSpecifications(Model):
    rated_power_kw: Nonnegative | None = None


class Port(Model):
    id: Identifier
    direction: Literal["input", "output"]
    material: Material


class Equipment(Versioned):
    id: Identifier
    name: Name
    type: EquipmentType
    specifications: EquipmentSpecifications
    ports: list[Port]
    component_ids: list[Identifier] = Field(default_factory=list)
    geometry: Geometry

    @model_validator(mode="after")
    def check_equipment(self):
        unique_ids((port.id for port in self.ports), f"port on {self.id}")
        capacity = self.specifications.max_solids_throughput_tph
        if self.type == "storage" and capacity is not None:
            raise ValueError(f"{self.id} is an output sink. Remove its throughput rating.")
        if self.type != "storage" and capacity is None:
            raise ValueError(f"{self.id} requires max_solids_throughput_tph.")
        return self


class Component(Versioned):
    id: Identifier
    name: Name
    type: Identifier
    specifications: ComponentSpecifications
    geometry: ComponentGeometry


class Endpoint(Model):
    equipment_id: Identifier
    port_id: Identifier


class Connection(Model):
    id: Identifier
    source: Endpoint = Field(alias="from")
    destination: Endpoint = Field(alias="to")
    material: Material


class Connections(Model):
    connections: list[Connection]


PROCESS_STREAMS = Counter([
    ("hopper", "crusher", "mixed_aggregate"),
    ("crusher", "screen", "crushed_aggregate"),
    ("screen", "washer", "fine_aggregate"),
    ("screen", "conveyor", "coarse_aggregate"),
    ("washer", "storage", "sand"),
    ("conveyor", "storage", "gravel"),
])
PROCESS_EQUIPMENT = Counter(["hopper", "crusher", "screen", "washer", "conveyor",
                             "storage", "storage"])


def unique_ids(ids, description):
    seen = set()
    for identifier in ids:
        if identifier in seen:
            raise ValueError(f"Duplicate {description} ID {identifier}.")
        seen.add(identifier)


class Plant(Model):
    factory: Factory
    requirements: Requirements
    equipment: list[Equipment]
    components: list[Component]
    connections: list[Connection]

    @model_validator(mode="after")
    def check_references_and_topology(self):
        unique_ids((item.id for item in [*self.equipment, *self.components, *self.connections]),
                   "plant object")
        equipment = {item.id: item for item in self.equipment}
        component_ids = {item.id for item in self.components}
        assigned = {}
        for item in self.equipment:
            for component_id in item.component_ids:
                if component_id not in component_ids:
                    raise ValueError(f"{item.id} references missing component {component_id}.")
                if component_id in assigned:
                    raise ValueError(f"Component {component_id} is referenced more than once "
                                     f"by {assigned[component_id]} and {item.id}.")
                assigned[component_id] = item.id
        if unassigned := component_ids - assigned.keys():
            raise ValueError(f"Components need a parent equipment item: {', '.join(sorted(unassigned))}.")
        validate_process(equipment, self.connections)
        return self


class PlantSnapshot(Model):
    plant: Plant
    revision: str | None = None
    git_dirty: bool | None = None


def validate_process(equipment, connections):
    ports = {(item.id, port.id): port for item in equipment.values() for port in item.ports}
    occupied = set()
    dependencies = {identifier: set() for identifier in equipment}
    streams = Counter()
    for stream in connections:
        for endpoint, direction in [(stream.source, "output"), (stream.destination, "input")]:
            key = (endpoint.equipment_id, endpoint.port_id)
            label = ".".join(key)
            if endpoint.equipment_id not in equipment:
                raise ValueError(f"{stream.id} references missing equipment {endpoint.equipment_id}.")
            if key not in ports:
                raise ValueError(f"{stream.id} references missing port {label}.")
            port = ports[key]
            if port.direction != direction:
                raise ValueError(f"{stream.id} needs an {direction} port at {label}.")
            if port.material != stream.material:
                raise ValueError(f"{stream.id} carries {stream.material}, incompatible with "
                                 f"{label} ({port.material}).")
            if key in occupied:
                raise ValueError(f"{stream.id} reuses connected port {label}.")
            occupied.add(key)
        source = equipment[stream.source.equipment_id]
        destination = equipment[stream.destination.equipment_id]
        dependencies[destination.id].add(source.id)
        streams[(source.type, destination.type, stream.material)] += 1

    try:
        tuple(TopologicalSorter(dependencies).static_order())
    except CycleError as error:
        raise ValueError(f"Process cycle: {' -> '.join(error.args[1])}.") from error

    if unconnected := ports.keys() - occupied:
        labels = ", ".join(".".join(key) for key in sorted(unconnected))
        raise ValueError(f"Disconnected process ports: {labels}.")

    if Counter(item.type for item in equipment.values()) != PROCESS_EQUIPMENT:
        raise ValueError("Unsupported equipment lineup. Expected a hopper, crusher, screen, "
                         "washer, conveyor, and two storage sinks.")
    if streams != PROCESS_STREAMS or any(
        len(dependencies[item.id]) != 1 for item in equipment.values() if item.type == "storage"
    ):
        raise ValueError("Unsupported process layout. Connect hopper → crusher → screen, then "
                         "route fines through the washer to sand storage and coarse material "
                         "through the conveyor to a separate gravel storage sink.")
