"""Evaluate the production Smart Kitchen recommender with temporal, ranking-aware metrics."""

from __future__ import annotations

import ast
import json
import math
import os
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Sequence

import joblib
import numpy as np
import pandas as pd
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


K = 5
CANDIDATE_POOL_SIZE = 5000
RANDOM_SEED = 42
PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOCAL_ROOT = Path(__file__).resolve().parent
DEFAULT_ENGINE_ROOT = PROJECT_ROOT / "Syntethic Data"
ENGINE_ROOT = DEFAULT_ENGINE_ROOT if DEFAULT_ENGINE_ROOT.is_dir() else LOCAL_ROOT
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))
from evaluation_protocol import split_households
from train_model import (
    BASELINE_FEATURE_NAMES,
    FEATURE_NAMES,
    build_feature_row,
    contains_term,
    list_value,
    normalize_terms,
    safe_float,
)


@dataclass(frozen=True)
class EvaluationCase:
    household_id: str
    recommendations: tuple[int, ...]
    baseline: tuple[int, ...]
    relevance: dict[int, float]
    history: tuple[int, ...]
    outcome_recipe_id: int | None = None
    outcome: str = ""
    rating: float | None = None


@dataclass(frozen=True)
class RankingRuntime:
    recipes: tuple[dict, ...]
    vectorizer: TfidfVectorizer
    recipe_matrix: object
    model: object
    baseline_model: object
    metadata: dict


def ndcg_at_k(recommendations: Sequence[int], relevance: dict[int, float], k: int = K) -> float:
    gains = [relevance.get(recipe_id, 0.0) for recipe_id in recommendations[:k]]
    gains.extend([0.0] * max(0, k - len(gains)))
    dcg = sum((2.0**gain - 1.0) / math.log2(rank + 2.0) for rank, gain in enumerate(gains))
    ideal = sorted(relevance.values(), reverse=True)[:k]
    ideal.extend([0.0] * max(0, k - len(ideal)))
    idcg = sum((2.0**gain - 1.0) / math.log2(rank + 2.0) for rank, gain in enumerate(ideal))
    return dcg / idcg if idcg > 0 else 0.0


def normalized_r_score(
    recommendations: Sequence[int],
    relevance: dict[int, float],
    k: int = K,
    half_life: float = 2.0,
) -> float:
    """Return normalized half-life utility using graded relevance."""
    if half_life <= 1:
        raise ValueError("half_life must be greater than 1")
    weights = [2.0 ** (-rank / (half_life - 1.0)) for rank in range(k)]
    actual = sum(relevance.get(recipe_id, 0.0) * weights[index] for index, recipe_id in enumerate(recommendations[:k]))
    ideal_values = sorted(relevance.values(), reverse=True)[:k]
    ideal = sum(value * weights[index] for index, value in enumerate(ideal_values))
    return actual / ideal if ideal > 0 else 0.0


def bootstrap_confidence_interval(
    values: Sequence[float],
    confidence: float = 0.95,
    resamples: int = 2000,
    seed: int = RANDOM_SEED,
) -> tuple[float, float]:
    array = np.asarray(values, dtype=float)
    if array.size == 0:
        return 0.0, 0.0
    rng = np.random.default_rng(seed)
    samples = rng.choice(array, size=(resamples, array.size), replace=True).mean(axis=1)
    alpha = (1.0 - confidence) / 2.0
    return float(np.quantile(samples, alpha)), float(np.quantile(samples, 1.0 - alpha))


def paired_permutation_pvalue(model_values: Sequence[float], baseline_values: Sequence[float], resamples: int = 10_000, seed: int = RANDOM_SEED) -> float:
    """Return a two-sided paired randomization-test p-value."""
    model = np.asarray(model_values, dtype=float)
    baseline = np.asarray(baseline_values, dtype=float)
    if model.size == 0 or model.shape != baseline.shape:
        raise ValueError("paired metric arrays must be non-empty and have equal shapes")
    differences = model - baseline
    observed = abs(float(differences.mean()))
    rng = np.random.default_rng(seed)
    signs = rng.choice((-1.0, 1.0), size=(resamples, differences.size))
    randomized = np.abs((signs * differences).mean(axis=1))
    return float((np.count_nonzero(randomized >= observed) + 1) / (resamples + 1))


