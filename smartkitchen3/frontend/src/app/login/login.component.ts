/** Handles credential validation, authentication, and login navigation. */
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { DataService } from '../data.service';

export interface LoginValidationResult {
  email?: string;
  password?: string;
}

/** Validates login transport fields without imposing signup rules on existing accounts. */
export function validateLogin(email: string, password: string): LoginValidationResult {
  const errors: LoginValidationResult = {};
  const normalizedEmail = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    errors.email = 'Enter a valid email address.';
  }
  if (!password || password.length > 128) {
    errors.password = 'Enter your password (maximum 128 characters).';
  }
  return errors;
}

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {

  loginData = {
    email: '',
    password: ''
  };

  errorMessage = '';
  fieldErrors: LoginValidationResult = {};
  isLoading = false;
  showPassword = false;

  constructor(
    private dataService: DataService,
    private router: Router
  ) {}

  async onLogin(): Promise<void> {
    if (this.isLoading) return;

    this.errorMessage = '';
    this.fieldErrors = {};

    const email = this.loginData.email.trim().toLowerCase();
    const password = this.loginData.password;
    this.fieldErrors = validateLogin(email, password);
    if (Object.keys(this.fieldErrors).length > 0) {
      this.errorMessage = 'Please correct the highlighted fields.';
      return;
    }

    this.isLoading = true;

    try {
      const loginSuccess = await this.dataService.login(email, password);
      if (loginSuccess) {
        this.router.navigate(['/home']);
      } else {
        this.errorMessage = 'Invalid email or password.';
      }
    } catch (error: any) {
      console.error('Login error:', error);
      if (error?.status === 429) {
        this.errorMessage = 'Too many login attempts. Please wait and try again.';
      } else if (error?.status === 401) {
        this.errorMessage = 'Invalid email or password.';
      } else {
        this.errorMessage = 'Unable to sign in right now. Please try again later.';
      }
    } finally {
      this.isLoading = false;
    }
  }
}
