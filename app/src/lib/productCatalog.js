export const CAFETERIA_CATEGORIES = ["שתייה", "דלפק", "גלידות", "מזון", "מוצרי טיפוס"];

export function filterProducts(products, { cafeteria = false, search = "", category = "all" } = {}) {
  const query = search.trim().toLocaleLowerCase('he');
  return products.filter((product) =>
    (cafeteria === null || Boolean(product.cafeteria_category) === cafeteria) &&
    (cafeteria === false || category === 'all' || product.cafeteria_category === category) &&
    (!query || product.name?.toLocaleLowerCase('he').includes(query))
  );
}
