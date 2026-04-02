# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chatbox Community Edition is a multi-platform AI chat application supporting 30+ LLM providers. It runs as a desktop app (Electron), mobile app (Capacitor/iOS/Android), and web app from a single codebase.

## Common Commands

```bash
# Development
pnpm run dev              # Start Electron dev server with hot-reload
pnpm run dev:web          # Web-only dev mode
pnpm run dev:local        # Dev with USE_LOCAL_API=true

# Build
pnpm run build            # Build without packaging
pnpm run build:web        # Web-only build
pnpm run package          # Build + package for current platform

# Testing
pnpm run test             # Run all tests (Vitest)
pnpm run test:watch       # Watch mode
pnpm run test:coverage    # Coverage report
pnpm run test:integration # Integration tests (300s timeout)

# Code Quality
pnpm run lint             # Biome lint check
pnpm run lint:fix         # Auto-fix linting
pnpm run format           # Biome format
pnpm run check            # TypeScript type check (tsc --noEmit)

# Mobile
pnpm run mobile:sync      # Sync Capacitor (iOS + Android)
pnpm run mobile:ios       # Open iOS project
pnpm run mobile:android   # Open Android project
```

**Linter/Formatter**: Biome (not ESLint/Prettier). Run `pnpm run check:biome` for format checks.

## Architecture

The codebase is structured around Electron's process model:

```
src/
├── main/        # Electron main process
├── preload/     # Electron preload scripts (IPC bridge)
├── renderer/    # React frontend (shared between Electron and web)
└── shared/      # Code shared between main and renderer
```

### Provider System (`src/shared/providers/`)

The core AI provider system uses a registry pattern. Providers are defined declaratively via `defineProvider()` in `src/shared/providers/definitions/` and registered in `src/shared/providers/registry.ts`. Model instances are created via `getModel()` which returns classes implementing `ModelInterface`. To add a new provider, see `docs/adding-new-provider.md`.

### State Management

- **Jotai atoms** (`src/renderer/stores/atoms/`): Fine-grained reactive state
- **Zustand stores** (`src/renderer/stores/`): Feature-level stores (e.g., `chatStore.ts`)
- **electron-store**: Persistent settings, cached in main process

### Chat Flow

Messages go: React component → IPC call (via preload bridge) → main process → provider API → streaming response back to renderer. The `chatStore.ts` owns session state and history.

### Platform Abstraction

`src/renderer/platform/` and `src/renderer/native/` isolate platform-specific code. Capacitor abstracts file system, device, and native APIs for iOS/Android. The web build excludes Electron-only APIs.

### MCP Integration

Model Context Protocol spans both processes: `src/main/mcp/` handles the process-level transport, while `src/renderer/packages/mcp/` manages the renderer-side protocol state.

### Key docs

- `docs/technical/ai-providers.md` — Detailed provider architecture
- `docs/storage.md` — Data storage strategy (LibSQL)
- `docs/testing.md` — Testing guide
- `docs/adding-new-provider.md` — How to add a new AI provider
- `ERROR_HANDLING.md` — Error handling patterns
