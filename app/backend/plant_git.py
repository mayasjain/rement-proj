from pathlib import Path
from typing import Literal

from pydantic import JsonValue

from .models import Model, Plant, PlantSnapshot
from .plant_files import PlantError, git, git_bytes, parse_plant, plant_documents
from .plant_store import PlantStore, revision


class GitConflict(PlantError):
    """The current Git state does not allow this operation."""


class Commit(Model):
    hash: str
    subject: str
    date: str


class RepositoryStatus(Model):
    branch: str
    head: str
    dirty: bool
    history: list[Commit]


class FieldChange(Model):
    field: str
    before: JsonValue
    after: JsonValue


def managed(path: Path) -> bool:
    return path in (Path("factory.yaml"), Path("requirements.yaml"), Path("connections.yaml")) or (
        path.parent in (Path("equipment"), Path("components")) and path.suffix == ".yaml"
    )


def file_names(output: bytes) -> list[str]:
    return [part.decode("utf-8") for part in output.split(b"\0") if part]


def plant_fields(plant: Plant) -> dict[str, JsonValue]:
    data = plant.model_dump(mode="json", by_alias=True)
    for group in ("equipment", "components", "connections"):
        data[group] = {item["id"]: item for item in data[group]}
    fields: dict[str, JsonValue] = {}

    def flatten(prefix: str, value: JsonValue):
        if isinstance(value, dict):
            for key, child in value.items():
                flatten(f"{prefix}.{key}" if prefix else key, child)
        else:
            fields[prefix] = value

    flatten("", data)
    return fields