def _find_data_dir() -> Path:
    configured = os.getenv("SMART_KITCHEN_DATA_DIR")
    candidates = [Path(configured)] if configured else []
    candidates.extend([
        PROJECT_ROOT / "SmartKitchenDB", Path.cwd() / "SmartKitchenDB",
        Path.cwd().parent / "SmartKitchenDB", ENGINE_ROOT,
        Path.cwd() / "Syntethic Data", Path.cwd().parent / "Syntethic Data",
    ])
    for candidate in candidates:
        if (candidate / "SmartKitchenDB.recipes.csv").is_file():
            return candidate.resolve()
    raise FileNotFoundError("SmartKitchenDB CSV files were not found")


def _load_csv_frames(data_dir: Path, collections: dict[str, str]) -> dict[str, pd.DataFrame]:
    """Load a complete CSV fallback or fail with the exact missing collections."""
    paths = {
        name: data_dir / f"SmartKitchenDB.{collection}.csv"
        for name, collection in collections.items()
    }
    missing = [collection for name, collection in collections.items() if not paths[name].is_file()]
    if missing:
        raise FileNotFoundError(
            "CSV fallback is incomplete; missing collections: " + ", ".join(sorted(missing))
        )
    frames = {
        name: pd.read_csv(path, low_memory=False)
        for name, path in paths.items()
    }
    for frame in frames.values():
        for column in ("recommendations", "context", "model_ranking", "baseline_ranking", "ranking_policy", "ingredients", "tags"):
            if column not in frame.columns:
                continue
            def decode(value):
                if not isinstance(value, str):
                    return value
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    try:
                        return ast.literal_eval(value)
                    except (ValueError, SyntaxError):
                        return value
            frame[column] = frame[column].map(decode)
    empty = [collections[name] for name, frame in frames.items() if frame.empty]
    if empty:
        raise ValueError("CSV fallback contains empty collections: " + ", ".join(sorted(empty)))
    return frames


def _load_frames() -> dict[str, pd.DataFrame]:
    collections = {
        "recipes": "recipes",
        "impressions": "recommendation_impressions",
    }
    configured_data_dir = os.getenv("SMART_KITCHEN_DATA_DIR")
    if configured_data_dir:
        return _load_csv_frames(Path(configured_data_dir).expanduser().resolve(), collections)
    mongo_uri = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/")
    database_name = os.getenv("MONGO_DB", "SmartKitchenDB")
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=2000)
    try:
        client.admin.command("ping")
        database = client[database_name]
        frames = {name: pd.DataFrame(list(database[collection].find())) for name, collection in collections.items()}
        empty = [collections[name] for name, frame in frames.items() if frame.empty]
        if empty:
            raise ValueError(
                f"MongoDB database {database_name!r} contains empty required collections: "
                + ", ".join(sorted(empty))
            )
        return frames
    except PyMongoError as mongo_error:
        try:
            data_dir = _find_data_dir()
            return _load_csv_frames(data_dir, collections)
        except (FileNotFoundError, ValueError) as csv_error:
            raise RuntimeError(
                f"Cannot connect to MongoDB at {mongo_uri!r}, and the CSV fallback cannot be used: "
                f"{csv_error}. Start MongoDB and verify database {database_name!r}, or provide a complete "
                "fallback directory through SMART_KITCHEN_DATA_DIR."
            ) from mongo_error
    finally:
        client.close()


