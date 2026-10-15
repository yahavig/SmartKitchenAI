/** Handles new-account input, registration, and initial household navigation. */
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { DataService } from '../data.service';

export interface SignupValidationResult {
  email?: string;
  password?: string;
  lastName?: string;
  confirmPassword?: string;
}

/** Applies the same registration rules enforced by the API. */
export function validateSignup(
  email: string,
  password: string,
  lastName: string,
  confirmPassword: string
): SignupValidationResult {
  const errors: SignupValidationResult = {};
  const normalizedEmail = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    errors.email = 'Enter a valid email address.';
  }
  if (password.length < 8 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    errors.password = 'Use 8–128 characters with uppercase, lowercase, and a number.';
  }
  if (!lastName.trim() || lastName.trim().length > 80) {
    errors.lastName = 'Last name must contain 1–80 characters.';
  }
  if (confirmPassword !== password) {
    errors.confirmPassword = 'Passwords do not match.';
  }
  return errors;
}

@Component({
  selector: 'app-signup',
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.css']
})
export class SignupComponent {

  userData = {
    email: '',
    password: '',
    last_name: '',
    confirmPassword: ''
  };

  errorMessage = '';
  fieldErrors: SignupValidationResult = {};
  isLoading = false;

  constructor(
    private dataService: DataService,
    private router: Router
  ) {}

  async onSignup(): Promise<void> {

    this.errorMessage = '';
    this.fieldErrors = {};

    const email = this.userData.email.trim().toLowerCase();
    const password = this.userData.password;
    const last_name = this.userData.last_name.trim();
    this.fieldErrors = validateSignup(email, password, last_name, this.userData.confirmPassword);
    if (Object.keys(this.fieldErrors).length > 0) {
      this.errorMessage = 'Please correct the highlighted fields.';
      return;
    }

    this.isLoading = true;

    try {
      const response: any = await this.dataService.registerUser(
        email,
        password,
        last_name
      );

      const householdId = response?.household_id;

      if (!householdId) {
        this.errorMessage = 'Server error: missing household id';
        return;
      }

      this.completeSignup(householdId);

    } catch (err: any) {
      console.error('Signup failed:', err);

      this.errorMessage =
        err?.error?.error || 'Signup failed. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private completeSignup(householdId: string): void {

    this.router.navigate(['/settings']);
  }
}
