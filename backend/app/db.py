import json
from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlmodel import Field, Session, SQLModel, create_engine

from .config import settings


def _database_url(url: str) -> str:
    # Neon and Render give "postgres://" or "postgresql://"; SQLAlchemy needs the psycopg driver named.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


# An empty DATABASE_URL (left blank on Render) falls back to a local SQLite file.
DATABASE_URL = _database_url(settings.database_url or "sqlite:///./data.db")
IS_SQLITE = DATABASE_URL.startswith("sqlite")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if IS_SQLITE else {},
    # A free Postgres closes idle connections; check each one before use.
    pool_pre_ping=not IS_SQLITE,
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
    """Cached summaries, one per video, style and language."""

    __tablename__ = "summaries"  # replaces the older "summary" table that had no language

    video_id: str = Field(primary_key=True, foreign_key="video.id")
    style: str = Field(primary_key=True)
    language: str = Field(primary_key=True)  # "auto" = the video's own language
    content: str
    model: str = ""  # "Provider · model" that wrote it


class Adillah(SQLModel, table=True):
    """Evidence list of a video, verified against the Qur'an and hadith collections.

    Built packet by packet; `state` is "partial" while packets remain, "complete" at the end,
    or "no_adillah" when the first packets found nothing and the analysis stopped there.
    """

    video_id: str = Field(primary_key=True, foreign_key="video.id")
    items_json: str
    model: str = ""
    state: str = "complete"
    analysed: float = 0  # seconds of the video analysed so far


class AdillahPacket(SQLModel, table=True):
    """The verified items found in one packet of the transcript, so an analysis can resume."""

    __tablename__ = "adillah_packets"

    video_id: str = Field(primary_key=True, foreign_key="video.id")
    index: int = Field(primary_key=True)
    end: float
    items_json: str


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    # create_all does not add new columns to existing tables; add the ones added later.
    columns = lambda table: {c["name"] for c in inspect(engine).get_columns(table)}  # noqa: E731
    with engine.begin() as conn:
        if "model" not in columns("summaries"):
            conn.execute(text("ALTER TABLE summaries ADD COLUMN model VARCHAR NOT NULL DEFAULT ''"))
        # Lists saved before packets existed lack the quote positions the full text needs: cleared.
        if "state" not in columns("adillah"):
            conn.execute(text("DELETE FROM adillah"))
            conn.execute(text("ALTER TABLE adillah ADD COLUMN state VARCHAR NOT NULL DEFAULT 'complete'"))
            conn.execute(text("ALTER TABLE adillah ADD COLUMN analysed FLOAT NOT NULL DEFAULT 0"))


def get_session():
    with Session(engine) as session:
        yield session
