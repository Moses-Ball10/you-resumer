from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings, read from environment variables or backend/.env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data.db"

    llm_timeout_seconds: float = 300
    # A provider that has not started answering by then is skipped for the next one.
    llm_first_token_seconds: float = 45
    llm_complete_seconds: float = 120  # whole non-streamed reply (summary notes, translation)

    # Visitors bring their own Gemini and Groq keys; only the models are set here.
    # Newest Flash-Lite. The full Flash models were too slow on the free tier (no reply in 40 s).
    gemini_model: str = "gemini-flash-lite-latest"
    groq_model: str = "openai/gpt-oss-120b"

    # Our own OpenAI-compatible server (vLLM) later on; it is the only key kept on the server.
    custom_base_url: str = ""
    custom_api_key: str = ""
    custom_model: str = ""

    # The local dev page, and the installed app (Capacitor serves the page from these origins).
    cors_origins: list[str] = ["http://localhost:3000", "https://localhost", "capacitor://localhost"]
    # On Render, the static site's host name (set by render.yaml); it is added to cors_origins.
    frontend_host: str = ""

    @property
    def allowed_origins(self) -> list[str]:
        extra = [f"https://{self.frontend_host}"] if self.frontend_host else []
        return self.cors_origins + extra

    # Limits for a public site (per visitor, by IP address).
    max_video_seconds: int = 3 * 60 * 60  # longer videos are refused
    videos_per_hour: int = 30  # new videos loaded or pasted
    ai_requests_per_hour: int = 120  # summaries, questions and evidence analyses

    chunk_seconds: int = 45  # transcript piece length used for search
    max_videos_per_session: int = 5
    max_context_chunks: int = 8


settings = Settings()
