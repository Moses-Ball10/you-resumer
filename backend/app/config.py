from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings, read from environment variables or backend/.env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data.db"

    # Any OpenAI-compatible server works: Ollama locally, vLLM on a GPU in production.
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "qwen2.5:3b"
    llm_api_key: str = "not-needed"
    llm_timeout_seconds: float = 120

    cors_origins: list[str] = ["http://localhost:3000"]

    chunk_seconds: int = 45  # transcript piece length used for search
    max_videos_per_session: int = 5
    max_context_chunks: int = 8


settings = Settings()
