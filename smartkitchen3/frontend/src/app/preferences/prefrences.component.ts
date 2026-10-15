/** Edits and persists dietary, ingredient, category, and preparation preferences. */
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { DataService } from '../data.service';
import { UserPreferences } from '../user-preferences';

@Component({
  selector: 'app-prefrences',
  templateUrl: './prefrences.component.html',
  styleUrls: ['./prefrences.component.css']
})
export class PrefrencesComponent implements OnInit {

  prefs: UserPreferences = new UserPreferences();
  newIngredient = '';
  saving = false;
  errorMessage = '';

  availableCategories = [
    'mediterranean', 'italian', 'asian', 'mexican',
    'vegan', 'quick', 'main-dish', 'chicken'
  ];

  availableDiets = [
    'kosher', 'vegan', 'vegetarian',
    'gluten-free', 'dairy-free', 'nut-free'
  ];

  constructor(
    private dataService: DataService,
    private router: Router
  ) { }

  async ngOnInit(): Promise<void> {
    // Avoid a duplicate request when another routed component already loaded preferences.
    if (!this.dataService.hasLoadedPreferences()) {
      await this.dataService.loadPreferences();
    }
    
    // Edit a deep-normalized copy so cancellation cannot mutate the service cache.
    const originalPrefs = this.dataService.getUserPrefs();
    this.prefs = UserPreferences.fromApi(originalPrefs);
  }

  // Preference editing
  toggleCategory(cat: string, event: any): void {
    if (event.target.checked) {
      if (!this.prefs.preferred_categories.includes(cat)) {
        this.prefs.preferred_categories.push(cat);
      }
    } else {
      this.prefs.preferred_categories = this.prefs.preferred_categories.filter(c => c !== cat);
    }
  }

  toggleDiet(diet: string, event: any): void {
    if (event.target.checked) {
      if (!this.prefs.dietary_constraints.includes(diet)) {
        this.prefs.dietary_constraints.push(diet);
      }
    } else {
      this.prefs.dietary_constraints = this.prefs.dietary_constraints.filter(d => d !== diet);
    }
  }

  addIngredient(): void {
    const val = this.newIngredient.trim().toLowerCase();
    if (val && !this.prefs.disliked_ingredients.includes(val)) {
      this.prefs.disliked_ingredients.push(val);
    }
    this.newIngredient = '';
  }

  removeIngredient(ing: string): void {
    this.prefs.disliked_ingredients = this.prefs.disliked_ingredients.filter(i => i !== ing);
  }

  /** Persists the local preference draft and returns to the dashboard. */
  async saveSettings(): Promise<void> {
    this.errorMessage = '';
    const { min, max } = this.prefs.preferred_prep_time_range;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
      this.errorMessage = 'Preparation time must be valid, and maximum time cannot be lower than minimum time.';
      return;
    }
    this.saving = true;
    try {
      await this.dataService.savePreferences(this.prefs);
      
      alert('Settings saved successfully!');
      this.router.navigate(['/home']);
    } catch (err) {
      console.error('Failed to save preferences:', err);
      this.errorMessage = 'Preferences could not be saved. Please try again.';
    } finally {
      this.saving = false;
    }
  }
}
