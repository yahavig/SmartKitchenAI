/** Verifies the global AI assistant request lifecycle and duplicate-submit protection. */
import { Subject } from 'rxjs';

import { DataService } from '../data.service';
import { FloatingAiAssistantComponent } from './floating-ai-assistant.component';
import { Router } from '@angular/router';

describe('FloatingAiAssistantComponent', () => {
  it('keeps the waiting state active until the AI response completes', () => {
    const response$ = new Subject<{ reply: string }>();
    const dataService = jasmine.createSpyObj<DataService>('DataService', ['askAI']);
    const router = jasmine.createSpyObj<Router>('Router', [], { url: '/inventory' });
    dataService.askAI.and.returnValue(response$);
    const component = new FloatingAiAssistantComponent(dataService, router);
    component.question = 'What should I use soon?';

    component.send();

    expect(component.isWaiting).toBeTrue();
    expect(dataService.askAI).toHaveBeenCalledOnceWith('What should I use soon?', '/inventory');

    component.send();
    expect(dataService.askAI).toHaveBeenCalledTimes(1);

    response$.next({ reply: 'Use the milk first.' });
    response$.complete();

    expect(component.isWaiting).toBeFalse();
    expect(component.messages[1].text).toBe('Use the milk first.');
  });

  it('can request public site help from the login page', () => {
    const response$ = new Subject<{ reply: string }>();
    const dataService = jasmine.createSpyObj<DataService>('DataService', ['askAI']);
    const router = jasmine.createSpyObj<Router>('Router', [], { url: '/login' });
    dataService.askAI.and.returnValue(response$);
    const component = new FloatingAiAssistantComponent(dataService, router);
    component.question = 'Can you help?';

    component.send();
    response$.next({ reply: 'Enter your email and password.' });
    response$.complete();

    expect(dataService.askAI).toHaveBeenCalledOnceWith('Can you help?', '/login');
    expect(component.messages[1].text).toContain('email and password');
  });
});
