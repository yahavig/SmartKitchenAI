/** Verifies inventory status labels and their semantic CSS classes. */
import { Product } from './product';

describe('Product status', () => {
  function productWithDayOffset(days: number): Product {
    const expiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return new Product('1', 'Milk', 100, expiry.toISOString());
  }

  it('shows safe products in the safe state', () => {
    const product = productWithDayOffset(10);
    expect(product.getUrgencyStatus()).toBe('Safe');
    expect(product.getStatusClass()).toBe('status-safe');
  });

  it('shows products expiring within five days as warning', () => {
    const product = productWithDayOffset(3);
    expect(product.getUrgencyStatus()).toBe('Warning');
    expect(product.getStatusClass()).toBe('status-warning');
  });

  it('shows past expiry dates as expired', () => {
    const product = productWithDayOffset(-2);
    expect(product.getUrgencyStatus()).toBe('Expired');
    expect(product.getStatusClass()).toBe('status-expired');
  });
});
