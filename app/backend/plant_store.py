from base64 import b64decode, b64encode
from collections.abc import Callable
from contextlib import contextmanager
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
from stat import S_IMODE
from tempfile import NamedTemporaryFile

import yaml

from .models import Equipment, Plant, PlantSnapshot
from .plant_files import PlantError, git, parse_plant, plant_documents, read_yaml


class RevisionConflict(PlantError):
    def __init__(self):
        super().__init__("The plant YAML changed on disk. Your draft is still open. "
                         "Copy any values you want to keep, then use Reload to open the latest files.")


def revision(documents: dict[Path, bytes]) -> str:
    digest = sha256()
    for path, content in sorted(documents.items()):
        digest.update(path.as_posix().encode("utf-8") + b"\0")
        digest.update(sha256(content).digest())
    return digest.hexdigest()


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_write(path: Path, content: bytes) -> None:
    mode = S_IMODE(path.stat().st_mode) if path.exists() else 0o600
    with NamedTemporaryFile(dir=path.parent, prefix=".plant-write-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            os.fchmod(stream.fileno(), mode)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
            stream.close()
            os.replace(temporary, path)
            sync_directory(path.parent)
        finally:
            temporary.unlink(missing_ok=True)


def yaml_bytes(model) -> bytes:
    return yaml.safe_dump(model.model_dump(mode="json", by_alias=True, exclude_none=True),
                          sort_keys=False, allow_unicode=True).encode("utf-8")


class PlantStore:
    def __init__(self, root: Path):
        self.root = root.resolve()
        metadata = self.root / ".git"
        self.git_repo = metadata.is_dir()
        directory = metadata if self.git_repo else self.root.parent
        name = "plant-save" if self.git_repo else f".{self.root.name}.plant-save"
        self.lock = directory / f"{name}.lock"
        self.journal = directory / f"{name}.json"

    @contextmanager
    def transaction(self):
        with self.lock.open("a+b") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.recover()
            yield

    def recover(self) -> None:
        if not self.journal.exists():
            return
        try:
            entries = json.loads(self.journal.read_text(encoding="utf-8"))
            for name, (old, new) in entries.items():
                path = Path(name)
                if path != Path("requirements.yaml") and (
                    path.parent != Path("equipment") or path.suffix != ".yaml"
                ):
                    raise ValueError("Unexpected journal path")
                target = self.root / path
                if target.is_symlink() or target.parent.is_symlink():
                    raise ValueError(f"{path} points outside the managed plant files")
                current = target.read_bytes()
                if current == b64decode(new):
                    atomic_write(target, b64decode(old))
                # An editor may have changed the file independently. Preserve its bytes.
            self.clear_journal()
        except (OSError, ValueError, TypeError, AttributeError) as error:
            raise PlantError(f"Could not recover an interrupted save from {self.journal}: {error}") from error

    def clear_journal(self) -> None:
        self.journal.unlink()
        sync_directory(self.journal.parent)

    def snapshot(self, plant: Plant, documents: dict[Path, bytes]) -> PlantSnapshot:
        dirty = bool(git(self.root, "status", "--porcelain")) if self.git_repo else None
        return PlantSnapshot(plant=plant, revision=revision(documents), git_dirty=dirty)

    def read(self) -> PlantSnapshot:
        with self.transaction():
            documents = plant_documents(self.root)
            return self.snapshot(parse_plant(self.root, documents), documents)

    def save(self, expected_revision: str, apply: Callable[[Plant], Plant]) -> PlantSnapshot:
        with self.transaction():
            documents = plant_documents(self.root)
            if revision(documents) != expected_revision:
                raise RevisionConflict()
            current = parse_plant(self.root, documents)
            updated = apply(current.model_copy(deep=True))

            replacements = {}
            if updated.requirements != current.requirements:
                replacements[Path("requirements.yaml")] = yaml_bytes(updated.requirements)
            equipment = {item.id: item for item in updated.equipment}
            previous = {item.id: item for item in current.equipment}
            changed_ids = {identifier for identifier, item in equipment.items() if item != previous[identifier]}
            if changed_ids:
                for path, content in documents.items():
                    if path.parent == Path("equipment"):
                        item = read_yaml(self.root / path, Equipment, content)
                        if item.id in changed_ids:
                            replacements[path] = yaml_bytes(equipment[item.id])

            if not replacements:
                return self.snapshot(current, documents)
            if plant_documents(self.root) != documents:
                raise RevisionConflict()
            journal = {
                path.as_posix(): [b64encode(documents[path]).decode(), b64encode(content).decode()]
                for path, content in replacements.items()
            }
            atomic_write(self.journal, json.dumps(journal).encode())
            try:
                for path, content in replacements.items():
                    target = self.root / path
                    if target.is_symlink() or target.parent.is_symlink() or target.read_bytes() != documents[path]:
                        raise RevisionConflict()
                    atomic_write(target, content)
                saved = documents | replacements
                if plant_documents(self.root) != saved:
                    raise RevisionConflict()
                result = self.snapshot(updated, saved)
            except Exception:
                self.recover()
                raise
            self.clear_journal()
            return result
