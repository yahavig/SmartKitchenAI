/** Coordinates ranked recipes, cooking actions, shopping state, and recipe chat. */
import { Component, HostListener, OnInit } from '@angular/core';
import { DataService } from '../data.service';
import { RecipeSuggestion } from '../recipe-suggestion';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-recommendations',
  templateUrl: './recommendations.component.html',
  styleUrls: ['./recommendations.component.css']
})
export class RecommendationsComponent implements OnInit {

  allRecommendations: RecipeSuggestion[] = [];
  suggestions: RecipeSuggestion[] = [];
  private readonly excludedRecipeIds = new Set<string>();
  selectedRecipe: RecipeSuggestion | null = null;

  chatMessages: { role: 'user' | 'ai'; text: string }[] = [];
  userQuestion: string = '';
  isWaitingForAI = false;

  isLoadingRecipes = false;
  errorMessage = '';

  showShoppingCart = false;
  missingIngredients: { name: string; checked: boolean }[] = [];
  inventoryProductNames: string[] = [];

  showRatingModal = false;
  pendingCookedRecipe: RecipeSuggestion | null = null;
  selectedRating = 0;
  ratingError = '';
  isSavingCooked = false;

  showSkipConfirm = false;
  pendingSkipRecipe: RecipeSuggestion | null = null;

  constructor(private dataService: DataService) {}

  async ngOnInit(): Promise<void> {
    const [, inventory] = await Promise.all([
      this.loadRecommendations(20),
      this.dataService.loadInventory().catch(error => {
        console.error('Failed to load inventory for the shopping list:', error);
        return [];
      })
    ]);
    this.inventoryProductNames = inventory.map(product => product.name);
  }

  async loadRecommendations(k: number = 20): Promise<void> {
    this.isLoadingRecipes = true;
    try {
      this.allRecommendations = (await this.dataService.getRecommendations(k))
        .filter(recipe => !this.excludedRecipeIds.has(recipe.id));
      this.updateDisplay();
    } catch (error) {
      this.errorMessage = "Failed to load recipes.";
      console.error(error);
    } finally {
      this.isLoadingRecipes = false;
    }
  }

  private updateDisplay(): void {
    this.suggestions = this.allRecommendations.slice(0, 5);
  }

  private async finalizeAction(recipe: RecipeSuggestion): Promise<void> {
    this.excludedRecipeIds.add(recipe.id);
    this.allRecommendations = this.allRecommendations.filter(r => r.id !== recipe.id);
    this.updateDisplay();
    if (this.allRecommendations.length < 5) await this.loadRecommendations(20);
  }

  // Recommendation actions
  selectRecipe(recipe: RecipeSuggestion): void { this.selectedRecipe = recipe; }
  closePanel(): void { this.selectedRecipe = null; }

  @HostListener('document:keydown.escape')
  closeRecipeOnEscape(): void {
    if (this.selectedRecipe) this.closePanel();
  }

  async confirmCooked(): Promise<void> {
    if (!this.pendingCookedRecipe || this.isSavingCooked) return;
    if (this.selectedRating < 1 || this.selectedRating > 5) {
      this.ratingError = 'Please select a rating from 1 to 5 stars.';
      return;
    }
    const cookedRecipe = this.pendingCookedRecipe;
    this.isSavingCooked = true;
    this.ratingError = '';
    try {
      await this.dataService.saveAction({ recipe_id: cookedRecipe.id, action: 'cooked', rating: this.selectedRating, impression_id: cookedRecipe.impressionId });
      this.showRatingModal = false;
      this.closePanel();
      await this.finalizeAction(cookedRecipe);
    } catch (error) {
      console.error('Failed to save the cooked recipe or update inventory:', error);
      this.ratingError = 'The inventory could not be updated. Please refresh and try again.';
    } finally {
      this.isSavingCooked = false;
    }
  }