def _normalize_frames(frames: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    actions = frames.get("actions", pd.DataFrame()).copy()
    recipes = frames["recipes"].copy()
    if not actions.empty:
        actions["recipe_id"] = pd.to_numeric(actions["recipe_id"], errors="coerce")
        actions = actions.dropna(subset=["household_id", "recipe_id", "action"]).copy()
        actions["recipe_id"] = actions["recipe_id"].astype(int)
        actions["action"] = actions["action"].astype(str).str.strip().str.lower().replace({"performed": "cooked"})
        timestamp_values = actions["timestamp"] if "timestamp" in actions.columns else pd.Series(pd.NaT, index=actions.index)
        if "action_date" in actions.columns:
            timestamp_values = timestamp_values.combine_first(actions["action_date"])
        actions["event_time"] = pd.to_datetime(timestamp_values, errors="coerce", utc=True, format="mixed")
        actions = actions.dropna(subset=["event_time"])
        actions["rating"] = pd.to_numeric(actions.get("rating"), errors="coerce")

    recipes["id"] = pd.to_numeric(recipes["id"], errors="coerce")
    recipes = recipes.dropna(subset=["id"]).copy()
    recipes["id"] = recipes["id"].astype(int)
    frames.update({"actions": actions, "recipes": recipes})
    return frames


def _temporal_cases(actions: pd.DataFrame, max_households: int) -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    train_parts, test_parts, eligible = [], [], []
    for household_id, group in actions.sort_values("event_time").groupby("household_id"):
        if len(group) < 5:
            continue
        split = max(1, min(len(group) - 1, int(len(group) * 0.8)))
        train, test = group.iloc[:split], group.iloc[split:]
        if not (test["action"] == "cooked").any():
            continue
        train_parts.append(train)
        test_parts.append(test)
        eligible.append(str(household_id))
    rng = np.random.default_rng(RANDOM_SEED)
    selected = list(rng.choice(eligible, size=min(max_households, len(eligible)), replace=False)) if eligible else []
    train_frame = pd.concat(train_parts, ignore_index=True) if train_parts else actions.iloc[0:0]
    test_frame = pd.concat(test_parts, ignore_index=True) if test_parts else actions.iloc[0:0]
    return train_frame, test_frame, selected


def _graded_relevance(test_actions: pd.DataFrame) -> dict[int, float]:
    relevance: dict[int, float] = {}
    for row in test_actions.itertuples():
        value = 0.0 if row.action == "skipped" else float(np.clip((row.rating if pd.notna(row.rating) else 0.0) / 5.0, 0.0, 1.0))
        relevance[int(row.recipe_id)] = max(relevance.get(int(row.recipe_id), 0.0), value)
    return relevance


def _parse_impression(impression: dict, k: int) -> tuple[tuple[int, ...], dict[int, float]]:
    """Validate one logged impression and derive its displayed ranking and observed relevance."""
    rows = impression.get("recommendations")
    if not isinstance(rows, list) or not rows:
        raise ValueError("An impression must contain recommendations")
    ordered = sorted(rows, key=lambda row: int(row.get("rank", 0)))
    recommendation_ids: list[int] = []
    relevance: dict[int, float] = {}
    seen: set[int] = set()
    outcomes = 0
    for row in ordered:
        try:
            recipe_id = int(row["recipe_id"])
            rank = int(row["rank"])
        except (KeyError, TypeError, ValueError, OverflowError) as exc:
            raise ValueError("Recommendation ids and ranks must be integers") from exc
        if recipe_id in seen or rank < 1:
            raise ValueError("Recommendation ids must be unique and ranks positive")
        seen.add(recipe_id)
        recommendation_ids.append(recipe_id)
        outcome = str(row.get("outcome") or "").lower()
        if outcome:
            outcomes += 1
        if outcome == "cooked":
            try:
                rating = float(row["rating"])
            except (KeyError, TypeError, ValueError, OverflowError) as exc:
                raise ValueError("Cooked outcomes require a numeric rating") from exc
            if not math.isfinite(rating) or not 1 <= rating <= 5:
                raise ValueError("Cooked ratings must be between 1 and 5")
            relevance[recipe_id] = rating / 5.0
        elif outcome not in {"", "skipped"}:
            raise ValueError("Outcome must be cooked or skipped")
        elif outcome == "skipped" and "rating" in row:
            raise ValueError("Skipped outcomes cannot have a rating")
    if outcomes != 1:
        raise ValueError("Each evaluated impression must contain exactly one observed outcome")
    return tuple(recommendation_ids[:k]), relevance


def _parse_logged_ranking(impression: dict, field: str, k: int) -> tuple[int, ...]:
    rows = impression.get(field)
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"{field} is required")
    ordered = sorted(rows, key=lambda row: int(row.get("rank", 0)))
    ids = tuple(int(row["recipe_id"]) for row in ordered[:k])
    if len(ids) != len(set(ids)):
        raise ValueError(f"{field} contains duplicate recipes")
    return ids


