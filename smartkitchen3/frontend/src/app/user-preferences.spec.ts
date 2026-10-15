/** Verifies normalization of preference values returned by the API. */
import { UserPreferences } from './user-preferences';

describe('UserPreferences', () => {
  it('normalizes, trims, lowercases, and deduplicates string arrays', () => {
    const preferences = UserPreferences.fromApi({
      preferred_categories: ['Italian', ' italian ', 4],
      dietary_constraints: "['Vegan']",
      disliked_ingredients: [' Olives ']
    });

    expect(preferences.preferred_categories).toEqual(['italian']);
    expect(preferences.dietary_constraints).toEqual(['vegan']);
    expect(preferences.disliked_ingredients).toEqual(['olives']);
  });

  it('replaces invalid preparation ranges with safe defaults', () => {
    const preferences = UserPreferences.fromApi({
      preferred_prep_time_range: { min: 90, max: 20 }
    });

    expect(preferences.preferred_prep_time_range).toEqual({ min: 0, max: 60 });
  });
});
