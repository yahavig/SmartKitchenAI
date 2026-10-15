/** Verifies client-side registration validation before API submission. */
import { validateSignup } from './signup.component';

describe('validateSignup', () => {
  it('accepts a valid normalized registration form', () => {
    expect(validateSignup('user@example.com', 'StrongPass1', 'Smith', 'StrongPass1')).toEqual({});
  });

  it('rejects invalid email, weak password, missing name, and mismatched confirmation', () => {
    const errors = validateSignup('invalid', 'weak', ' ', 'different');

    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
    expect(errors.lastName).toBeDefined();
    expect(errors.confirmPassword).toBeDefined();
  });

  it('does not trim password characters before comparing confirmation', () => {
    const errors = validateSignup('user@example.com', ' StrongPass1', 'Smith', 'StrongPass1');

    expect(errors.confirmPassword).toBeDefined();
  });
});
