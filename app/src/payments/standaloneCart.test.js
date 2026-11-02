import { describe, expect, test } from 'vitest';
import { buildStandaloneCheckout } from './standaloneCart';

const product = { id: 'product-1', kind: 'product', name: 'בקבוק מים', price: 1, status: 'פעיל', vatApplicable: true };
const service = { id: 'service-1', kind: 'service', name: 'פעילות טיפוס', price: 12.5, status: 'פעיל', vatApplicable: true };

describe('standalone hosted cart', () => {
  test('freezes a product and service at catalog prices, including regular VAT', () => {
    expect(buildStandaloneCheckout([{ kind: 'product', id: product.id, qty: 1 }, { kind: 'service', id: service.id, qty: 2 }], [product, service])).toEqual({
      items: [
        { id: product.id, kind: 'product', name: product.name, qty: 1, customPrice: 1, vatApplicable: true },
        { id: service.id, kind: 'service', name: service.name, qty: 2, customPrice: 12.5, vatApplicable: true },
      ],
      amountMinor: 2600,
      currency: 'ILS',
      vatApplicable: true,
    });
  });

  test.each([
    [[{ kind: 'product', id: product.id, qty: 1, customPrice: 0.01 }], [product]],
    [[{ kind: 'product', id: product.id, qty: 1, amount: 0.01 }], [product]],
    [[{ kind: 'product', id: product.id, qty: 1, discount: 0.99 }], [product]],
    [[{ kind: 'product', id: product.id, qty: 0 }], [product]],
    [[{ kind: 'product', id: product.id, qty: 1 }], [{ ...product, status: 'לא פעיל' }]],
    [[{ kind: 'product', id: product.id, qty: 1 }], []],
  ])('rejects browser price/discount, invalid quantity, inactive or missing catalog', (requested, catalog) => {
    expect(() => buildStandaloneCheckout(requested, catalog)).toThrow();
  });
});
