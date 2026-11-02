import { describe, expect, test } from "vitest";
import { CAFETERIA_CATEGORIES, filterProducts } from "./productCatalog";

const products = [
  { id: 1, name: "פעילות טיפוס", cafeteria_category: null },
  { id: 2, name: "קפה קר", cafeteria_category: "שתייה" },
  { id: 3, name: "גלידת וניל", cafeteria_category: "גלידות" },
];

describe('product tabs and search', () => {
  test('preserves uncategorized existing products in general management', () => {
    expect(filterProducts(products).map((p) => p.id)).toEqual([1]);
  });
  test('combines Hebrew name search with cafeteria category', () => {
    expect(filterProducts(products, { cafeteria: true, search: ' קפה ', category: 'שתייה' }).map((p) => p.id)).toEqual([2]);
    expect(filterProducts(products, { cafeteria: true, search: 'קפה', category: 'גלידות' })).toEqual([]);
  });
  test('supports all five explicit cafeteria categories', () => {
    expect(CAFETERIA_CATEGORIES).toEqual(['שתייה', 'דלפק', 'גלידות', 'מזון', 'מוצרי טיפוס']);
  });
});
