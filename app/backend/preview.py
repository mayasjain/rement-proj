from collections.abc import Callable

from fastapi import FastAPI, HTTPException

from .engineering import ThroughputResult, evaluate
from .models import Identifier, Model, Nonnegative, Plant, Positive


class SimulationDraft(Model):
    requested_feed_tph: Nonnegative
    equipment_capacities_tph: dict[Identifier, Positive]


class PlantView(Model):
    plant: Plant
    result: ThroughputResult


def create_preview_app(read_plant: Callable[[], Plant], prefix: str = "") -> FastAPI:
    app = FastAPI(title="Plant-as-Code")

    @app.get(f"{prefix}/plant")
    async def get_plant() -> PlantView:
        plant = read_plant()
        return PlantView(plant=plant, result=evaluate(plant))

    @app.post(f"{prefix}/plant/simulate")
    async def simulate(draft: SimulationDraft) -> PlantView:
        plant = read_plant()
        equipment = {item.id: item for item in plant.equipment}
        for identifier, rating in draft.equipment_capacities_tph.items():
            item = equipment.get(identifier)
            if item is None or item.specifications.max_solids_throughput_tph is None:
                raise HTTPException(
                    status_code=422, detail=f"{identifier} is not a rated equipment item."
                )
            item.specifications.max_solids_throughput_tph = rating
        plant.requirements.requested_feed_tph = draft.requested_feed_tph
        return PlantView(plant=plant, result=evaluate(plant))

    return app
