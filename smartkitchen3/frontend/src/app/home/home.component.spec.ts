/** Verifies complete and status-aware KPI aggregation for the household dashboard. */
import { Product } from '../product';
import { calculateHomeKpis, HistoryItem } from './home.component';

describe('calculateHomeKpis', () => {
  it('counts inventory, urgent items, recommendations, cooked, and skipped recipes', () => {
    const dateFromNow = (days: number): string =>
      new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const inventory = [
      new Product('urgent', 'Milk', 100, dateFromNow(2)),
      new Product('safe', 'Rice', 100, dateFromNow(20)),
      new Product('expired', 'Old cheese', 100, dateFromNow(-2))
    ];
    const history: HistoryItem[] = [
      { recipe_id: 1, name: 'Soup', date: '2026-08-20', rating: 5, action: 'cooked' },
      { recipe_id: 2, name: 'Salad', date: '2026-08-19', rating: 0, action: 'skipped' },
      { recipe_id: 3, name: 'Pasta', date: '2026-08-18', rating: 4, action: 'performed' }
    ];

    expect(calculateHomeKpis(inventory, history, 8)).toEqual({
      productsInInventory: 3,
      itemsExpiringSoon: 1,
      availableRecommendations: 8,
      cookedRecipes: 2,
      skippedRecipes: 1
    });
  });
});
