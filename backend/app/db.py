import json
from datetime import datetime, timezone

from sqlmodel import Field, Session, SQLModel, create_engine

from .config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)


class Video(SQLModel, table=True):
    """A processed video. Cached so the same video is never fetched twice."""

    id: str = Field(primary_key=True)  # YouTube video id
    title: str = ""
    language: str = ""
    source: str = "captions"  # "captions" now, "whisper" later for no-caption videos
    segments_json: str  # list of {"start", "duration", "text"}
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def segments(self) -> list[dict]:
        return json.loads(self.segments_json)


class Summary(SQLModel, table=True):
    """Cached summaries, one per video and style."""

    video_id: str = Field(primary_key=True, foreign_key="video.id")
    style: str = Field(primary_key=True)
    content: str


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
