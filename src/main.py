"""FastAPI entry point for the InformedVoter-ET backend."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator
import logging
import traceback
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from .config import TOPIC_REGISTRY, load_party_name_registry
from .engine import ChatResult, InformedVoterEngine


load_dotenv()

# Basic structured logging configuration
logger = logging.getLogger("informedvoter")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

BASE_DIR = Path(__file__).resolve().parents[1]
WEB_DIR = BASE_DIR / "web"


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    try:
        app.state.engine = InformedVoterEngine()
    except RuntimeError as exc:
        raise RuntimeError(f"Failed to start InformedVoter-ET backend: {exc}") from exc
    yield


app = FastAPI(title="InformedVoter-ET API", version="1.0.0", lifespan=lifespan)

if WEB_DIR.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIR), name="assets")


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    error_id = str(uuid.uuid4())
    logger.warning("HTTP error %s: %s %s", error_id, exc.status_code, exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": {"id": error_id, "message": exc.detail}})


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    error_id = str(uuid.uuid4())
    tb = traceback.format_exc()
    logger.exception("Unhandled exception %s: %s", error_id, tb)
    return JSONResponse(status_code=500, content={"error": {"id": error_id, "message": "Internal server error"}})


def get_engine() -> InformedVoterEngine:
    engine = getattr(app.state, "engine", None)
    if not isinstance(engine, InformedVoterEngine):
        raise HTTPException(status_code=500, detail="Engine is not initialized")
    return engine


@app.get("/")
def frontend() -> FileResponse:
    index_path = WEB_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend assets are not available")
    return FileResponse(index_path)


@app.get("/api/registry")
def get_registry() -> dict[str, Any]:
    engine = get_engine()
    party_names = load_party_name_registry()
    return {
        "topics": TOPIC_REGISTRY,
        "parties": {
            slug: {
                "name": party_names.get(slug, {}).get("name", profile.get("name", slug)),
                "name_am": party_names.get(slug, {}).get("name_am", ""),
            }
            for slug, profile in engine.party_index.items()
            if isinstance(profile, dict)
        },
    }


@app.get("/api/parties")
def get_parties() -> list[dict[str, Any]]:
    party_names = load_party_name_registry()
    parties = []
    for slug, profile in get_engine().party_index.items():
        if not isinstance(profile, dict):
            continue
        stances = profile.get("stances", {})
        parties.append(
            {
                "slug": slug,
                "name": party_names.get(slug, {}).get("name", profile.get("name", slug)),
                "name_am": party_names.get(slug, {}).get("name_am", ""),
                "ideology": profile.get("ideology", ""),
                "stance_count": len(stances) if isinstance(stances, dict) else 0,
            }
        )
    return sorted(parties, key=lambda item: str(item["name"]))


@app.get("/api/parties/{slug}")
def get_party(slug: str) -> dict[str, Any]:
    party = get_engine().get_party(slug)
    if party is None:
        raise HTTPException(status_code=404, detail=f"Party not found: {slug}")
    enriched_party = dict(party)
    party_names = load_party_name_registry()
    enriched_party["name"] = party_names.get(slug, {}).get("name", enriched_party.get("name", slug))
    enriched_party["name_am"] = party_names.get(slug, {}).get("name_am", "")
    return enriched_party


@app.get("/api/topics")
def get_topics() -> list[dict[str, Any]]:
    engine = get_engine()
    topics = []
    for topic_id, display_name in TOPIC_REGISTRY.items():
        topic_entries = engine.get_topic(topic_id) or []
        parties = {
            entry.get("party_slug")
            for entry in topic_entries
            if isinstance(entry, dict) and entry.get("party_slug")
        }
        sub_topics = {
            entry.get("sub_topic_id"): entry.get("sub_topic_name")
            for entry in topic_entries
            if isinstance(entry, dict) and entry.get("sub_topic_id")
        }
        topics.append(
            {
                "id": topic_id,
                "display_name": display_name,
                "entry_count": len(topic_entries),
                "party_count": len(parties),
                "sub_topics": [
                    {"id": key, "name": value}
                    for key, value in sorted(sub_topics.items())
                    if isinstance(key, str) and isinstance(value, str)
                ],
            }
        )
    return sorted(topics, key=lambda item: str(item["display_name"]))


@app.get("/api/topics/{topic_id}")
def get_topic(topic_id: str) -> list[dict[str, Any]]:
    if topic_id not in TOPIC_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Topic not found: {topic_id}")
    topic = get_engine().get_topic(topic_id)
    if topic is None:
        raise HTTPException(status_code=404, detail=f"Topic not found: {topic_id}")
    return topic


@app.post("/api/chat")
def chat(payload: ChatRequest) -> ChatResult:
    try:
        return get_engine().chat(payload.message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected chat failure: {exc}") from exc
