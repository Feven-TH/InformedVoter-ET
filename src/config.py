"""Runtime registries for the InformedVoter-ET AI router."""

from __future__ import annotations

import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
TOPIC_REGISTRY_PATH = BASE_DIR / "data" / "topic_registry.json"

DEFAULT_TOPIC_REGISTRY: dict[str, str] = {
    "federalism": "Stances on federalism, ethnic identity, regional boundaries, self-administration, or decentralization.",
    "economy_taxation": "Stances on economic reform, social justice programming, resource distribution, and taxation models.",
    "ideology_evolution": "The political philosophy, alignment, history, or organizational evolution of a specific party.",
}


def load_topic_registry() -> dict[str, str]:
    try:
        with TOPIC_REGISTRY_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return DEFAULT_TOPIC_REGISTRY

    if not isinstance(payload, dict):
        return DEFAULT_TOPIC_REGISTRY

    registry = {
        key: value
        for key, value in payload.items()
        if isinstance(key, str) and isinstance(value, str)
    }
    return registry or DEFAULT_TOPIC_REGISTRY


TOPIC_REGISTRY: dict[str, str] = load_topic_registry()

PARTY_REGISTRY: dict[str, list[str]] = {
    "afar-peoples-party": ["APP", "Afar People's Party", "Afar Party"],
    "peace-for-ethiopia-coalition": ["PFEC", "Peace for Ethiopia", "Coalition"],
    "ethiopian-social-democratic-party": ["ESDP", "Social Democrats", "Beyene Petros"],
    "amhara-democratic-force-movement": ["ADFM", "Amhara Democratic Force", "Movement"],
    "ethiopian-citizens-for-social-justice": ["EZEMA", "Ethiopian Citizens for Social Justice", "Ezema"],
}
