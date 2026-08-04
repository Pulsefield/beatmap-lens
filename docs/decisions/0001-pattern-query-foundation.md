# Pattern query foundation

- Status: Accepted
- Date: 2026-08-04

## Context

Parsing and normalizing `osu!mania` charts is Beatmap Lens's foundation, but the product value is
semantic pattern query. Mappers need both familiar named patterns and searches based on a selected
example. The same query must remain explainable in authored timing terms without replacing the
source millisecond timestamps.

## Decision

Beatmap Lens supports two independent query sources:

- a first-party pattern catalog for named, semantic patterns;
- query-by-example for finding occurrences similar to a selected pattern.

Every query chooses one of two match modes:

- `exact`, meaning exact under the transformations explicitly declared by the query;
- `fuzzy`, meaning ranked deviations under the same transformation semantics.

`exact` and `fuzzy` are not separate pattern systems. Catalog queries and example queries compile
to the same matching semantics and return the same explainable match shape.

Charts expose exactly two time views for pattern work:

- the source millisecond timeline, which remains the canonical fact and rendering/audio coordinate;
- red-line rhythm sections, each with a section-local beat projection anchored at its red line.

There is no public global-beat or normalized-time third view. A matcher may derive temporary
features such as interval ratios while ranking candidates, but those features do not become chart
coordinates or overwrite either time view.

Geometric transformation semantics are a first-class part of each query. A later accepted decision
will define their exact contract before implementation; neither catalog names nor fuzzy scoring may
silently broaden that contract.

## Consequences

The public model has four meaningful query combinations: catalog-exact, catalog-fuzzy,
example-exact, and example-fuzzy. Pattern identity is defined independently from search speed and
rendering. Indexes may narrow candidates but must not redefine an exact match, and renderers consume
match evidence rather than running pattern detection themselves.

Green-line slider velocity remains scroll/readability context on the millisecond timeline. It does
not create rhythm sections or alter section-local beats.

## Non-goals

This decision does not introduce a string query language, a public pattern-definition DSL, an
audio-derived beat grid, opaque embedding similarity, persistent corpus storage, or eager rendering
of search results.
