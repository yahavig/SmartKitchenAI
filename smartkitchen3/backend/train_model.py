"""Train, evaluate, version, and atomically persist the pointwise recommendation model."""

import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from pymongo import MongoClient
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import mean_absolute_error, ndcg_score, precision_score

from evaluation_protocol import split_households


MODEL_VERSION = 4
MIN_PRECISION_LIFT = 0.03
MAX_MAE_REGRESSION = 0.01
FEATURE_NAMES = [
    "content_score",
    "fefo_score",
    "diet_compatible",
    "no_disliked",
    "prep_time_fit",
    "preferred_category_fit",
    "difficulty_fit",
]
BASELINE_FEATURE_NAMES = ["fefo_score", "prep_time_fit", "difficulty_fit"]
MODEL_PATH = Path(__file__).with_name("recommendation_model.pkl")


def normalize_terms(value):
    if isinstance(value, (list, tuple, set)):
        value = " ".join(str(item) for item in value)
    return " ".join(str(value or "").strip().lower().split())


def list_value(value):
    if value is None:
        return []
    return list(value) if isinstance(value, (list, tuple, set)) else [value]


def safe_float(value, default=0.0):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError, OverflowError):
        return default


def contains_term(text, term):
    normalized_text = normalize_terms(text)
    normalized_term = normalize_terms(term)
    return bool(normalized_term and re.search(rf"(?<!\w){re.escape(normalized_term)}(?!\w)", normalized_text))


def parse_timestamp(action):
    value = action.get("timestamp") or action.get("action_date")
    if isinstance(value, datetime):
        return value.timestamp()
    if isinstance(value, dict):
        value = value.get("$date")
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0.0
    return safe_float(value)


def build_feature_row(recipe, household, content_score=0.0, fefo_score=0.0):
    tags = {normalize_terms(tag) for tag in list_value(recipe.get("tags"))}
    constraints = {normalize_terms(value) for value in list_value(household.get("dietary_constraints")) if normalize_terms(value)}
    disliked = [normalize_terms(value) for value in list_value(household.get("disliked_ingredients")) if normalize_terms(value)]
    ingredients = normalize_terms(recipe.get("ingredients"))
    diet_compatible = float(constraints.issubset(tags))
    no_disliked = float(not any(contains_term(ingredients, value) for value in disliked))

    prep_range = household.get("preferred_prep_time_range")
    maximum = safe_float(prep_range.get("max"), 60.0) if isinstance(prep_range, dict) else 60.0
    minutes = max(0.0, safe_float(recipe.get("minutes"), 30.0))
    prep_time_fit = 1.0 if maximum <= 0 else max(0.0, 1.0 - max(0.0, minutes - maximum) / max(maximum, 1.0))

    preferred = {normalize_terms(value) for value in list_value(household.get("preferred_categories")) if normalize_terms(value)}
    category_fit = 1.0 if not preferred else float(bool(preferred.intersection(tags)))
    difficulty = normalize_terms(household.get("difficulty_preference"))
    steps = max(0.0, safe_float(recipe.get("n_steps"), 5.0))
    inferred_difficulty = "easy" if steps <= 5 else "medium" if steps <= 12 else "hard"
    difficulty_fit = 1.0 if not difficulty or difficulty == inferred_difficulty or difficulty in tags else 0.0

    return {
        "content_score": min(max(safe_float(content_score), 0.0), 1.0),
        "fefo_score": min(max(safe_float(fefo_score), 0.0), 1.0),
        "diet_compatible": diet_compatible,
        "no_disliked": no_disliked,
        "prep_time_fit": prep_time_fit,
        "preferred_category_fit": category_fit,
        "difficulty_fit": difficulty_fit,
    }


def build_training_frame(actions, recipes, households):
    """Create pointwise examples where skipped is negative and cooked rating is graded relevance."""
    rows = []
    for action in actions:
        action_name = normalize_terms(action.get("action"))
        if action_name == "performed":
            action_name = "cooked"
        if action_name not in {"cooked", "skipped"}:
            continue
        recipe = recipes.get(action.get("recipe_id"))
        household = households.get(action.get("household_id"))
        if not recipe or not household:
            continue
        if action_name == "skipped":
            target = 0.0
        else:
            rating = safe_float(action.get("rating"), 0.0)
            if not 1.0 <= rating <= 5.0:
                continue
            target = rating / 5.0
        rows.append({
            **build_feature_row(recipe, household),
            "target": target,
            "household_id": action.get("household_id"),
            "timestamp": parse_timestamp(action),
        })
    return pd.DataFrame(rows)