def _observed_outcome(impression: dict) -> tuple[int, str, float | None]:
    rows = impression.get("recommendations")
    outcomes = [row for row in rows if isinstance(row, dict) and str(row.get("outcome") or "").lower() in {"cooked", "skipped"}] if isinstance(rows, list) else []
    if len(outcomes) != 1:
        raise ValueError("Each evaluated impression must contain exactly one observed outcome")
    row = outcomes[0]
    recipe_id = int(row["recipe_id"])
    outcome = str(row["outcome"]).lower()
    rating = float(row["rating"]) if outcome == "cooked" else None
    return recipe_id, outcome, rating


def _recipe_is_allowed(recipe: dict, preferences: dict) -> bool:
    """Mirror Flask hard filtering for dietary constraints and disliked ingredients."""
    tags = {normalize_terms(tag) for tag in list_value(recipe.get("tags"))}
    constraints = {
        normalize_terms(value)
        for value in list_value(preferences.get("dietary_constraints"))
        if normalize_terms(value)
    }
    if not constraints.issubset(tags):
        return False
    ingredients = normalize_terms(recipe.get("ingredients"))
    disliked = [
        normalize_terms(value)
        for value in list_value(preferences.get("disliked_ingredients"))
        if normalize_terms(value)
    ]
    return not any(contains_term(ingredients, value) for value in disliked)


def _parse_expiry(value: object) -> datetime | None:
    if isinstance(value, dict):
        value = value.get("$date")
        if isinstance(value, dict):
            value = value.get("$numberLong")
        if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
            value = pd.to_datetime(float(value), unit="ms", errors="coerce", utc=True)
    parsed = pd.to_datetime(value, errors="coerce", utc=True)
    if pd.isna(parsed):
        return None
    return parsed.to_pydatetime().astimezone(timezone.utc).replace(tzinfo=None)


def _fefo_scores(recipes: Sequence[dict], inventory: Sequence[dict], reference: datetime, days: int = 7) -> np.ndarray:
    urgent: list[tuple[str, float]] = []
    reference = reference.astimezone(timezone.utc).replace(tzinfo=None) if reference.tzinfo else reference
    for item in inventory:
        if not isinstance(item, dict):
            continue
        expiry = _parse_expiry(item.get("expiry_date"))
        name = normalize_terms(item.get("product_name"))
        if expiry is None or not name:
            continue
        days_left = (expiry.date() - reference.date()).days
        if 0 <= days_left <= days:
            urgent.append((name, 1.0 - (days_left / (days + 1.0))))
    return np.asarray([
        max((urgency for name, urgency in urgent if contains_term(recipe.get("ingredients"), name)), default=0.0)
        for recipe in recipes
    ], dtype=float)


def _observed_recipe_ids(impressions: Iterable[dict]) -> set[int]:
    result: set[int] = set()
    for impression in impressions:
        for row in impression.get("recommendations", []):
            if not isinstance(row, dict) or not row.get("outcome"):
                continue
            try:
                result.add(int(row["recipe_id"]))
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
    return result


