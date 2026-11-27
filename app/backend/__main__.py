import argparse
from pathlib import Path

from .models import Plant
from .plant_files import DEFAULT_PLANT, PlantError, initialize_plant, load_plant


def print_summary(plant: Plant) -> None:
    print(plant.factory.name)
    print("Invented demonstration specifications. Dry solids only.")
    print(f"Requested feed: {plant.requirements.requested_feed_tph:g} t/h")
    print(f"Screen fine fraction: {plant.requirements.screen_fine_fraction:.0%}")
    print(f"Equipment ({len(plant.equipment)})")
    components = {component.id: component for component in plant.components}
    for item in plant.equipment:
        capacity = item.specifications.max_solids_throughput_tph
        rating = "output sink" if capacity is None else f"{capacity:g} t/h"
        print(f"  {item.id}  {item.name} ({rating})")
        for component_id in item.component_ids:
            print(f"    {component_id}  {components[component_id].name}")
    print(f"Material streams ({len(plant.connections)})")
    for stream in plant.connections:
        source, destination = stream.source, stream.destination
        print(f"  {stream.id}  {source.equipment_id}.{source.port_id} → "
              f"{destination.equipment_id}.{destination.port_id} ({stream.material})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Plant-as-Code demo tools")
    parser.add_argument("command", choices=["init", "validate"])
    parser.add_argument("--plant", type=Path, default=DEFAULT_PLANT, metavar="PATH")
    args = parser.parse_args()
    plant_path = args.plant.expanduser().absolute()
    try:
        if args.command == "init":
            created = initialize_plant(plant_path)
            message = "Initialized plant repository at" if created else "Plant repository already exists at"
            print(f"{message} {plant_path}")
        else:
            print_summary(load_plant(plant_path))
    except (PlantError, OSError) as error:
        parser.exit(1, f"Plant error: {error}\n")


if __name__ == "__main__":
    main()
