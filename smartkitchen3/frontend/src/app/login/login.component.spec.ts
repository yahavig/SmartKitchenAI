/** Verifies sign-in validation while preserving compatibility with existing accounts. */
import { validateLogin } from './login.component';

describe('validateLogin', () => {
  it('accepts valid credentials without applying signup password-strength rules', () => {
    expect(validateLogin('user@example.com', '1234')).toEqual({});
  });

  it('rejects an invalid email and empty password', () => {
    const errors = validateLogin('invalid', '');

    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
  });

  it('preserves spaces as significant password characters', () => {
    expect(validateLogin('user@example.com', ' password ')).toEqual({});
  });
});
