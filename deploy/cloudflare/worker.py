from workers import asgi

from app.backend.models import Plant
from app.backend.preview import create_preview_app
from demo_fixture import PLANT_JSON


def read_demo_plant() -> Plant:
    return Plant.model_validate_json(PLANT_JSON)


Default = asgi.entrypoint(create_preview_app(read_demo_plant, prefix="/api"))
