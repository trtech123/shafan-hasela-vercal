-- Prospective, additive classification. Existing products stay unclassified.
ALTER TABLE public.products
  ADD COLUMN cafeteria_category text;

ALTER TABLE public.products
  ADD CONSTRAINT products_cafeteria_category_check
  CHECK (cafeteria_category IS NULL OR cafeteria_category IN
    ('שתייה', 'דלפק', 'גלידות', 'מזון', 'מוצרי טיפוס'));

-- Cashiers may manage cafeteria products only. Admin policies remain unchanged.
CREATE POLICY "products: cashier cafeteria insert"
  ON public.products FOR INSERT
  WITH CHECK (public.is_cashier() AND cafeteria_category IS NOT NULL);

CREATE POLICY "products: cashier cafeteria update"
  ON public.products FOR UPDATE
  USING (public.is_cashier() AND cafeteria_category IS NOT NULL)
  WITH CHECK (public.is_cashier() AND cafeteria_category IS NOT NULL);

CREATE POLICY "products: cashier cafeteria delete"
  ON public.products FOR DELETE
  USING (public.is_cashier() AND cafeteria_category IS NOT NULL);
