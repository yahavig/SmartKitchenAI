/** Provides the global household-aware AI chat available from every application screen. */
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs/operators';

import { DataService } from '../data.service';

interface AssistantMessage {
  role: 'user' | 'ai';
  text: string;
}

@Component({
  selector: 'app-floating-ai-assistant',
  templateUrl: './floating-ai-assistant.component.html',
  styleUrls: ['./floating-ai-assistant.component.css']
})
export class FloatingAiAssistantComponent {
  isOpen = false;
  isWaiting = false;
  question = '';
  messages: AssistantMessage[] = [];

  constructor(
    private readonly dataService: DataService,
    private readonly router: Router
  ) {}

  toggle(): void {
    this.isOpen = !this.isOpen;
  }

  send(): void {
    const question = this.question.trim();
    if (!question || this.isWaiting) return;

    this.messages.push({ role: 'user', text: question });
    this.question = '';
    this.isWaiting = true;

    try {
      this.dataService.askAI(question, this.router.url)
        .pipe(finalize(() => { this.isWaiting = false; }))
        .subscribe({
          next: response => this.messages.push({ role: 'ai', text: response.reply }),
          error: error => {
            console.error('Global AI chat error:', error);
            const text = error instanceof Error && error.message === 'No household selected'
              ? 'Please log in before using the kitchen assistant.'
              : 'Sorry, I could not answer right now.';
            this.messages.push({ role: 'ai', text });
          }
        });
    } catch (error) {
      this.isWaiting = false;
      const text = error instanceof Error && error.message === 'No household selected'
        ? 'Please log in before using the kitchen assistant.'
        : 'Sorry, I could not answer right now.';
      this.messages.push({ role: 'ai', text });
    }
  }
}
