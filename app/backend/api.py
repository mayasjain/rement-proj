from pathlib import Path

from fastapi import FastAPI, HTTPException

from .models import Plant
from .plant_files import DEFAULT_PLANT, PlantError, load_plant
from .preview import create_preview_app


def create_app(plant_path: Path = DEFAULT_PLANT) -> FastAPI:
    def read_plant() -> Plant:
        try:
            return load_plant(plant_path)
        except PlantError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    return create_preview_app(read_plant)


app = create_app()
