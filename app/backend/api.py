from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Literal, TypeVar

from fastapi import FastAPI, HTTPException, Query
from pydantic import Field, StringConstraints

from .models import Model, PlantSnapshot
from .plant_files import DEFAULT_PLANT, PlantError
from .plant_git import FieldChange, GitConflict, PlantGit, RepositoryStatus
from .plant_store import PlantStore, RevisionConflict
from .preview import DesignDraft, PlantView, apply_design, create_preview_app, view


Revision = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
COMMIT_PATTERN = r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$"
CommitHash = Annotated[str, Field(pattern=COMMIT_PATTERN)]
T = TypeVar("T")


class SaveDraft(DesignDraft):
    expected_revision: Revision


class GitWrite(Model):
    expected_head: CommitHash
    expected_revision: Revision


class CreateCommit(GitWrite):
    message: Annotated[str, StringConstraints(
        strip_whitespace=True, min_length=1, max_length=240, pattern=r"^[^\r\n\x00]+$",
    )]


class RestoreCommit(GitWrite):
    commit: CommitHash


def git_request(operation: Callable[[], T]) -> T:
    try:
        return operation()
    except GitConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except (PlantError, OSError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


def create_app(plant_path: Path = DEFAULT_PLANT) -> FastAPI:
    store = PlantStore(plant_path)
    repository = PlantGit(store)

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

    @app.get("/plant/git")
    def git_status() -> RepositoryStatus:
        return git_request(repository.status)

    @app.get("/plant/git/diff")
    def git_diff(commit: Annotated[str, Query(pattern=COMMIT_PATTERN)],
                 against: Literal["working", "head"] = "working") -> list[FieldChange]:
        return git_request(lambda: repository.diff(commit, against))

    @app.post("/plant/git/commit")
    def git_commit(draft: CreateCommit) -> PlantView:
        return view(git_request(lambda: repository.commit(
            draft.expected_head, draft.expected_revision, draft.message,
        )))

    @app.post("/plant/git/restore")
    def git_restore(draft: RestoreCommit) -> PlantView:
        return view(git_request(lambda: repository.restore(
            draft.expected_head, draft.expected_revision, draft.commit,
        )))

    return app


app = create_app()
