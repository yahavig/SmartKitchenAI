/** Verifies inventory status priority and deterministic expiry ordering. */
import { Product } from '../product';
import { partitionInventoryByExpiry, sortInventory, sortInventoryByStatus } from './inventory.component';

describe('sortInventoryByStatus', () => {
  const dateFromNow = (days: number): string =>
    new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  it('orders Warning before Safe before Expired', () => {
    const products = [
      new Product('expired', 'Expired', 100, dateFromNow(-2)),
      new Product('safe', 'Safe', 100, dateFromNow(20)),
      new Product('warning', 'Warning', 100, dateFromNow(3))
    ];

    expect(sortInventoryByStatus(products).map(product => product.id))
      .toEqual(['warning', 'safe', 'expired']);
  });

  it('uses the nearest expiry first within the same status without mutating input', () => {
    const later = new Product('later', 'Later', 100, dateFromNow(4));
    const sooner = new Product('sooner', 'Sooner', 100, dateFromNow(1));
    const products = [later, sooner];

    expect(sortInventoryByStatus(products).map(product => product.id))
      .toEqual(['sooner', 'later']);
    expect(products).toEqual([later, sooner]);
  });

  it('separates expired products from active inventory', () => {
    const warning = new Product('warning', 'Warning', 100, dateFromNow(2));
    const expired = new Product('expired', 'Expired', 100, dateFromNow(-2));

    const sections = partitionInventoryByExpiry([expired, warning]);

    expect(sections.active.map(product => product.id)).toEqual(['warning']);
    expect(sections.expired.map(product => product.id)).toEqual(['expired']);
  });

  it('sorts by quantity in both directions', () => {
    const products = [
      new Product('b', 'Banana', 50, dateFromNow(8), 'Fruits'),
      new Product('m', 'Milk', 300, dateFromNow(3), 'Dairy'),
      new Product('a', 'Apple', 100, dateFromNow(5), 'Fruits')
    ];

    expect(sortInventory(products, 'quantity-desc').map(product => product.id)).toEqual(['m', 'a', 'b']);
    expect(sortInventory(products, 'quantity-asc').map(product => product.id)).toEqual(['b', 'a', 'm']);
    expect(products.map(product => product.id)).toEqual(['b', 'm', 'a']);
  });

  it('applies the selected ordering independently inside the expired section', () => {
    const expiredSmall = new Product('small', 'Small', 50, dateFromNow(-1));
    const expiredLarge = new Product('large', 'Large', 300, dateFromNow(-3));

    const sections = partitionInventoryByExpiry([expiredSmall, expiredLarge], 'quantity-desc');

    expect(sections.active).toEqual([]);
    expect(sections.expired.map(product => product.id)).toEqual(['large', 'small']);
  });
});
