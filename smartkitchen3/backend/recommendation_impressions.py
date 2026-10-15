"""Builds and validates recommendation impression documents for A/B tracking."""

import re
from datetime import datetime, timezone
from uuid import uuid4


_IMPRESSION_ID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', re.IGNORECASE)


def validate_impression_id(value: object) -> str:
    """Return value as a validated UUID-v4 string, or raise ValueError."""
    if not isinstance(value, str) or not _IMPRESSION_ID_RE.match(value.strip()):
        raise ValueError(f"Invalid impression_id: {value!r}")
    return value.strip()


def build_impression_document(
    household_id: str,
    ranked: list,
    inventory: list,
    prefs: object,
) -> dict:
    """Return a MongoDB-ready impression document for the given ranked recipe list.

    ranked  — list of (recipe_dict, scores_dict) tuples from rank_recipes().
    inventory — raw MongoDB inventory documents for the household.
    prefs   — UserPreferences instance.
    """
    impression_id = str(uuid4())
    now = datetime.now(timezone.utc)

    recommendations = []
    for rank, (recipe, scores) in enumerate(ranked, start=1):
        recipe_id = recipe.get("id")
        try:
            recipe_id = int(recipe_id)
        except (TypeError, ValueError):
            recipe_id = 0

        final_score = float(scores.get("final", 0.0))
        final_score = max(0.0, min(1.0, final_score))

        score_components = {
            key: round(float(val), 6)
            for key, val in scores.items()
            if key != "final"
        }

        recommendations.append({
            "recipe_id": recipe_id,
            "rank": rank,
            "score": final_score,
            "score_components": score_components,
        })

    context = {
        "inventory_size": len(inventory),
        "preferred_categories": list(getattr(prefs, "preferred_categories", []) or []),
        "dietary_constraints": list(getattr(prefs, "dietary_constraints", []) or []),
        "difficulty_preference": getattr(prefs, "difficulty_preference", "medium"),
    }

    return {
        "impression_id": impression_id,
        "household_id": str(household_id),
        "created_at": now,
        "recommendations": recommendations,
        "context": context,
    }