class PlantGit:
    def __init__(self, store: PlantStore):
        self.store = store
        self.root = store.root

    def check_repository(self) -> None:
        if not self.store.git_repo or (self.root / ".git").is_symlink() or (
            Path(git(self.root, "rev-parse", "--show-toplevel")).resolve() != self.root
        ):
            raise GitConflict("Initialize a standalone plant Git repository before using version history.")

    def changes(self) -> bool:
        return bool(git(self.root, "status", "--porcelain", "--untracked-files=all"))

    def status(self) -> RepositoryStatus:
        with self.store.transaction():
            self.check_repository()
            head = git(self.root, "rev-parse", "HEAD")
            branch = git(self.root, "branch", "--show-current")
            log = git(self.root, "log", "--max-count=50", "--format=%H%x00%aI%x00%s", head)
            history = [
                Commit(hash=commit, date=date, subject=subject)
                for commit, date, subject in (line.split("\0", 2) for line in log.split("\n"))
            ]
            seed = git(self.root, "rev-list", "--first-parent", "--max-parents=0", head)
            if seed not in {item.hash for item in history}:
                date, subject = git(self.root, "show", "-s", "--format=%aI%x00%s", seed).split("\0", 1)
                history.append(Commit(hash=seed, date=date, subject=subject))
            return RepositoryStatus(branch=branch, head=head, dirty=self.changes(), history=history)

    def verify_commit(self, commit: str, head: str) -> None:
        try:
            resolved = git(self.root, "rev-parse", "--verify", f"{commit}^{{commit}}")
            if resolved == commit:
                git(self.root, "merge-base", "--is-ancestor", commit, head)
                return
        except PlantError:
            pass
        raise GitConflict("Choose a commit from the current plant history.")

    def documents_at(self, commit: str) -> dict[Path, bytes]:
        documents = {}
        for entry in file_names(git_bytes(self.root, "ls-tree", "-rz", commit)):
            metadata, name = entry.split("\t", 1)
            path = Path(name)
            if managed(path):
                mode, kind, blob = metadata.split()
                if kind != "blob" or mode not in ("100644", "100755"):
                    raise GitConflict(f"{name} must be a regular YAML file in the selected commit.")
                documents[path] = git_bytes(self.root, "cat-file", "blob", blob)
        required = (Path("factory.yaml"), Path("requirements.yaml"), Path("connections.yaml"))
        if missing := [str(path) for path in required if path not in documents]:
            raise GitConflict(f"The selected commit is missing plant files: {', '.join(missing)}.")
        return documents

    def diff(self, commit: str, against: Literal["working", "head"]) -> list[FieldChange]:
        with self.store.transaction():
            self.check_repository()
            head = git(self.root, "rev-parse", "HEAD")
            self.verify_commit(commit, head)
            before = plant_fields(parse_plant(self.root, self.documents_at(commit)))
            after_docs = plant_documents(self.root) if against == "working" else self.documents_at(head)
            after = plant_fields(parse_plant(self.root, after_docs))
            return [
                FieldChange(field=key, before=before.get(key), after=after.get(key))
                for key in sorted(before.keys() | after.keys())
                if key not in before or key not in after or before[key] != after[key]
            ]

    def check_write(self, expected_head: str, expected_revision: str) -> tuple[str, dict[Path, bytes]]:
        self.check_repository()
        branch = git(self.root, "branch", "--show-current")
        if not branch:
            raise GitConflict("Switch to a plant branch in Git before committing or restoring.")
        pending = ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer",
                   "rebase-merge", "rebase-apply", "BISECT_START")
        if any((self.root / ".git" / name).exists() for name in pending):
            raise GitConflict("Finish the Git operation in progress before committing or restoring.")
        documents = plant_documents(self.root)
        if git(self.root, "rev-parse", "HEAD") != expected_head or revision(documents) != expected_revision:
            raise GitConflict("The plant files or Git history changed. Reload the workspace and try again.")
        return branch, documents

    def commit_options(self) -> list[str]:
        options = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false"]
        try:
            git(self.root, "var", "GIT_AUTHOR_IDENT")
            git(self.root, "var", "GIT_COMMITTER_IDENT")
        except PlantError:
            options.extend(["-c", "user.name=Plant-as-Code Demo", "-c", "user.email=demo@plant-as-code.invalid"])
        return options

    def commit(self, expected_head: str, expected_revision: str, message: str) -> PlantSnapshot:
        with self.store.transaction():
            _, documents = self.check_write(expected_head, expected_revision)
            plant = parse_plant(self.root, documents)
            if git(self.root, "diff", "--cached", "--name-only"):
                raise GitConflict("Unstage the pending Git changes in the terminal before using Commit.")
            before = self.documents_at(expected_head)
            changed = sorted(
                path.as_posix() for path in before.keys() | documents.keys()
                if before.get(path) != documents.get(path)
            )
            if not changed:
                raise GitConflict("There are no saved plant YAML changes to commit.")
            new = sorted(path.as_posix() for path in documents.keys() - before.keys())
            try:
                if new:
                    git(self.root, "--literal-pathspecs", "add", "--intent-to-add", "--force", "--", *new)
                self.check_write(expected_head, expected_revision)
                git(self.root, *self.commit_options(), "--literal-pathspecs", "commit",
                    "--only", "-m", message, "--", *changed)
            except Exception:
                if new and git(self.root, "rev-parse", "HEAD") == expected_head:
                    git(self.root, "--literal-pathspecs", "restore", "--staged", "--", *new)
                raise
            return self.store.snapshot(plant, documents)

    def restore(self, expected_head: str, expected_revision: str, commit: str) -> PlantSnapshot:
        with self.store.transaction():
            branch, _ = self.check_write(expected_head, expected_revision)
            if self.changes():
                raise GitConflict("Commit or resolve the plant repository changes before restoring a snapshot.")
            self.verify_commit(commit, expected_head)
            changed = file_names(git_bytes(
                self.root, "diff", "--no-renames", "--name-only", "-z", expected_head, commit, "--",
            ))
            if not changed:
                raise GitConflict("The working plant already matches this snapshot.")
            if any(not managed(Path(path)) for path in changed):
                raise GitConflict("This snapshot would change files outside the plant YAML.")
            # Protect even ignored files that a historical snapshot could reintroduce.
            for name in changed:
                path = self.root / name
                if path.parent.is_symlink() or path.is_symlink():
                    raise GitConflict(f"Resolve the symbolic link at {name} before restoring.")
            untracked = set(file_names(git_bytes(self.root, "ls-files", "--others", "-z")))
            if untracked.intersection(changed):
                raise GitConflict("Move the untracked files that overlap this snapshot before restoring.")

            documents = self.documents_at(commit)
            plant = parse_plant(self.root, documents)
            message = f"Restore plant snapshot {commit[:7]}"
            new = git(self.root, *self.commit_options(), "commit-tree", f"{commit}^{{tree}}",
                      "-p", expected_head, "-m", message)
            git(self.root, "read-tree", "-m", "-u", expected_head, commit)
            try:
                restored = plant_documents(self.root)
                if git(self.root, "branch", "--show-current") != branch or parse_plant(self.root, restored) != plant:
                    raise GitConflict("The working plant changed during restore. Review the repository before retrying.")
                if git(self.root, "diff", "--name-only", "--"):
                    raise GitConflict("Files changed during restore. Review the repository before retrying.")
                git(self.root, "update-ref", "-m", message, f"refs/heads/{branch}", new, expected_head)
            except Exception:
                if git(self.root, "branch", "--show-current") == branch and git(self.root, "rev-parse", "HEAD") == expected_head:
                    git(self.root, "read-tree", "-m", "-u", commit, expected_head)
                raise
            return self.store.snapshot(plant, restored)
