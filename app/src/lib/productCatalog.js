export const CAFETERIA_CATEGORIES = ["שתייה", "דלפק", "גלידות", "מזון", "מוצרי טיפוס"];

export function filterProducts(products, { cafeteria = false, search = "", category = "all" } = {}) {
  const query = search.trim().toLocaleLowerCase('he');
  return products.filter((product) =>
    Boolean(product.cafeteria_category) === cafeteria &&
    (!cafeteria || category === 'all' || product.cafeteria_category === category) &&
    (!query || product.name?.toLocaleLowerCase('he').includes(query))
  );
}