def _build_candidate_pool(recipes: Sequence[dict], required_ids: set[int], limit: int) -> list[dict]:
    """Build the same bounded, insertion-ordered candidate corpus used by Flask."""
    if limit <= K:
        raise ValueError(f"candidate pool must contain more than Top-{K} recipes")
    by_id = {int(recipe["id"]): recipe for recipe in recipes if str(recipe.get("id", "")).isdigit()}
    missing = sorted(required_ids.difference(by_id))
    if missing:
        raise ValueError(f"Observed recipes are missing from the recipe catalog: {missing[:10]}")
    pool = list(recipes[:limit])
    pool_ids = {int(recipe["id"]) for recipe in pool}
    outside_pool = sorted(required_ids.difference(pool_ids))
    if outside_pool:
        raise ValueError(f"Observed recipes fall outside the Flask candidate pool: {outside_pool[:10]}")
    if len(pool) <= K:
        raise ValueError(f"At least {K + 1} candidate recipes are required")
    return pool


def _build_ranking_runtime(recipes: Sequence[dict], required_ids: set[int], candidate_pool_size: int) -> RankingRuntime:
    pool = _build_candidate_pool(recipes, required_ids, candidate_pool_size)
    documents = [
        normalize_terms([recipe.get("name", ""), *list_value(recipe.get("ingredients"))]) or "unknown"
        for recipe in pool
    ]
    vectorizer = TfidfVectorizer(ngram_range=(1, 2), norm="l2", sublinear_tf=True)
    matrix = vectorizer.fit_transform(documents)
    artifact_candidates = [ENGINE_ROOT / "recommendation_model.pkl", LOCAL_ROOT / "recommendation_model.pkl"]
    artifact_path = next((path for path in artifact_candidates if path.is_file()), artifact_candidates[0])
    if not artifact_path.is_file():
        raise FileNotFoundError(f"Trained recommendation artifact was not found: {artifact_path}")
    artifact = joblib.load(artifact_path)
    if not isinstance(artifact, dict) or artifact.get("model") is None or artifact.get("baseline_model") is None:
        raise ValueError("recommendation_model.pkl must contain model and baseline_model")
    return RankingRuntime(
        recipes=tuple(pool), vectorizer=vectorizer, recipe_matrix=matrix,
        model=artifact["model"], baseline_model=artifact["baseline_model"],
        metadata=dict(artifact.get("metadata") or {}),
    )


def _rank_with_flask_pipeline(runtime: RankingRuntime, inventory: Sequence[dict], preferences: dict, reference: datetime) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """Replay Flask hard filters, TF-IDF/cosine, pointwise scoring, FEFO, and baseline ranking."""
    allowed_pairs = [(index, recipe) for index, recipe in enumerate(runtime.recipes) if _recipe_is_allowed(recipe, preferences)]
    if not allowed_pairs:
        return (), ()
    allowed = [recipe for _, recipe in allowed_pairs]
    allowed_matrix = runtime.recipe_matrix[[index for index, _ in allowed_pairs]]
    inventory_doc = normalize_terms([
        text for item in inventory if isinstance(item, dict)
        for text in (item.get("product_name", ""), item.get("category", ""))
    ])
    content_scores = cosine_similarity(runtime.vectorizer.transform([inventory_doc]), allowed_matrix)[0]
    fefo_scores = _fefo_scores(allowed, inventory, reference)
    feature_rows = [
        build_feature_row(recipe, preferences, content_scores[index], fefo_scores[index])
        for index, recipe in enumerate(allowed)
    ]
    feature_names = list(runtime.metadata.get("feature_names") or FEATURE_NAMES)
    model_frame = pd.DataFrame(feature_rows)[feature_names]
    predictions = np.clip(runtime.model.predict(model_frame), 0.0, 1.0)
    heuristic = np.asarray([
        (0.6 * row["prep_time_fit"]) + (0.4 * row["preferred_category_fit"])
        for row in feature_rows
    ])
    personal_scores = (0.65 * predictions) + (0.35 * heuristic)
    final_scores = np.clip((0.60 * content_scores) + (0.25 * personal_scores) + (0.15 * fefo_scores), 0.0, 1.0)
    model_order = np.argsort(-final_scores, kind="stable")

    baseline_frame = pd.DataFrame(feature_rows)[BASELINE_FEATURE_NAMES]
    baseline_scores = runtime.baseline_model.predict_proba(baseline_frame)[:, 1]
    baseline_order = np.argsort(-baseline_scores, kind="stable")
    return (
        tuple(int(allowed[index]["id"]) for index in model_order),
        tuple(int(allowed[index]["id"]) for index in baseline_order),
    )


