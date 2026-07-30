# Pricing Quantity Column Width Design

## Scope

Change only the Quantity column layout in:

- `app/src/components/pricing/PricingCategory.jsx`
- `app/src/components/pricing/PricingRow.jsx`

Do not change quantity state, parsing, calculations, minimum value, events, or any other Pricing column.

## Layout

- Change the Quantity header from `w-24` to `w-32 min-w-[8rem]`.
- Give the matching body cell `w-32 min-w-[8rem]` and reduce its horizontal cell padding from `px-3` to `px-2`.
- Give the native number input `w-full min-w-[7rem] px-2`, `dir="ltr"`, and `tabular-nums`.
- Retain `type="number"` so the browser's native spinner arrows remain present.
- Retain the table's existing `overflow-x-auto` wrapper. On narrow screens the table remains contained and scrollable rather than squeezing the Quantity input or overflowing the page.

## Acceptance criteria

1. Header and body Quantity widths match.
2. The body cell cannot compress below 8rem.
3. The input cannot compress below 7rem.
4. Single- and multi-digit values use the same stable numeric alignment.
5. Native spinner arrows remain enabled and have room beside the value.
6. The existing responsive overflow wrapper contains the wider table on small screens.
7. No quantity behavior changes.