def build_impression_training_frame(impressions, recipes):
    """Build historical pointwise examples from context snapshots and observed outcomes."""
    rows = []
    for impression in impressions:
        context = impression.get("context")
        recommendations = impression.get("recommendations")
        if not isinstance(context, dict) or not isinstance(recommendations, list):
            continue
        household = context.get("preferences")
        if not isinstance(household, dict):
            continue
        outcome_rows = [row for row in recommendations if row.get("outcome") in {"cooked", "skipped"}]
        if len(outcome_rows) != 1:
            continue
        outcome = outcome_rows[0]
        try:
            recipe_id = int(outcome["recipe_id"])
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        recipe = recipes.get(recipe_id)
        if not recipe:
            continue
        if outcome["outcome"] == "skipped":
            target = 0.0
        else:
            rating = safe_float(outcome.get("rating"), 0.0)
            if not 1 <= rating <= 5:
                continue
            target = rating / 5.0
        components = outcome.get("score_components") if isinstance(outcome.get("score_components"), dict) else {}
        rows.append({
            **build_feature_row(recipe, household, components.get("content"), components.get("fefo")),
            "target": target,
            "selected": int(outcome["outcome"] == "cooked"),
            "household_id": str(impression.get("household_id") or ""),
            "timestamp": parse_timestamp({"timestamp": impression.get("created_at")}),
        })
    return pd.DataFrame(rows)


def evaluate_predictions(test_frame, predictions):
    predictions = np.clip(np.asarray(predictions, dtype=float), 0.0, 1.0)
    actual_binary = (test_frame["target"].to_numpy() > 0).astype(int)
    predicted_binary = (predictions >= 0.5).astype(int)
    metrics = {
        "mae": float(mean_absolute_error(test_frame["target"], predictions)),
        "precision": float(precision_score(actual_binary, predicted_binary, zero_division=0)),
    }
    household_ndcg = []
    evaluation = test_frame.assign(prediction=predictions)
    for _, group in evaluation.groupby("household_id"):
        if len(group) >= 2 and group["target"].max() > 0:
            household_ndcg.append(float(ndcg_score([group["target"].to_numpy()], [group["prediction"].to_numpy()], k=min(5, len(group)))))
    metrics["ndcg_at_5"] = float(np.mean(household_ndcg)) if household_ndcg else None
    metrics["ndcg_evaluable_groups"] = len(household_ndcg)
    return metrics


def assess_promotion(model_metrics, baseline_metrics):
    """Evaluate the pointwise model without treating unavailable ranking NDCG as failure."""
    precision_lift = safe_float(model_metrics.get("precision")) - safe_float(baseline_metrics.get("precision"))
    mae_regression = safe_float(model_metrics.get("mae")) - safe_float(baseline_metrics.get("mae"))
    precision_passed = precision_lift >= MIN_PRECISION_LIFT
    mae_passed = mae_regression <= MAX_MAE_REGRESSION
    return {
        "passed": precision_passed and mae_passed,
        "precision_lift": precision_lift,
        "minimum_precision_lift": MIN_PRECISION_LIFT,
        "mae_regression": mae_regression,
        "maximum_mae_regression": MAX_MAE_REGRESSION,
        "precision_passed": precision_passed,
        "mae_passed": mae_passed,
        "ranking_metrics_location": "tests/metrics_evaluation.py",
    }


def split_training_frame(frame, seed=42):
    """Apply the report-defined disjoint 65/15/20 household protocol."""
    split = split_households(frame["household_id"].unique(), seed)
    groups = {
        "train": frame.loc[frame["household_id"].isin(split.train)].sort_values("timestamp").copy(),
        "validation": frame.loc[frame["household_id"].isin(split.validation)].sort_values("timestamp").copy(),
        "test": frame.loc[frame["household_id"].isin(split.test)].sort_values("timestamp").copy(),
    }
    if any(group.empty for group in groups.values()):
        raise ValueError("The household split produced an empty dataset")
    return groups, split


def exact_mcnemar_pvalue(actual, model_predictions, baseline_predictions):
    actual = np.asarray(actual, dtype=int)
    model_correct = (np.asarray(model_predictions) >= 0.5).astype(int) == actual
    baseline_correct = (np.asarray(baseline_predictions) >= 0.5).astype(int) == actual
    model_only = int(np.count_nonzero(model_correct & ~baseline_correct))
    baseline_only = int(np.count_nonzero(~model_correct & baseline_correct))
    discordant = model_only + baseline_only
    if discordant == 0:
        return 1.0
    from scipy.stats import binomtest
    return float(binomtest(min(model_only, baseline_only), discordant, 0.5).pvalue)


