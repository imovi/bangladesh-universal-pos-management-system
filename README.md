# Bangladesh Universal POS Management System

Universal, multi-tenant, offline-first Point-of-Sale (POS) and inventory platform engineered for Bangladeshi businesses (Fashion, Retail, Chemical, E-commerce, Pharmacy, and Electronics).

## Architecture Highlights

- **Single Core Engine, Multi-Tenant Modular Architecture**: Shared PostgreSQL database with Row Level Security (RLS) enforcement per tenant.
- **Offline-First Resilience**: Local client storage with UUID v7 and idempotency-guaranteed outbox synchronization.
- **Strict Accounting & Money Handling**: Represented in integer minor units (Poisha / Cents) to completely avoid floating-point inaccuracies.
- **Auditability**: Tamper-proof, append-only audit trail and append-only stock movement ledger.
- **Local Context**: First-class support for bKash, Nagad, Bangla invoice layouts, NBR VAT compliance, and local delivery couriers.

## Monorepo Layout

```
├── apps/
│   ├── api/                 # NestJS 12 backend REST API & Prisma RLS
│   ├── admin/               # (Phase 1) React / Next.js Admin Portal
│   └── pos/                 # (Phase 1) Offline-first PWA / Tauri Counter App
├── packages/
│   └── shared/              # Shared Zod schemas, permissions, DTOs & types
├── docs/                    # Architecture diagrams and API contract specs
├── docker-compose.yml       # PostgreSQL 17 & Redis 7 services
└── .github/workflows/ci.yml # Automated linting, RLS isolation & coverage testing
```

## Quick Start

1. **Clone repository:**

   ```bash
   git clone https://github.com/imovi/bangladesh-universal-pos-management-system.git
   cd bangladesh-universal-pos-management-system
   ```

2. **Start Services:**

   ```bash
   docker compose up -d
   ```

3. **Install Dependencies & Build:**

   ```bash
   npm install
   npm run build
   ```

4. **Run Migrations & Tests:**
   ```bash
   npm test
   ```
