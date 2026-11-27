import json

from fastapi import HTTPException
from workers import asgi

from app.backend.models import Plant, PlantSnapshot
from app.backend.preview import create_preview_app
from demo_fixture import HISTORY_JSON, PLANT_JSON


history = json.loads(HISTORY_JSON)


def read_demo_plant() -> PlantSnapshot:
    return PlantSnapshot(plant=Plant.model_validate_json(PLANT_JSON),
                         git_dirty=False if history is not None else None)


app = create_preview_app(read_demo_plant, prefix="/api")

if history is not None:
    @app.get("/api/plant/git")
    async def published_history():
        return history["status"]

    @app.get("/api/plant/git/diff")
    async def published_diff(commit: str):
        if commit not in history["comparisons"]:
            raise HTTPException(status_code=404, detail="This commit is outside the published demo history.")
        return history["comparisons"][commit]


Default = asgi.entrypoint(app)
