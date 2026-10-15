/** Models an inventory product and derives expiry-related presentation values. */
import { parseDate } from './date-utils';

export type ProductStatus = 'Safe' | 'Warning' | 'Expired' | 'Unknown';

export class Product {

  constructor(
    public id: string,
    public name: string,
    public quantity_grams: number,
    public expiry_date: any,
    public category: string = 'General'
  ) {}

  /** Returns the expiry date formatted for display, or `Unknown` when invalid. */
  getFormattedDate(): string {
    const d = parseDate(this.expiry_date);
    if (!d) return 'Unknown';

    return d.toLocaleDateString('en-GB');
  }

  /** Returns whole days until expiry using FEFO semantics, or `null` when unknown. */
  getDaysToExpiry(): number | null {
    const d = parseDate(this.expiry_date);
    if (!d) return null;

    const diff = d.getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  /** Classifies expiry proximity for inventory status styling. */
  getUrgencyStatus(): ProductStatus {
    const days = this.getDaysToExpiry();

    if (days === null) return 'Unknown';
    if (days < 0) return 'Expired';
    if (days <= 5) return 'Warning';
    return 'Safe';
  }

  /** Returns the semantic CSS class associated with the current expiry status. */
  getStatusClass(): string {
    return `status-${this.getUrgencyStatus().toLowerCase()}`;
  }

  /** Returns a sortable expiry timestamp; invalid dates sort last. */
  getExpiryTimestamp(): number {
    const d = parseDate(this.expiry_date);
    return d ? d.getTime() : Number.MAX_SAFE_INTEGER;
  }
}
