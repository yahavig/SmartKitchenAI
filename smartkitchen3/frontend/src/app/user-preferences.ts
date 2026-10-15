/** Models household preferences and normalizes persisted API representations. */
export class UserPreferences {

  constructor(
    public difficulty_preference: 'easy' | 'medium' | 'hard' = 'medium',

    public preferred_prep_time_range: {
      min: number;
      max: number;
    } = { min: 0, max: 60 },

    public dietary_constraints: string[] = [],
    public disliked_ingredients: string[] = [],
    public preferred_categories: string[] = []
  ) {}

  static fromApi(data: any): UserPreferences {

    return new UserPreferences(

      ['easy', 'medium', 'hard'].includes(data?.difficulty_preference)
        ? data.difficulty_preference
        : 'medium',

      UserPreferences.safeRange(data?.preferred_prep_time_range),

      UserPreferences.safeArray(data?.dietary_constraints),
      UserPreferences.safeArray(data?.disliked_ingredients),
      UserPreferences.safeArray(data?.preferred_categories)
    );
  }

  private static safeArray(value: any): string[] {
    let values: unknown[] = [];
    if (Array.isArray(value)) values = value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value.replace(/'/g, '"'));
        values = Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [...new Set(values
      .filter(item => typeof item === 'string')
      .map(item => String(item).trim().toLowerCase())
      .filter(Boolean))];
  }

  private static safeRange(value: any): { min: number; max: number } {
    if (!value) return { min: 0, max: 60 };

    if (typeof value === 'object') {
      const min = Number(value.min ?? 0);
      const max = Number(value.max ?? 60);
      return Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min
        ? { min, max }
        : { min: 0, max: 60 };
    }

    if (typeof value === 'string' && value.includes('-')) {
      const [min, max] = value.split('-').map(Number);
      return Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min
        ? { min, max }
        : { min: 0, max: 60 };
    }

    return { min: 0, max: 60 };
  }
}
