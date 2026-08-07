# Desktop Pet Store Fixed Filters

## Goal

Keep the search and filter area in the desktop pet store fixed while the store results scroll independently below it.

## Design

Keep the settings section as a flex column with a bounded content area. The store view renders the filter area as a `shrink-0` sibling above a separate `min-h-0 flex-1 overflow-y-auto` results area. The results area owns scrolling for product cards, loading state, empty state, errors, and pagination.

The installed-pets view keeps its existing single scroll area. The store filter area is explicitly `select-none`, while the search input remains `select-text`. Search, filter, loading, error, empty, and pagination behavior is unchanged.

## Verification

- Pass the desktop renderer TypeScript check.
- Confirm the fixed filter and independent result scroll containers are separate in the component hierarchy.
