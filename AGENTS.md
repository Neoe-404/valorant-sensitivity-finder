# Repository Guidelines

## Project Structure & Module Organization
This is a VALORANT sensitivity finder built with Next.js App Router, React, and TypeScript.

- `app/`: routes for setup, testing, results, and history; shared layout and `globals.css`.
- `components/`: aim arena, interactive test scenes, result charts, and layout UI. `components/tests/` contains application features, not unit tests.
- `hooks/`: pointer lock, mouse tracking, and session orchestration.
- `lib/`: scoring, sensitivity search, statistics, analysis, and browser storage.
- `types/`: shared data models; `tests/`: Vitest unit tests.

Aim visuals are drawn with Canvas; Tailwind design tokens live in `app/globals.css`. Keep generated `.next/` files and dependencies out of changes.

## Build, Test, and Development Commands
- `npm ci`: install dependencies from `package-lock.json`.
- `npm run dev`: start development at `http://localhost:3000`.
- `npm run build`: create the production build; `npm start`: serve it.
- `npm run lint`: run ESLint with Next.js and TypeScript rules.
- `npm run typecheck`: check strict TypeScript without emitting JavaScript.
- `npm test`: run all unit tests; `npm run test:watch`: rerun interactively.

## Coding Style & Naming Conventions
Match existing two-space indentation, double quotes, and semicolons. Use PascalCase component files (`ScoreCard.tsx`), `use`-prefixed hooks (`usePointerLock.ts`), and kebab-case utility modules (`mouse-math.ts`). Prefer shared types and the `@/` alias in application imports. Tests use relative imports. ESLint is configured; no separate formatter is configured.

Keep scoring and search logic independent of UI. Preserve ref-driven Canvas animation to avoid React updates on every frame. Reuse existing Tailwind tokens.

## Testing Guidelines
Vitest runs in Node and discovers `tests/**/*.test.ts`. Use descriptive `describe`/`it` cases, deterministic fixtures, and browser API mocks where needed. Cover changed calculations, boundary inputs, and storage behavior. No coverage threshold is configured.

Before submitting, run tests, lint, typecheck, and build. For interaction changes, manually check pointer lock, Escape/pause/resume, and the setup-to-results flow on desktop; `/test?debug=true` exposes diagnostic data.

## Commit & Pull Request Guidelines
Git history is unavailable in this checkout, so existing commit conventions cannot be verified. Use concise imperative subjects, such as `Fix sensitivity boundary handling`.

PRs should explain the behavior change, link relevant issues, list validation performed, and include screenshots for UI changes. Highlight scoring or storage-format changes explicitly.

## Data & Configuration
Settings and history use localStorage through `lib/storage.ts`; preserve SSR safety and compatibility with saved records. Derive reported performance from actual mouse measurements. Keep secrets out of source; `.env*` files are ignored.
