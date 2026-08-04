# AGENTS.md — Flight Tracker

## Core principles (do not violate)

1. **Prioritize existing solutions over reinventing the wheel.** Before writing any code, check for an established library, npm package, or maintained tool that solves the problem. Use it. Hand-roll only when no reasonable existing solution exists.
2. **Focus on the goal, not the details.** Every task serves the v1 goal: a live flight map with clickable plane details. Do not gold-plate, micro-optimize, or expand scope. YAGNI.
3. **Do not get caught up in nitpicking.** Skip cosmetic rewrites, stylistic bikeshedding, and edge-case rabbit holes that don't affect correctness or the user's stated goal. When in doubt, ship the working solution and move on.

## Project context

- **What:** live flight tracker web app — map of aircraft over a user-selected region, click-for-details panel. Free data sources only.
- **Spec (authoritative scope):** `docs/superpowers/specs/2026-08-04-flight-tracker-design.md`
- **Plan (execute task-by-task, in order):** `docs/superpowers/plans/2026-08-04-flight-tracker.md`
- **Stack:** TypeScript monorepo (npm workspaces). Server: Express + vitest. Client: Vite + React + MapLibre GL. Data: OpenSky (live tracking), OurAirports (static airports), OpenFreeMap (map tiles).

## Commands

- Install: `npm install`
- Build airports dataset: `npm run build:airports`
- Tests: `npm test` — or `npm run test -w server` / `npm run test -w client`
- Typecheck server: `npx tsc --noEmit -p server` — client: `npm run build -w client`
- Dev: `npm run dev` (server :3001, client :5173)

## Workflow rules

- Execute the plan task-by-task; commit after each task with a descriptive message.
- TDD for logic-heavy code (proxy, providers, cache): failing test first, then implementation, then green.
- Never commit secrets. `.env` is gitignored — document env vars in README instead.
- API/data-source choices are researched and locked in the spec — do not re-litigate them during implementation.
- **When the user shares an image/screenshot or asks me to view something visually, dispatch the `visual-inspector` subagent to inspect it and report back — never respond "I can't view images" or guess what an image contains.** The visual-inspector runs a vision-capable model and can read local file paths; give it the exact path and what to look for. This applies to screenshots the user attaches, screenshots in `/tmp`, and any request to "look at" the running app.

## Conventions

- TypeScript strict; prefer `import type` for type-only imports.
- No comments in code unless they explain non-obvious behavior (e.g., OpenSky state-vector index mapping, rate-limit handling).
- Client talks only to the proxy at `/api/*` — never to external APIs directly.
- Keep payloads lean: only the trimmed `FlightState` fields (see `server/src/types.ts`).
