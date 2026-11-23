# Performance and Load Test Report

This document records performance benchmark baselines and load check results for the Universal POS system.

> [!NOTE]
> Performance numbers originally measured during development at commit `c44190f` were run locally on a developer workstation (11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz, 8 cores / 16 threads, 16GB RAM) running PostgreSQL and NestJS directly, and do not represent production server performance.
> Automated CI performance is verified on standard GitHub-hosted runners (2 vCPU, 7GB RAM) via `scripts/load-check.mjs`.

## Performance Benchmarks: Developer Workstation vs CI Runner

| Scenario | Target | Developer Machine (i7-11800H, 16GB) | CI Runner (2 vCPU, 7GB) |
|---|---|---|---|
| **Scenario 1: Sale Load** (10 registers, 1 sale/3s for 2 min) | p95 < 400ms, 0 errors, exact stock | p50: 16ms, p95: 26ms, p99: 42ms, 0 errors | Measured in CI (`load-check` job) |
| **Scenario 2: Sync Burst** (300 queued offline sales) | < 120s, exactly-once, 0 deadlocks | 7.4s (40.5 req/s), 0 errors, 300/300 verified | Measured in CI (`load-check` job) |
| **Scenario 3: 30-Day Sales Report** (50,000 historical sales) | < 2,000ms | 340ms (50,000 sales aggregated) | Measured in CI (`load-check` job) |

## Execution Protocol

The load check is executed unattended via:
```bash
API_URL=http://localhost:4000/api/v1 DATABASE_URL="postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_e2e?schema=public" node scripts/load-check.mjs
```

Each scenario produces a machine-verifiable JSON summary line with `p50Ms`, `p95Ms`, `p99Ms`, `maxMs`, `throughput`, and `budgetMet: true/false`. If any scenario fails to meet its target budget, the script exits with code 1.
