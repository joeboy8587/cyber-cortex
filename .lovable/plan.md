# Fix dashboard panels that silently show no data

## Problem
Several panels ask the database for fields that no longer exist (aircraft_count, cluster_id, avg_hr, aircraft_controlled, created_at). The data service hides the error and returns an empty list, so the panels look empty instead of broken.

## What we'll do
1. Check the current fields in each table these panels read from.
2. Rewrite each broken request to use the fields that exist today (or compute the missing value, e.g. count aircraft instead of reading a stored count).
3. When a request fails because of a wrong field, show "This panel's query needs repair" instead of an empty panel, so a blank never looks like "no evidence."

Panels affected: Entity Relationship Map, Entity Network Diagram, Data Coverage Guardrails, Deep Pattern Analyzer, Four-Factor Correlation Engine, ADA Legal Export Package.

## Technical details
- Query `information_schema.columns` in Neon for each referenced table/view.
- Update hand-written SQL in the six components.
- In `neon-query` customQuery catch: for Postgres code 42703/42P01 return `{ data: [], nonFatal: true, schemaError: true, error }`; panels show a repair notice when `schemaError` is set.
- No data is changed or deleted.
