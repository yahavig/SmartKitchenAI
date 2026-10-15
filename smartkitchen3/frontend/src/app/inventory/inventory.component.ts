/** Manages inventory display and user-initiated product additions and deletions. */
import { Component, OnInit } from '@angular/core';
import { DataService } from '../data.service';
import { Product } from '../product';
import { isValidDateInput } from '../date-utils';

const STATUS_PRIORITY: Readonly<Record<string, number>> = {
  Warning: 0,
  Safe: 1,
  Expired: 2,
  Unknown: 3
};

export type InventorySortOption = 'status' | 'quantity-desc' | 'quantity-asc';

/** Returns a stable, non-mutating inventory ordering for the selected display criterion. */
export function sortInventory(products: readonly Product[], option: InventorySortOption): Product[] {
  if (option === 'status') return sortInventoryByStatus(products);

  return products
    .map((product, originalIndex) => ({ product, originalIndex }))
    .sort((left, right) => {
      let difference = 0;
      const direction = option === 'quantity-desc' ? -1 : 1;
      difference = (left.product.quantity_grams - right.product.quantity_grams) * direction;
      return difference !== 0 ? difference : left.originalIndex - right.originalIndex;
    })
    .map(({ product }) => product);
}

/** Returns a non-mutating FEFO ordering grouped by inventory status priority. */
export function sortInventoryByStatus(products: readonly Product[]): Product[] {
  return products
    .map((product, originalIndex) => ({ product, originalIndex }))
    .sort((left, right) => {
      const statusDifference =
        (STATUS_PRIORITY[left.product.getUrgencyStatus()] ?? Number.MAX_SAFE_INTEGER) -
        (STATUS_PRIORITY[right.product.getUrgencyStatus()] ?? Number.MAX_SAFE_INTEGER);
      if (statusDifference !== 0) return statusDifference;

      const expiryDifference = left.product.getExpiryTimestamp() - right.product.getExpiryTimestamp();
      return expiryDifference !== 0 ? expiryDifference : left.originalIndex - right.originalIndex;
    })
    .map(({ product }) => product);
}

export interface InventorySections {
  active: Product[];
  expired: Product[];
}

/** Separates expired products from the active inventory while preserving status ordering. */
export function partitionInventoryByExpiry(
  products: readonly Product[],
  option: InventorySortOption = 'status'
): InventorySections {
  const sorted = sortInventory(products, option);
  return {
    active: sorted.filter(product => product.getUrgencyStatus() !== 'Expired'),
    expired: sorted.filter(product => product.getUrgencyStatus() === 'Expired')
  };
}

@Component({
  selector: 'app-inventory',
  templateUrl: './inventory.component.html',
  styleUrls: ['./inventory.component.css']
})
export class InventoryComponent implements OnInit {

  inventory: Product[] = [];
  inventorySections: InventorySections = { active: [], expired: [] };
  sortOption: InventorySortOption = 'status';

  newProductName = '';
  newProductWeight = 0;
  newProductExpiry = '';
  newProductCategory = 'General'; 
  formError = '';

  constructor(private dataService: DataService) {}

  async ngOnInit(): Promise<void> {
    await this.refreshInventory();
  }

  private async refreshInventory(): Promise<void> {
    try {
      this.setInventory(await this.dataService.loadInventory());
    } catch (error) {
      console.error('Failed to load inventory:', error);
    }
  }

  /** Validates the form and delegates canonical persistence to the data service. */
  async addProduct(): Promise<void> {
    this.formError = '';
    if (!this.newProductName.trim()) {
      this.formError = 'Product name is required.';
      return;
    }
    if (!Number.isFinite(this.newProductWeight) || this.newProductWeight <= 0) {
      this.formError = 'Weight must be greater than zero.';
      return;
    }
    if (!isValidDateInput(this.newProductExpiry)) {
      this.formError = 'A valid expiry date is required.';
      return;
    }

  const productData = {
    product_name: this.newProductName.trim(),
    quantity_grams: Number(this.newProductWeight),
    expiry_date: new Date(this.newProductExpiry).toISOString(), 
    category: this.newProductCategory
  };

    try {
      this.setInventory(await this.dataService.addProduct(productData));
      this.resetForm();
    } catch {
      this.formError = 'The product could not be saved. Please verify all fields.';
    }
  }

  /** Deletes an inventory item and adopts the refreshed service result. */
  async deleteProduct(product: Product): Promise<void> {
    if (!product?.id) return;
    this.setInventory(await this.dataService.deleteProduct(product.id));
  }

  private setInventory(products: Product[]): void {
    this.inventory = products;
    this.applySorting();
  }

  /** Reorders both active and expired sections without modifying the source inventory. */
  applySorting(): void {
    this.inventorySections = partitionInventoryByExpiry(this.inventory, this.sortOption);
  }

  private resetForm(): void {
    this.newProductName = '';
    this.newProductWeight = 0;
    this.newProductExpiry = '';
    this.newProductCategory = 'General';
    this.formError = '';
  }
}
