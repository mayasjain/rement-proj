from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import Field

from .models import PlantSnapshot
from .plant_files import DEFAULT_PLANT, PlantError
from .plant_store import PlantStore, RevisionConflict
from .preview import DesignDraft, PlantView, apply_design, create_preview_app, view


class SaveDraft(DesignDraft):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


def create_app(plant_path: Path = DEFAULT_PLANT) -> FastAPI:
    store = PlantStore(plant_path)

    def read_plant() -> PlantSnapshot:
        try:
            return store.read()
        except (PlantError, OSError) as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    app = create_preview_app(read_plant)

    @app.put("/plant")
    def save_plant(draft: SaveDraft) -> PlantView:
        try:
            return view(store.save(draft.expected_revision, lambda plant: apply_design(plant, draft)))
        except RevisionConflict as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except (PlantError, OSError) as error:
            raise HTTPException(status_code=503, detail=f"Plant could not be saved. {error}") from error

    return app


app = create_app()