def train_and_save_model():
    client = MongoClient(os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/"), serverSelectionTimeoutMS=5000)
    try:
        database = client[os.getenv("MONGO_DB", "SmartKitchenDB")]
        impressions = list(database.recommendation_impressions.find({"data_source": "synthetic"}))
        recipe_ids = {
            int(row["recipe_id"])
            for impression in impressions for row in impression.get("recommendations", [])
            if str(row.get("recipe_id", "")).isdigit() and row.get("outcome") in {"cooked", "skipped"}
        }
        recipes = {recipe["id"]: recipe for recipe in database.recipes.find({"id": {"$in": list(recipe_ids)}}) if "id" in recipe}
    finally:
        client.close()

    frame = build_impression_training_frame(impressions, recipes)
    if len(frame) < 50 or frame["target"].nunique() < 2:
        raise ValueError("At least 50 valid examples with positive and negative targets are required")
    frame = frame.replace([np.inf, -np.inf], np.nan).dropna(subset=FEATURE_NAMES + ["target", "household_id"])
    groups, household_split = split_training_frame(frame)
    train_frame, validation_frame, test_frame = groups["train"], groups["validation"], groups["test"]

    candidates = []
    for max_depth, min_samples_leaf in ((8, 5), (16, 5), (None, 10)):
        candidate = RandomForestRegressor(n_estimators=200, max_depth=max_depth, min_samples_leaf=min_samples_leaf, random_state=42, n_jobs=-1)
        candidate.fit(train_frame[FEATURE_NAMES], train_frame["target"])
        validation_predictions = candidate.predict(validation_frame[FEATURE_NAMES])
        candidates.append((mean_absolute_error(validation_frame["target"], validation_predictions), max_depth, min_samples_leaf))
    _, best_depth, best_leaf = min(candidates, key=lambda row: row[0])
    development_frame = pd.concat([train_frame, validation_frame], ignore_index=True)
    model = RandomForestRegressor(n_estimators=300, max_depth=best_depth, min_samples_leaf=best_leaf, random_state=42, n_jobs=-1)
    model.fit(development_frame[FEATURE_NAMES], development_frame["target"])
    baseline = LogisticRegression(max_iter=1000, random_state=42)
    baseline.fit(development_frame[BASELINE_FEATURE_NAMES], development_frame["selected"])
    model_predictions = model.predict(test_frame[FEATURE_NAMES])
    baseline_predictions = baseline.predict_proba(test_frame[BASELINE_FEATURE_NAMES])[:, 1]
    model_metrics = evaluate_predictions(test_frame, model_predictions)
    baseline_metrics = evaluate_predictions(test_frame, baseline_predictions)
    promotion = assess_promotion(model_metrics, baseline_metrics)
    if not promotion["passed"]:
        raise ValueError(
            "Model failed pointwise promotion gate: "
            f"model={model_metrics}, baseline={baseline_metrics}, promotion={promotion}"
        )
    metrics = {"model": model_metrics, "baseline": baseline_metrics}
    metrics["mcnemar_p_value"] = exact_mcnemar_pvalue((test_frame["target"] > 0).astype(int), model_predictions, baseline_predictions)
    metrics["promotion"] = promotion
    artifact = {
        "model": model,
        "baseline_model": baseline,
        "metadata": {
            "version": MODEL_VERSION,
            "feature_names": FEATURE_NAMES,
            "target_scale": 1.0,
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "training_examples": len(train_frame),
            "validation_examples": len(validation_frame),
            "test_examples": len(test_frame),
            "household_split": {"train": len(household_split.train), "validation": len(household_split.validation), "test": len(household_split.test)},
            "split_protocol": "disjoint households 65/15/20 with chronological ordering inside each group",
            "best_hyperparameters": {"max_depth": best_depth, "min_samples_leaf": best_leaf},
            "baseline": {"type": "LogisticRegression", "feature_names": BASELINE_FEATURE_NAMES},
            "metrics": metrics,
        },
    }
    temporary_path = MODEL_PATH.with_suffix(".pkl.tmp")
    joblib.dump(artifact, temporary_path)
    os.replace(temporary_path, MODEL_PATH)
    print(f"Model v{MODEL_VERSION} saved: {artifact['metadata']}")


if __name__ == "__main__":
    train_and_save_model()
