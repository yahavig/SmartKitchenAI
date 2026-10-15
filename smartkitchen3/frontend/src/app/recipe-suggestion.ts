/** Models a recipe recommendation and normalizes untrusted API payloads. */
export class RecipeSuggestion {
  constructor(
    public id: string,
    public name: string,
    public score: number,
    public ingredients: string[],
    public explanation: string,
    public steps: string[] = [],
    public minutes: number = 0,
    public nSteps: number = 0,
    public description: string = '',
    public isUrgent: boolean = false,
    public impressionId: string = ''
  ) {}

  static fromApi(data: any): RecipeSuggestion {
    const safeArray = (v: any): string[] => {
      if (Array.isArray(v)) return v.map(String);
      if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
      return [];
    };

    let scoreNum = Number(data?.score);
    if (isNaN(scoreNum)) scoreNum = 0;

    return new RecipeSuggestion(
      String(data?.id ?? data?._id ?? ''),
      String(data?.name ?? 'Unknown recipe'),
      scoreNum,
      safeArray(data?.ingredients),
      String(data?.explanation ?? 'Recommended for you'),
      safeArray(data?.steps),
      Number(data?.minutes ?? 0),
      Number(data?.n_steps ?? data?.nSteps ?? 0),
      String(data?.description ?? ''),
      Boolean(data?.contains_urgent ?? data?.is_urgent ?? false),
      String(data?.impression_id ?? '')
    );
  }
}
