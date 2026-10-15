/** Presents household cooking history and lazily loads recipe details. */
import { Component, OnInit } from '@angular/core';
import { DataService } from '../data.service';
import { parseDate, toIsoDate } from '../date-utils';

interface PastRecipe {
  id: string;
  recipe_id: number;
  name: string;
  date: string;
  rating: number;
  action: string;
}

interface RecipeDetail {
  id: string;
  name: string;
  description: string;
  ingredients: string[];
  steps: string[];
  minutes: number;
  n_steps: number;
}

@Component({
  selector: 'app-history',
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.css']
})
export class HistoryComponent implements OnInit {

  history: PastRecipe[] = [];
  loading = false;
  error = '';

  selectedRecipeDetail: RecipeDetail | null = null;
  loadingDetail = false;

  constructor(private dataService: DataService) {}

  async ngOnInit(): Promise<void> {
    await this.loadHistory();
  }

  /** Loads and normalizes the active household's action history. */
  async loadHistory(): Promise<void> {
    this.loading = true;
    this.error = '';

    try {
      const data = await this.dataService.getUserHistory();

      this.history = (Array.isArray(data) ? data : []).map((item: any) => ({
        id: String(item.recipe_id ?? ''),
        recipe_id: Number(item.recipe_id ?? 0),
        name: item.name || item.recipe_name || 'Unknown recipe',
        date: toIsoDate(item.action_date || item.timestamp),
        action: item.action || '',
        rating: Number(item.rating ?? 0)
      }));

    } catch (err) {
      this.error = 'Failed to load history';
      this.history = [];
    } finally {
      this.loading = false;
    }
  }

  getDateParts(dateStr: string) {
    if (!dateStr) return { day: '', month: '' };

    const d = parseDate(dateStr);
    if (!d) return { day: '', month: '' };

    return {
      day: d.getDate().toString(),
      month: d.toLocaleString('en-US', { month: 'short' })
    };
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';

    const d = parseDate(dateStr);
    if (!d) return '';

    return d.toLocaleDateString('en-GB');
  }

  /** Loads full recipe details only when the user opens an entry. */
  async openRecipeDetail(recipeId: number, fallbackName: string): Promise<void> {
    this.loadingDetail = true;
    this.selectedRecipeDetail = null;

    try {
      const data: any = await this.dataService.getRecipeById(recipeId);

      this.selectedRecipeDetail = {
        id: String(data?.id ?? recipeId),
        name: data?.name ?? fallbackName ?? 'Unknown recipe',
        description: data?.description ?? '',
        ingredients: Array.isArray(data?.ingredients) ? data.ingredients : [],
        steps: Array.isArray(data?.steps) ? data.steps : [],
        minutes: Number(data?.minutes ?? 0),
        n_steps: Number(data?.n_steps ?? 0)
      };

    } catch {
      this.selectedRecipeDetail = null;
    }

    this.loadingDetail = false;
  }

  closeRecipeDetail(): void {
    this.selectedRecipeDetail = null;
  }

  /** Persists a rating as a typed action while retaining optimistic UI feedback. */
  async setRating(recipe: PastRecipe, rating: number): Promise<void> {
    try {
      recipe.rating = rating;

      await this.dataService.saveAction({
        recipe_id: recipe.recipe_id,
        action: recipe.action || 'cooked',
        rating,
        consume_inventory: false
      });

    } catch (err) {
      console.error('Failed to save rating', err);
    }
  }
}
