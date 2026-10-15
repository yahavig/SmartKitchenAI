/** Verifies the recommendation chat waiting state and duplicate-request protection. */
import { Subject } from 'rxjs';

import { DataService } from '../data.service';
import { RecipeSuggestion } from '../recipe-suggestion';
import { RecommendationsComponent } from './recommendations.component';

describe('RecommendationsComponent chat', () => {
  it('keeps the cooked dialog open when inventory deduction fails', async () => {
    const dataService = jasmine.createSpyObj<DataService>('DataService', ['saveAction']);
    dataService.saveAction.and.rejectWith(new Error('inventory update failed'));
    const component = new RecommendationsComponent(dataService);
    component.pendingCookedRecipe = { id: '42', impressionId: 'imp-1' } as RecipeSuggestion;
    component.selectedRating = 5;
    component.showRatingModal = true;

    await component.confirmCooked();

    expect(component.showRatingModal).toBeTrue();
    expect(component.ratingError).toContain('inventory could not be updated');
    expect(component.isSavingCooked).toBeFalse();
  });

  it('shows a waiting state until the AI request finishes', () => {
    const response$ = new Subject<{ reply: string }>();
    const dataService = jasmine.createSpyObj<DataService>('DataService', ['askAIAboutRecipe']);
    dataService.askAIAboutRecipe.and.returnValue(response$);
    const component = new RecommendationsComponent(dataService);
    component.selectedRecipe = { id: '42' } as RecipeSuggestion;
    component.userQuestion = 'Why this recipe?';

    component.sendQuestion();

    expect(component.isWaitingForAI).toBeTrue();
    expect(dataService.askAIAboutRecipe).toHaveBeenCalledTimes(1);

    component.sendQuestion();
    expect(dataService.askAIAboutRecipe).toHaveBeenCalledTimes(1);

    response$.next({ reply: 'It matches your inventory.' });
    response$.complete();

    expect(component.isWaitingForAI).toBeFalse();
    expect(component.chatMessages[component.chatMessages.length - 1]?.text)
      .toBe('It matches your inventory.');
  });

  it('closes an open recipe when Escape is pressed', () => {
    const dataService = jasmine.createSpyObj<DataService>('DataService', ['askAIAboutRecipe']);
    const component = new RecommendationsComponent(dataService);
    component.selectedRecipe = { id: '42' } as RecipeSuggestion;

    component.closeRecipeOnEscape();

    expect(component.selectedRecipe).toBeNull();
  });

  it('builds a shopping list only from ingredients missing from inventory', () => {
    const dataService = jasmine.createSpyObj<DataService>('DataService', ['askAIAboutRecipe']);
    const component = new RecommendationsComponent(dataService);
    component.inventoryProductNames = ['Milk', 'Fresh tomatoes'];
    const recipe = {
      ingredients: ['whole milk', 'tomato', 'Olive oil', 'olive oil']
    } as RecipeSuggestion;

    component.openShoppingCart(recipe);

    expect(component.showShoppingCart).toBeTrue();
    expect(component.missingIngredients).toEqual([{ name: 'Olive oil', checked: false }]);
  });

  it('hides the shopping list when every ingredient exists in inventory', () => {
    const dataService = jasmine.createSpyObj<DataService>('DataService', ['askAIAboutRecipe']);
    const component = new RecommendationsComponent(dataService);
    component.inventoryProductNames = ['Milk', 'Tomatoes'];
    const recipe = { ingredients: ['whole milk', 'tomato'] } as RecipeSuggestion;

    component.openShoppingCart(recipe);

    expect(component.hasMissingIngredients(recipe)).toBeFalse();
    expect(component.showShoppingCart).toBeFalse();
    expect(component.missingIngredients).toEqual([]);
  });
});