  async confirmSkip(): Promise<void> {
    if (!this.pendingSkipRecipe) return;
    await this.dataService.saveAction({ recipe_id: this.pendingSkipRecipe.id, action: 'skipped', impression_id: this.pendingSkipRecipe.impressionId });
    this.showSkipConfirm = false;
    this.closePanel();
    await this.finalizeAction(this.pendingSkipRecipe);
  }

  // Shopping and chat
  private normalizedTokens(value: string): Set<string> {
    const singularize = (token: string): string => {
      if (token.endsWith('ies') && token.length > 3) return `${token.slice(0, -3)}y`;
      if (token.endsWith('es') && token.length > 3) return token.slice(0, -2);
      if (token.endsWith('s') && token.length > 2 && !token.endsWith('ss')) return token.slice(0, -1);
      return token;
    };
    return new Set(
      String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/[\s-]+/)
        .map(singularize)
        .filter(Boolean)
    );
  }

  private ingredientExistsInInventory(ingredient: string): boolean {
    const ingredientTokens = this.normalizedTokens(ingredient);
    if (!ingredientTokens.size) return false;
    return this.inventoryProductNames.some(productName => {
      const productTokens = this.normalizedTokens(productName);
      if (!productTokens.size) return false;
      const productContainedInIngredient = [...productTokens].every(token => ingredientTokens.has(token));
      const ingredientContainedInProduct = [...ingredientTokens].every(token => productTokens.has(token));
      return productContainedInIngredient || ingredientContainedInProduct;
    });
  }

  getMissingIngredients(recipe: RecipeSuggestion): string[] {
    const unique = new Map<string, string>();
    for (const ingredient of recipe.ingredients || []) {
      const name = String(ingredient || '').trim();
      const key = name.toLowerCase();
      if (name && !this.ingredientExistsInInventory(name) && !unique.has(key)) {
        unique.set(key, name);
      }
    }
    return [...unique.values()];
  }

  hasMissingIngredients(recipe: RecipeSuggestion): boolean {
    return this.getMissingIngredients(recipe).length > 0;
  }

  openShoppingCart(recipe: RecipeSuggestion): void {
    this.missingIngredients = this.getMissingIngredients(recipe).map(name => ({ name, checked: false }));
    this.showShoppingCart = this.missingIngredients.length > 0;
  }
  closeShoppingCart(): void {
    this.showShoppingCart = false;
    this.missingIngredients = [];
  }
  
  sendQuestion(): void {
    if (!this.userQuestion.trim() || !this.selectedRecipe || this.isWaitingForAI) {
      return;
    }

    const question = this.userQuestion.trim();
    this.chatMessages.push({ role: 'user', text: question });
    this.userQuestion = '';
    this.isWaitingForAI = true;

    this.dataService.askAIAboutRecipe(this.selectedRecipe.id, question)
      .pipe(finalize(() => { this.isWaitingForAI = false; }))
      .subscribe({
        next: (res) => {
          this.chatMessages.push({ role: 'ai', text: res.reply });
        },
        error: (err) => {
          console.error('AI chat error:', err);
          this.chatMessages.push({ role: 'ai', text: 'Sorry, I could not answer right now.' });
        }
      });
  }

  onEnter(): void { this.sendQuestion(); }

  // Presentation helpers
  getScoreClass(score: number): string {
    if (score >= 75) return 'score-high';     
    if (score >= 40) return 'score-medium';   
    return 'score-low';                       
  }
  markAsCooked(recipe: RecipeSuggestion): void {
    this.pendingCookedRecipe = recipe;
    this.selectedRating = 0;
    this.ratingError = '';
    this.showRatingModal = true;
  }
  markAsSkipped(recipe: RecipeSuggestion): void { this.pendingSkipRecipe = recipe; this.showSkipConfirm = true; }
  cancelRating(): void {
    this.showRatingModal = false;
    this.pendingCookedRecipe = null;
    this.selectedRating = 0;
    this.ratingError = '';
  }
  cancelSkip(): void { this.showSkipConfirm = false; }
}
