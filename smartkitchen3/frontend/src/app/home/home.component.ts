/** Coordinates the household dashboard, inventory summary, and recent activity. */
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { DataService } from '../data.service';
import { Product } from '../product';
import { UserPreferences } from '../user-preferences';
import { toIsoDate } from '../date-utils';

export interface HistoryItem {
  recipe_id: number;
  name: string;
  date: string;
  rating: number;
  action: string;
}

export interface HomeKpis {
  productsInInventory: number;
  itemsExpiringSoon: number;
  availableRecommendations: number;
  cookedRecipes: number;
  skippedRecipes: number;
}

/** Calculates dashboard KPIs from complete household datasets. */
export function calculateHomeKpis(
  inventory: readonly Product[],
  history: readonly HistoryItem[],
  availableRecommendations: number
): HomeKpis {
  return {
    productsInInventory: inventory.length,
    itemsExpiringSoon: inventory.filter(product => {
      const days = product.getDaysToExpiry();
      return days !== null && days >= 0 && days <= 7;
    }).length,
    availableRecommendations: Math.max(0, availableRecommendations),
    cookedRecipes: history.filter(item => ['cooked', 'performed'].includes(item.action.toLowerCase())).length,
    skippedRecipes: history.filter(item => item.action.toLowerCase() === 'skipped').length
  };
}

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
  householdName = '';
  inventory: Product[] = [];
  userPrefs: UserPreferences = new UserPreferences();
  recentHistory: HistoryItem[] = [];
  urgentItems: Product[] = [];
  kpis: HomeKpis = {
    productsInInventory: 0,
    itemsExpiringSoon: 0,
    availableRecommendations: 0,
    cookedRecipes: 0,
    skippedRecipes: 0
  };

  constructor(private dataService: DataService, private router: Router) { }

  async ngOnInit(): Promise<void> {
    const storedName = localStorage.getItem('last_name');
    const activeId = this.dataService.getActiveHouseholdId();
    this.householdName = storedName || activeId || 'Guest';

    const [inventory, data, recommendations] = await Promise.all([
      this.dataService.loadInventory().catch(error => {
        console.error('Failed to load dashboard inventory:', error);
        return [];
      }),
      this.dataService.getUserHistory().catch(error => {
        console.error('Failed to load dashboard history:', error);
        return [];
      }),
      this.dataService.getRecommendations(100).catch(error => {
        console.error('Failed to load dashboard recommendations:', error);
        return [];
      })
    ]);
    this.inventory = inventory;
    this.userPrefs = this.dataService.getUserPrefs();

    const list = Array.isArray(data) ? data : [];

    const normalizedHistory = list
      .map((item: any): HistoryItem => {
        const name = item.recipe_name || item.name || `Recipe #${item.recipe_id || 'Unknown'}`;
        const dateVal = item.action_date || item.timestamp || item.date;

        return {
          recipe_id: Number(item.recipe_id ?? 0),
          name: name,
          date: toIsoDate(dateVal),
          rating: Number(item.rating ?? 0),
          action: item.action || 'cooked'
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    this.recentHistory = normalizedHistory.slice(0, 3);
    this.urgentItems = this.getUrgentItems();
    this.kpis = calculateHomeKpis(inventory, normalizedHistory, recommendations.length);
  }

  goTo(path: string): void {
    this.router.navigate([path]);
  }

  logout(): void {
    this.dataService.logout();
    localStorage.removeItem('last_name');
    this.router.navigate(['/login']);
  }

  getUrgentItems(): Product[] {
    return this.inventory
      .map(item => ({ item, days: item.getDaysToExpiry() }))
      .filter(({ days }) => days !== null && days >= 0 && days <= 7)
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
      .slice(0, 5)
      .map(({ item }) => item);
  }

  getExpiryClass(days: number | null): string {
    if (days === null) return '';
    return days <= 2 ? 'expiry-critical' : 'expiry-warning';
  }
}
