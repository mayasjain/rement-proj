import argparse
from pathlib import Path

from pydantic import ValidationError

from .engineering import ThroughputResult, evaluate
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


def print_evaluation(result: ThroughputResult) -> None:
    status = "Feasible" if result.feasible else "Infeasible"
    print(f"{status} at the requested feed under the dry-solids demo model")
    print(f"Requested feed: {result.requested_feed_tph:g} t/h")
    print(f"Maximum feasible feed: {result.maximum_feasible_feed_tph:g} t/h "
          f"({', '.join(result.limiting_equipment_ids)})")
    print(f"Achievable feed: {result.achievable_feed_tph:g} t/h")
    print(f"Sand output: {result.sand_output_tph:g} t/h")
    print(f"Gravel output: {result.gravel_output_tph:g} t/h")
    print(f"Mass balance residual: {result.mass_balance_residual_tph:g} t/h")
    print("Equipment     Required (t/h)   Achievable (t/h)   Required utilization")
    for identifier, flow in result.equipment.items():
        utilization = "—" if flow.utilization is None else f"{flow.utilization:.1%}"
        print(f"{identifier:<13} {flow.required_tph:>14g}   {flow.achievable_tph:>16g}   {utilization}")
    for finding in result.findings:
        print(f"{finding.severity.upper()} [{finding.rule_id}] {finding.explanation}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Plant-as-Code demo tools")
    parser.add_argument("command", choices=["init", "validate", "evaluate"])
    parser.add_argument("--plant", type=Path, default=DEFAULT_PLANT, metavar="PATH")
    parser.add_argument("--feed", type=float, metavar="TPH",
                        help="preview a different requested feed when evaluating")
    parser.add_argument("--crusher-capacity", type=float, metavar="TPH",
                        help="preview a different crusher rating when evaluating")
    args = parser.parse_args()
    if args.command != "evaluate" and (args.feed is not None or args.crusher_capacity is not None):
        parser.error("--feed and --crusher-capacity require evaluate")
    plant_path = args.plant.expanduser().absolute()
    try:
        if args.command == "init":
            created = initialize_plant(plant_path)
            message = "Initialized plant repository at" if created else "Plant repository already exists at"
            print(f"{message} {plant_path}")
        elif args.command == "validate":
            print_summary(load_plant(plant_path))
        else:
            plant = load_plant(plant_path)
            if args.feed is not None or args.crusher_capacity is not None:
                draft = plant.model_dump(by_alias=True)
                if args.feed is not None:
                    draft["requirements"]["requested_feed_tph"] = args.feed
                if args.crusher_capacity is not None:
                    crusher = next(item for item in draft["equipment"] if item["type"] == "crusher")
                    crusher["specifications"]["max_solids_throughput_tph"] = args.crusher_capacity
                plant = Plant.model_validate(draft)
            print_evaluation(evaluate(plant))
    except (PlantError, OSError, ValidationError) as error:
        parser.exit(1, f"Plant error: {error}\n")


if __name__ == "__main__":
    main()