def _replayed_impression_cases(
    impressions: pd.DataFrame,
    recipes: Sequence[dict],
    data_source: str,
    max_households: int,
    k: int,
    candidate_pool_size: int,
) -> tuple[list[EvaluationCase], Counter[int], tuple[dict, ...]]:
    """Create test cases by replaying the Flask ranking pipeline over each logged context snapshot."""
    if data_source not in {"real", "synthetic"}:
        raise ValueError("data_source must be real or synthetic")
    if impressions.empty or "data_source" not in impressions.columns:
        return [], Counter(), ()
    source = impressions.loc[impressions["data_source"].astype(str).str.lower() == data_source].copy()
    source["created_at"] = pd.to_datetime(source["created_at"], errors="coerce", utc=True, format="mixed")
    source = source.dropna(subset=["household_id", "created_at"]).sort_values("created_at")
    household_split = split_households(source["household_id"].astype(str).unique(), RANDOM_SEED)
    rng = np.random.default_rng(RANDOM_SEED)
    eligible = sorted(household_split.test)
    selected = set(rng.choice(eligible, size=min(max_households, len(eligible)), replace=False))
    test_records = source.loc[source["household_id"].astype(str).isin(selected)].to_dict("records")
    runtime = _build_ranking_runtime(recipes, _observed_recipe_ids(test_records), candidate_pool_size)

    training_cooked: Counter[int] = Counter()
    for impression in source.loc[source["household_id"].astype(str).isin(household_split.train)].to_dict("records"):
        try:
            _, relevance = _parse_impression(impression, k)
            training_cooked.update(relevance)
        except ValueError:
            continue

    cases: list[EvaluationCase] = []
    for household_id, group in source.loc[source["household_id"].astype(str).isin(selected)].groupby("household_id"):
        history: list[int] = []
        for impression in group.sort_values("created_at").to_dict("records"):
            try:
                _, relevance = _parse_impression(impression, k)
                outcome_recipe_id, outcome, rating = _observed_outcome(impression)
                context = impression.get("context")
                if not isinstance(context, dict):
                    raise ValueError("Impression context is required")
                inventory = context.get("inventory")
                preferences = context.get("preferences")
                if not isinstance(inventory, list) or not isinstance(preferences, dict):
                    raise ValueError("Inventory and preference snapshots are required")
                model_ranking, baseline_ranking = _rank_with_flask_pipeline(
                    runtime, inventory, preferences, impression["created_at"].to_pydatetime()
                )
                if len(model_ranking) < k or len(baseline_ranking) < k:
                    raise ValueError("Hard filtering left fewer recipes than Top-K")
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
            cases.append(EvaluationCase(
                household_id=str(household_id),
                recommendations=model_ranking, baseline=baseline_ranking,
                relevance=relevance, history=tuple(history),
                outcome_recipe_id=outcome_recipe_id, outcome=outcome, rating=rating,
            ))
            history.extend(relevance)
    return cases, training_cooked, runtime.recipes


