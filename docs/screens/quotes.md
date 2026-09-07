# Quotes screen action map

## Visible actions

- Create a quotation.
- Search quotations by client, organization, or quotation number.
- Preview/send, edit, convert to an order, or delete a quotation.
- Select or remove active catalog items while creating or editing a quotation.

## Forms and dialogs

- `QuoteFormDialog` collects client/contact details, event date, site, participant count, catalog selections, discount, status, and notes.
- Catalog selections persist as self-contained snapshots in `quotes.selected_activities` so later catalog edits do not rewrite historical quotation content.

## Data loaded

- `quotes`: quotation list and saved quotation snapshots.
- `activities`: active legacy activity catalog entries.
- `products`: active Product Management catalog entries.
- There is no client cache layer; the quotation catalog is refreshed from Supabase whenever the form opens.

## Data written

- Create/update/delete targets `quotes` only from this screen.
- Activity-only conversion creates an `orders` row and updates the source quotation.
- Product-bearing quotations are blocked from the legacy one-activity order conversion so product lines cannot be silently discarded.
- Product and activity records remain owned by their management screens.

## Cross-screen synchronization

- Active products created or edited in Product Management appear the next time the quotation form opens.
- Deactivated or deleted products are unavailable for new selection after the next form open.
- Already-saved quotation snapshots remain intact if a source product/activity is edited, deactivated, or deleted.

## Acceptance criteria

- Existing active activity rows remain selectable.
- Every active Product Management row is selectable.
- Product names, descriptions, prices, images, and sites are read from the current product row when selecting it.
- Inactive/deleted catalog rows are not offered for new selection.
- Reopening, refreshing, or signing in again reloads the same authoritative catalog state.
- Existing quotations and their selected-item snapshots are not migrated or rewritten.
