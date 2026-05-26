"""In-memory retrieval engine and Gemini routing pipeline."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal
import logging
import time

from pydantic import BaseModel, Field, ValidationError, field_validator
from dotenv import load_dotenv

from .config import PARTY_REGISTRY, TOPIC_REGISTRY


load_dotenv()

try:
    import google.generativeai as genai
except ImportError:  # pragma: no cover - exercised only before dependencies are installed.
    genai = None  # type: ignore[assignment]


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
PARTY_INDEX_PATH = DATA_DIR / "party_index.json"
TOPIC_INDEX_PATH = DATA_DIR / "topic_index.json"

IntentType = Literal["PARTY", "TOPIC", "GENERAL"]
DEFAULT_MODEL_CANDIDATES = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
]

# module logger
logger = logging.getLogger("informedvoter.engine")


class RouterDecision(BaseModel):
    intent_type: IntentType
    matched_topic: str | None = None
    target_parties: list[str] = Field(default_factory=list)

    @field_validator("matched_topic")
    @classmethod
    def validate_topic(cls, value: str | None) -> str | None:
        if value is not None and value not in TOPIC_REGISTRY:
            raise ValueError(f"matched_topic must be one of {list(TOPIC_REGISTRY)} or null")
        return value

    @field_validator("target_parties")
    @classmethod
    def validate_parties(cls, value: list[str]) -> list[str]:
        unknown = [party for party in value if party not in PARTY_REGISTRY]
        if unknown:
            raise ValueError(f"target_parties contains unknown keys: {unknown}")
        return value


class ChatResult(BaseModel):
    answer: str
    references: list[str]


class InformedVoterEngine:
    """Load static JSON indexes into RAM and answer routed user queries."""

    def __init__(
        self,
        party_index_path: Path = PARTY_INDEX_PATH,
        topic_index_path: Path = TOPIC_INDEX_PATH,
        model_name: str = "",
    ) -> None:
        self.party_index = self._load_index(party_index_path, expected_type=dict)
        self.topic_index = self._load_index(topic_index_path, expected_type=dict)
        self.model_name = model_name.strip()
        self.model_candidates = [
            candidate
            for candidate in ([self.model_name] if self.model_name else []) + DEFAULT_MODEL_CANDIDATES
            if candidate
        ]
        self._api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self._model: Any | None = None
        # retry configuration for model calls
        try:
            self.retry_attempts = int(os.getenv("IV_RETRY_ATTEMPTS", "2"))
        except Exception:
            self.retry_attempts = 2
        try:
            self.retry_backoff = float(os.getenv("IV_RETRY_BACKOFF", "0.5"))
        except Exception:
            self.retry_backoff = 0.5

    @staticmethod
    def _load_index(path: Path, expected_type: type) -> Any:
        try:
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except FileNotFoundError as exc:
            raise RuntimeError(f"Required index file is missing: {path}") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Index file is not valid JSON: {path}") from exc
        except OSError as exc:
            raise RuntimeError(f"Index file is unreadable: {path}") from exc

        if not isinstance(payload, expected_type):
            raise RuntimeError(f"Index file has invalid shape: {path}")
        return payload

    def get_party(self, slug: str) -> dict[str, Any] | None:
        party = self.party_index.get(slug)
        return party if isinstance(party, dict) else None

    def get_topic(self, topic_id: str) -> list[dict[str, str]] | None:
        topic = self.topic_index.get(topic_id)
        return topic if isinstance(topic, list) else None

    def chat(self, message: str) -> ChatResult:
        if not message.strip():
            raise ValueError("message must not be empty")

        decision = self._route_query(message)
        entries = self._extract_entries(decision)
        references = self._extract_references(entries)

        if not entries:
            return ChatResult(
                answer="I could not match that question to the supported party and topic indexes.",
                references=[],
            )

        answer = self._synthesize_answer(message=message, entries=entries)
        return ChatResult(answer=answer, references=references)

    def _require_model(self) -> Any:
        if genai is None:
            raise RuntimeError("google-generativeai is not installed. Install dependencies from requirements.txt.")
        if not self._api_key:
            raise RuntimeError("Gemini API key is not configured. Set GEMINI_API_KEY or GOOGLE_API_KEY.")
        if self._model is None:
            genai.configure(api_key=self._api_key)
            self._model = genai
        return genai

    def _generate_content(self, prompt: Any, generation_config: dict[str, Any] | None = None) -> Any:
        client = self._require_model()
        last_error: Exception | None = None

        for model_name in self.model_candidates:
            for attempt in range(1, max(1, self.retry_attempts) + 1):
                try:
                    logger.info("Trying model %s (attempt %d)", model_name, attempt)
                    model = client.GenerativeModel(model_name)
                    if generation_config is None:
                        return model.generate_content(prompt)
                    return model.generate_content(prompt, generation_config=generation_config)
                except Exception as exc:
                    last_error = exc
                    logger.warning(
                        "Model %s attempt %d failed: %s", model_name, attempt, getattr(exc, "message", str(exc))
                    )
                    if attempt < max(1, self.retry_attempts):
                        time.sleep(self.retry_backoff * attempt)
                    # on final attempt for this model, move to next model
                    continue

        logger.error("All model candidates failed: %s", self.model_candidates)
        raise RuntimeError(f"No supported Gemini model responded successfully. Last error: {last_error}") from last_error

    def _route_query(self, message: str) -> RouterDecision:
        model = self._require_model()
        prompt = {
            "task": "Route the user query to exact keys. Return JSON only.",
            "allowed_topics": TOPIC_REGISTRY,
            "allowed_parties": PARTY_REGISTRY,
            "schema": {
                "intent_type": 'One of "PARTY", "TOPIC", or "GENERAL".',
                "matched_topic": "One exact topic key or null.",
                "target_parties": "Array of exact party slug keys, or empty array.",
            },
            "routing_rules": [
                "Use PARTY when the user asks about one or more specific parties.",
                "Use TOPIC when the user asks for comparison by issue.",
                "Use GENERAL when neither exact topic nor party can be identified.",
                "Never invent keys. Use only the allowed keys.",
            ],
            "user_query": message,
        }
        response = self._generate_content(
            json.dumps(prompt, ensure_ascii=False),
            generation_config={"response_mime_type": "application/json"},
        )
        text = response.text or "{}"
        try:
            return RouterDecision.model_validate_json(text)
        except ValidationError as exc:
            raise ValueError("AI router returned an invalid routing decision") from exc

    def _extract_entries(self, decision: RouterDecision) -> list[dict[str, str]]:
        entries: list[dict[str, str]] = []
        topic_key = decision.matched_topic

        if decision.intent_type == "TOPIC" and topic_key:
            topic_entries = self.get_topic(topic_key) or []
            if decision.target_parties:
                return [
                    entry
                    for entry in topic_entries
                    if entry.get("party_slug") in decision.target_parties
                ]
            return list(topic_entries)

        if decision.intent_type == "PARTY":
            for party_slug in decision.target_parties:
                party = self.get_party(party_slug)
                if not party:
                    continue
                stances = party.get("stances", {})
                if not isinstance(stances, dict):
                    continue
                topic_items = (
                    [(topic_key, stances.get(topic_key))]
                    if topic_key
                    else list(stances.items())
                )
                for stance_topic, stance in topic_items:
                    if not isinstance(stance, dict):
                        continue
                    entries.append(
                        {
                            "party_slug": party_slug,
                            "party_name": str(party.get("name", party_slug)),
                            "topic": str(stance_topic),
                            "summary": str(stance.get("position", "")),
                            "video_url": str(stance.get("video_url", "")),
                        }
                    )
            return entries

        if decision.intent_type == "GENERAL" and topic_key:
            return list(self.get_topic(topic_key) or [])

        return entries

    @staticmethod
    def _extract_references(entries: list[dict[str, str]]) -> list[str]:
        references: list[str] = []
        seen: set[str] = set()
        for entry in entries:
            video_url = entry.get("video_url", "").strip()
            if video_url and video_url not in seen:
                references.append(video_url)
                seen.add(video_url)
        return references

    def _synthesize_answer(self, message: str, entries: list[dict[str, str]]) -> str:
        model = self._require_model()
        bounded_context = json.dumps(entries[:24], ensure_ascii=False, indent=2)
        prompt = f"""
You are InformedVoter-ET's answer synthesizer.

Use only the JSON context below. Do not use external knowledge, assumptions, or uncited party stances.
If the context is insufficient, say so plainly.
Write a concise, neutral answer in natural language.

User question:
{message}

JSON context:
{bounded_context}
""".strip()
        response = self._generate_content(prompt)
        answer = (response.text or "").strip()
        if not answer:
            return "The retrieved index entries did not produce a usable answer."
        return answer