def _impression_cases(
    impressions: pd.DataFrame,
    data_source: str,
    max_households: int,
    k: int,
) -> tuple[list[EvaluationCase], Counter[int]]:
    """Build chronological logged-impression cases without using future outcomes as history."""
    if data_source not in {"real", "synthetic"}:
        raise ValueError("data_source must be real or synthetic")
    if impressions.empty or "data_source" not in impressions.columns:
        return [], Counter()
    source = impressions.loc[impressions["data_source"] == data_source].copy()
    source["created_at"] = pd.to_datetime(source["created_at"], errors="coerce", utc=True, format="mixed")
    source = source.dropna(subset=["household_id", "created_at"]).sort_values("created_at")
    household_split = split_households(source["household_id"].astype(str).unique(), RANDOM_SEED)
    eligible = sorted(household_split.test)
    rng = np.random.default_rng(RANDOM_SEED)
    selected = set(rng.choice(eligible, size=min(max_households, len(eligible)), replace=False))
    cases: list[EvaluationCase] = []
    training_cooked: Counter[int] = Counter()
    for impression in source.loc[source["household_id"].astype(str).isin(household_split.train)].to_dict("records"):
        try:
            _, relevance = _parse_impression(impression, k)
            training_cooked.update(relevance)
        except ValueError:
            continue
    for household_id, group in source.loc[source["household_id"].astype(str).isin(selected)].groupby("household_id"):
        group = group.sort_values("created_at")
        history: list[int] = []
        for impression in group.to_dict("records"):
            try:
                recommendations, relevance = _parse_impression(impression, k)
                model_ranking = _parse_logged_ranking(impression, "model_ranking", k)
                baseline_ranking = _parse_logged_ranking(impression, "baseline_ranking", k)
            except ValueError:
                continue
            cooked_ids = list(relevance)
            cases.append(EvaluationCase(
                household_id=str(household_id),
                recommendations=model_ranking,
                baseline=baseline_ranking,
                relevance=relevance,
                history=tuple(history),
            ))
            history.extend(cooked_ids)
    return cases, training_cooked


