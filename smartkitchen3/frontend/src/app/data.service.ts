/** Centralizes API communication and session-scoped application state. */
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Product } from './product';
import { UserPreferences } from './user-preferences';
import { RecipeSuggestion } from './recipe-suggestion';

@Injectable({ providedIn: 'root' })
export class DataService {

  private readonly API_URL = 'http://localhost:5000/api';

  // Session state is cached here so routed components share a single source of truth.
  private inventory: Product[] = [];
  private userPrefs: UserPreferences = new UserPreferences();
  private preferencesLoaded = false;

  private activeHouseholdId: string | null =
    localStorage.getItem('active_household');

  constructor(private http: HttpClient) { }

  private requireHouseholdId(): string {
    if (!this.activeHouseholdId) throw new Error('No household selected');
    return this.activeHouseholdId;
  }

  // Authentication

  async login(email: string, password: string): Promise<any> {
    const res: any = await firstValueFrom(
      this.http.post(`${this.API_URL}/login`, { email, password })
    );
    if (!res?.household_id) throw new Error('Invalid login');


    this.activeHouseholdId = res.household_id;
    localStorage.setItem('active_household', res.household_id);

    if (res.last_name) {
      localStorage.setItem('last_name', res.last_name);
    }

    return res;
  }

  async registerUser(email: string, password: string, last_name: string): Promise<any> {
    const response: any = await firstValueFrom(
      this.http.post(`${this.API_URL}/register`, {
        email,
        password,
        last_name
      })
    );
    if (!response?.household_id) throw new Error('Registration response is missing a household id');
    this.activeHouseholdId = response.household_id;
    localStorage.setItem('active_household', response.household_id);
    localStorage.setItem('last_name', response.last_name || last_name);
    return response;
  }

  logout(): void {
    this.activeHouseholdId = null;
    localStorage.removeItem('active_household');
    localStorage.removeItem('last_name');

    this.inventory = [];
    this.userPrefs = new UserPreferences();
    this.preferencesLoaded = false;
  }

  getActiveHouseholdId(): string | null {
    return this.activeHouseholdId;
  }
  // Inventory

  async loadInventory(): Promise<Product[]> {
    const householdId = this.requireHouseholdId();

    const res = await firstValueFrom(
      this.http.get<any[]>(
        `${this.API_URL}/inventory/${householdId}`
      )
    );

    const safeRes = res ?? [];

    this.inventory = safeRes.map(item => {
      const id = item._id?.$oid || item.id || 'no-id';
      const name = item.product_name || item.name || 'Unknown Product';

      return new Product(
        id,
        name,
        Number(item.quantity_grams ?? 0),
        item.expiry_date,
        item.category ?? 'General'
      );
    });

    return this.inventory;
  }

  getInventory(): Product[] {
    return this.inventory;
  }

  async addProduct(product: Record<string, unknown>): Promise<Product[]> {
    const householdId = this.requireHouseholdId();

    await firstValueFrom(
      this.http.post(`${this.API_URL}/inventory`, {
        ...product,
        household_id: householdId
      })
    );

    return this.loadInventory();
  }

  async deleteProduct(id: string): Promise<Product[]> {
    const householdId = this.requireHouseholdId();

    await firstValueFrom(
      this.http.delete(`${this.API_URL}/inventory/${householdId}/${id}`)
    );
    return this.loadInventory();
  }

  // History and actions

  async getUserHistory(): Promise<any[]> {
    if (!this.activeHouseholdId) return [];

    const res = await firstValueFrom(
      this.http.get<any[]>(`${this.API_URL}/actions/${this.activeHouseholdId}`)
    );
    return res ?? [];
  }

  async saveAction(data: any): Promise<any> {
    const householdId = this.requireHouseholdId();
    const action = data.action || 'cooked';
    const payload: Record<string, unknown> = {
      household_id: householdId,
      recipe_id: Number(data.recipe_id),
      action
    };
    if (data.rating !== undefined && data.rating !== null) {
      payload['rating'] = Number(data.rating);
    }
    if (typeof data.impression_id === 'string' && data.impression_id.trim()) {
      payload['impression_id'] = data.impression_id.trim();
    }
    const shouldConsumeInventory = action === 'cooked' && data.consume_inventory !== false;
    const impressionId = typeof data.impression_id === 'string'
      ? data.impression_id.trim()
      : '';
    if (shouldConsumeInventory && !impressionId) {
      throw new Error('Cannot consume inventory without a recommendation impression id');
    }
    const actionRes = await firstValueFrom(
      this.http.post(`${this.API_URL}/actions`, payload)
    );

    if (shouldConsumeInventory) {
      await firstValueFrom(
        this.http.post(`${this.API_URL}/inventory/consume-recipe`, {
          household_id: householdId,
          recipe_id: Number(data.recipe_id),
          impression_id: impressionId
        })
      );
      await this.loadInventory();
    }

    return actionRes;
  }
  // Recipes

  async getRecipeById(id: number): Promise<any> {
    return firstValueFrom(
      this.http.get(`${this.API_URL}/recipes/${id}`)
    );
  }

  // Recommendations and recipe chat

  async getRecommendations(k: number = 20): Promise<RecipeSuggestion[]> {
    if (!this.activeHouseholdId) return [];

    const data = await firstValueFrom(
      this.http.get<any[]>(
        `${this.API_URL}/recommendations/smart/${this.activeHouseholdId}?k=${k}`
      )
    );

    return (data ?? []).map(item => RecipeSuggestion.fromApi(item));
  }

  askAIAboutRecipe(recipeId: any, message: string) {
    const householdId = this.requireHouseholdId();

    return this.http.post<any>(`${this.API_URL}/chat`, {
      household_id: householdId,
      recipe_id: recipeId,
      message: message
    });
  }

  askAI(message: string, currentPage: string) {
    return this.http.post<{ reply: string }>(`${this.API_URL}/chat`, {
      household_id: this.activeHouseholdId || undefined,
      message,
      current_page: currentPage
    });
  }

  // Household preferences
  async loadPreferences(): Promise<void> {
    const householdId = this.activeHouseholdId || localStorage.getItem('active_household');
    if (!householdId) return;

    try {
      const res: any = await firstValueFrom(
        this.http.get(`${this.API_URL}/preferences/${householdId}`)
      );

      this.userPrefs = res?.preferences
        ? UserPreferences.fromApi(res.preferences)
        : new UserPreferences();
      this.preferencesLoaded = true;
    } catch (err) {
      console.error('Failed to load preferences:', err);
    }
  }

  async savePreferences(prefs: UserPreferences): Promise<void> {
    const householdId = this.activeHouseholdId || localStorage.getItem('active_household');

    if (!householdId) {
      throw new Error('Cannot save preferences without an active household');
    }

    try {
      const res: any = await firstValueFrom(
        this.http.post(`${this.API_URL}/preferences/${householdId}`, prefs)
      );

      if (res?.preferences) {
        this.userPrefs = UserPreferences.fromApi(res.preferences);
        this.preferencesLoaded = true;
      } else {
        throw new Error('The server did not return the saved preferences');
      }
    } catch (error) {
      console.error('Error saving preferences:', error);
      throw error;
    }
  }

  getUserPrefs(): UserPreferences {
    return this.userPrefs;
  }

  hasLoadedPreferences(): boolean {
    return this.preferencesLoaded;
  }
}
