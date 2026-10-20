# calc project instructions

## Stitch design source

When implementing or reviewing the visual design of this project, use the Google Stitch MCP server named `stitch` as the primary design source.

The current calculator redesign project is:

- Stitch project ID: `14138619381293668352`
- Stitch project URL: https://stitch.withgoogle.com/projects/14138619381293668352

Before changing the UI:
1. Read the Stitch project and relevant screens through the `stitch` MCP tools.
2. Treat Stitch as the visual specification for layout, spacing, colors, typography, component shape, and responsive composition.
3. Preserve existing calculator behavior unless the design explicitly requires a presentation change.
4. Do not replace working calculation, history, notes, storage, PWA, sharing, or accessibility behavior with static mockups.
5. Reuse the existing HTML/CSS/JavaScript structure where practical; do not add a large framework only to reproduce the design.
6. Run `npm test` and `npm run check` after implementation.
7. Verify desktop and mobile layouts before considering the design implementation complete.

## Secrets

Never print, commit, write to logs, or place `STITCH_API_KEY` in source files, HTML, JavaScript, README examples, screenshots, issues, or commits. The key must remain in the local environment only.
