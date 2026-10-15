"""Provide the report-defined deterministic, leakage-safe household split protocol."""

from dataclasses import dataclass
import random
from typing import Iterable


@dataclass(frozen=True)
class HouseholdSplit:
    train: frozenset[str]
    validation: frozenset[str]
    test: frozenset[str]

    def assert_valid(self) -> None:
        if not self.train or not self.validation or not self.test:
            raise ValueError("train, validation, and test household groups must be non-empty")
        if self.train & self.validation or self.train & self.test or self.validation & self.test:
            raise ValueError("household groups must be mutually exclusive")


def split_households(household_ids: Iterable[object], seed: int = 42) -> HouseholdSplit:
    """Split unique households into deterministic 65%/15%/20% groups."""
    identifiers = sorted({str(value).strip() for value in household_ids if str(value).strip()})
    if len(identifiers) < 5:
        raise ValueError("At least five unique households are required for a 65/15/20 split")
    random.Random(seed).shuffle(identifiers)
    train_end = max(1, int(len(identifiers) * 0.65))
    validation_end = max(train_end + 1, int(len(identifiers) * 0.80))
    validation_end = min(validation_end, len(identifiers) - 1)
    result = HouseholdSplit(
        train=frozenset(identifiers[:train_end]),
        validation=frozenset(identifiers[train_end:validation_end]),
        test=frozenset(identifiers[validation_end:]),
    )
    result.assert_valid()
    return result
