from collections.abc import Callable

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from .engineering import ThroughputResult, evaluate
from .models import (
    Dimensions, EquipmentSpecifications, Identifier, Model, Nonnegative,
    Plant, PlantSnapshot, Positive, Requirements, Vector,
)


class SimulationDraft(Model):
    requested_feed_tph: Nonnegative
    equipment_capacities_tph: dict[Identifier, Positive]


class EquipmentDraft(Model):
    specifications: EquipmentSpecifications
    position_m: Vector
    rotation_deg: Vector
    dimensions_m: Dimensions


class DesignDraft(Model):
    requirements: Requirements
    equipment: dict[Identifier, EquipmentDraft]


class PlantView(PlantSnapshot):
    result: ThroughputResult


def view(snapshot: PlantSnapshot) -> PlantView:
    return PlantView(plant=snapshot.plant, revision=snapshot.revision,
                     git_dirty=snapshot.git_dirty, result=evaluate(snapshot.plant))


def apply_design(plant: Plant, draft: DesignDraft) -> Plant:
    if set(draft.equipment) != {item.id for item in plant.equipment}:
        raise HTTPException(status_code=422, detail="Equipment in the draft must match the saved plant.")
    plant.requirements = draft.requirements
    for item in plant.equipment:
        edit = draft.equipment[item.id]
        item.specifications = edit.specifications
        item.geometry = item.geometry.model_copy(update=edit.model_dump(exclude={"specifications"}))
    try:
        return Plant.model_validate(plant.model_dump(by_alias=True))
    except ValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def create_preview_app(read_plant: Callable[[], Plant | PlantSnapshot], prefix: str = "") -> FastAPI:
    app = FastAPI(title="Plant-as-Code")

    def read_snapshot() -> PlantSnapshot:
        loaded = read_plant()
        return loaded if isinstance(loaded, PlantSnapshot) else PlantSnapshot(plant=loaded)

    @app.get(f"{prefix}/plant")
    async def get_plant() -> PlantView:
        return view(read_snapshot())

    @app.post(f"{prefix}/plant/simulate")
    async def simulate(draft: SimulationDraft | DesignDraft) -> PlantView:
        snapshot = read_snapshot()
        plant = snapshot.plant
        if isinstance(draft, DesignDraft):
            snapshot.plant = apply_design(plant, draft)
            return view(snapshot)
        equipment = {item.id: item for item in plant.equipment}
        for identifier, rating in draft.equipment_capacities_tph.items():
            item = equipment.get(identifier)
            if item is None or item.specifications.max_solids_throughput_tph is None:
                raise HTTPException(
                    status_code=422, detail=f"{identifier} is not a rated equipment item."
                )
            item.specifications.max_solids_throughput_tph = rating
        plant.requirements.requested_feed_tph = draft.requested_feed_tph
        return view(snapshot)

    return app