def evaluate(
    max_households: int = 200,
    k: int = K,
    data_source: str = "synthetic",
    candidate_pool_size: int = CANDIDATE_POOL_SIZE,
) -> tuple[pd.DataFrame, dict[str, object]]:
    """Evaluate the Flask ranking pipeline on chronological logged context snapshots."""
    if max_households <= 0 or k <= 0 or candidate_pool_size <= k:
        raise ValueError("max_households and k must be positive, and candidate_pool_size must exceed k")
    frames = _normalize_frames(_load_frames())
    recipes = frames["recipes"].to_dict("records")
    cases, _, candidate_recipes = _replayed_impression_cases(
        frames["impressions"], recipes, data_source, max_households, k, candidate_pool_size
    )
    if not cases:
        raise ValueError(
            f"No valid {data_source} recommendation impressions could be replayed through the Flask pipeline"
        )
    metric_functions: dict[str, tuple[Callable[[EvaluationCase], float], Callable[[EvaluationCase], float]]] = {
        f"NDCG@{k}": (
            lambda case: ndcg_at_k(case.recommendations, case.relevance, k),
            lambda case: ndcg_at_k(case.baseline, case.relevance, k),
        ),
        "Normalized R-Score": (
            lambda case: normalized_r_score(case.recommendations, case.relevance, k),
            lambda case: normalized_r_score(case.baseline, case.relevance, k),
        ),
    }
    rows = []
    for name, (production_function, baseline_function) in metric_functions.items():
        production_values = [production_function(case) for case in cases]
        baseline_values = [baseline_function(case) for case in cases]
        production_mean = float(np.mean(production_values)) if production_values else 0.0
        baseline_mean = float(np.mean(baseline_values))
        p_value = paired_permutation_pvalue(production_values, baseline_values)
        statistical_test = "Paired randomization"
        lower, upper = bootstrap_confidence_interval(production_values)
        rows.append({
            "metric": name,
            "production_mean": production_mean,
            "baseline_mean": baseline_mean,
            "absolute_lift": production_mean - baseline_mean,
            "relative_lift": (production_mean - baseline_mean) / baseline_mean if baseline_mean else np.nan,
            "p_value": p_value,
            "significant_at_005": p_value <= 0.05,
            "statistical_test": statistical_test,
            "ci95_low": lower,
            "ci95_high": upper,
            "households": len(production_values),
        })
    report = pd.DataFrame(rows)
    cooked_cases = [case for case in cases if case.outcome == "cooked"]
    skipped_cases = [case for case in cases if case.outcome == "skipped"]
    model_cooked_hits = sum(case.outcome_recipe_id in case.recommendations[:k] for case in cooked_cases)
    baseline_cooked_hits = sum(case.outcome_recipe_id in case.baseline[:k] for case in cooked_cases)
    model_skipped_hits = sum(case.outcome_recipe_id in case.recommendations[:k] for case in skipped_cases)
    baseline_skipped_hits = sum(case.outcome_recipe_id in case.baseline[:k] for case in skipped_cases)
    missed_examples = []
    for case in cooked_cases:
        if case.outcome_recipe_id in case.recommendations[:k]:
            continue
        missed_examples.append({
            "household_id": case.household_id,
            "recipe_id": case.outcome_recipe_id,
            "rating": case.rating,
            "model_rank": case.recommendations.index(case.outcome_recipe_id) + 1 if case.outcome_recipe_id in case.recommendations else None,
            "baseline_rank": case.baseline.index(case.outcome_recipe_id) + 1 if case.outcome_recipe_id in case.baseline else None,
        })
        if len(missed_examples) == 5:
            break
    error_analysis = {
        "cooked_outcomes": len(cooked_cases),
        "skipped_outcomes": len(skipped_cases),
        "model_cooked_in_top_k": model_cooked_hits,
        "model_cooked_missed": len(cooked_cases) - model_cooked_hits,
        "baseline_cooked_in_top_k": baseline_cooked_hits,
        "baseline_cooked_missed": len(cooked_cases) - baseline_cooked_hits,
        "model_explicit_skips_in_top_k": model_skipped_hits,
        "baseline_explicit_skips_in_top_k": baseline_skipped_hits,
        "note": "Unacted recommendations are unlabeled and are not counted as false positives.",
        "model_missed_cooked_examples": missed_examples,
    }
    metadata = {
        "k": k,
        "data_source": data_source,
        "impressions": len(cases),
        "households": len({case.household_id for case in cases}),
        "split_protocol": "Non-overlapping household groups: 65% train, 15% validation, 20% locked test",
        "temporal_protocol": "Each test household is evaluated chronologically using only its prior events as history",
        "candidate_pool_size": len(candidate_recipes),
        "production_model": "Flask-equivalent hard filtering, TF-IDF/cosine, pointwise scoring, FEFO weighting, and Top-K",
        "baseline": "Logistic Regression ranking over the identical candidate pool using FEFO, preparation-time fit, and difficulty fit",
        "statistical_test": "Paired randomization for NDCG@K and Normalized R-Score; p <= 0.05",
        "error_analysis": error_analysis,
        "limitations": "Synthetic outcomes are treated as test ground truth; rankings are replayed from logged context snapshots, while real production conclusions require sufficient randomized real impressions.",
    }
    return report, metadata


if __name__ == "__main__":
    evaluation_report, evaluation_metadata = evaluate()
    error_analysis = evaluation_metadata.pop("error_analysis")
    print("EXPERIMENT PROTOCOL")
    print(evaluation_metadata)
    print("\nFINAL MODEL VS BASELINE")
    print(evaluation_report.to_string(index=False))
    print("\nERROR ANALYSIS")
    print(error_analysis)
