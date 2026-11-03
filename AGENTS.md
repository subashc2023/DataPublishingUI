# AGENTS.md

Guide for anyone (person or coding agent) continuing this project. README.md explains what the app
does and how to feed it; this file records decisions that are easy to undo by accident.

## Verify before calling a change done

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

For UI changes, also run `npm run dev` and look at the result in light and dark mode, at Prod and
Dev, on the 24-hour and 7-day windows, and drilled into one line of business.

## Decisions to keep

- **The import contract is strict on purpose.** `src/data/model.ts` defines it. Map your platform's
  field names and values in the Splunk search (`splunk/flow_events.spl`), not with alias guessing in
  `parse.ts`. Every rejected row is reported with its number and reason; never drop rows silently.
- **Timestamp strings must carry an offset**, and all bucketing is UTC. This keeps a timestamp from
  shifting by the viewer's timezone.
- **Windows end at the newest event in the data**, not the wall clock, so older exports still work.
- **Volume counts successful runs only.** Failed runs count towards `failed`, never towards bytes.
- **The flow diagram is not a flow-conserving Sankey.** Raw data is retained, not consumed, so lanes
  taper. A Sankey library would assert that bytes are conserved, which is wrong here.
- **Environments are separate stacks.** Code is promoted Dev → UAT → Prod and data is not, so
  nothing in the UI may draw data moving between environments.
- **Colour is computed, not chosen by eye.** LOBs take the eight categorical slots in `styles.css`
  in alphabetical order, so a LOB keeps its colour whatever the filter. Past eight they share the
  neutral grey. Text never takes a series colour. A status colour always sits beside an icon and a
  label. If you change the palette, re-check colour-blind separation in both modes.
- **No charting dependency.** The SVG is hand-built and small. Add a library only for something it
  does that this code cannot reasonably do.
- **Sample data is synthetic.** `src/data/sample.ts` invents every dataset name and volume. Never
  commit real exports or internal names to it; `exports/` is git-ignored for real files.

## Where things live

- `src/data/`: contract, parser, aggregations and sample generator. Pure TypeScript, with unit tests
  next to the modules they cover. Keep React out of this folder.
- `src/components/`: one file per view, plus the shared `Tooltip` and `useElementWidth`.
- `src/App.tsx`: filter state and wiring. Every view below the filter row reads the same scoped rows,
  so the numbers always agree.
