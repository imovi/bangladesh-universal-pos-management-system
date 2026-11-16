# Universal POS Admin Dashboard & Counter Selling Application (`@universal-pos/admin`)

This application is the central operations hub and counter point-of-sale interface for the Bangladesh Universal POS & Retail Management System. Built with **Next.js 15 (App Router)**, **React 19**, **Tailwind CSS**, and **shadcn/ui**.

---

## 1. Directory Structure

```
apps/admin/
├── e2e/                           # Playwright end-to-end test suites
│   ├── app-shell-routes.spec.ts   # Route structure & shared layout tests
│   ├── auth-flow.spec.ts          # Authentication, session, and role guard tests
│   ├── capture-design-v2-screenshots.spec.ts # Automated screenshot capture
│   ├── inventory-flow.spec.ts     # Stock levels, opening grid, adjustments
│   ├── pos-flow.spec.ts           # Counter POS selling, shift lifecycle, split payments
│   ├── products-flow.spec.ts      # Product catalog, multi-attribute variants, matrix
│   ├── purchasing-flow.spec.ts    # Supplier management, purchase orders, receipts
│   ├── reports-flow.spec.ts       # Analytics, sales report tabs, P&L, stock valuation
│   ├── sales-flow.spec.ts         # Sales history, receipt search, void with audit reason
│   ├── settings-flow.spec.ts      # Shop policies, branches, role caps, users, audit logs
│   └── smoke.spec.ts              # Basic availability smoke test
├── public/                        # Static assets (favicons, logos)
├── src/
│   ├── app/                       # Next.js App Router hierarchy
│   │   ├── (admin)/               # Admin management route group (AppShell layout)
│   │   │   ├── layout.tsx         # Shared header, navigation sidebar, language/theme bar
│   │   │   ├── dashboard/         # Executive dashboard & sales metrics
│   │   │   ├── catalog/           # Products, category hierarchy, variants
│   │   │   ├── inventory/         # Stock list, opening balances, adjustments, low stock
│   │   │   ├── purchasing/        # Suppliers, purchase orders, goods receipts
│   │   │   ├── sales/             # Sales receipts, returns, customer list
│   │   │   ├── reports/           # Sales summaries, profit/loss, stock valuation
│   │   │   ├── settings/          # Shop policies, branches, roles, staff, audit logs
│   │   │   ├── customers/         # Customer database and purchase histories
│   │   │   ├── registers/         # Register stations and status
│   │   │   └── shifts/            # Shift summaries, cash drawers, discrepancy audits
│   │   ├── api/                   # Next.js BFF proxy routes (auth cookies, refresh tokens)
│   │   ├── pos/                   # Dedicated full-screen Selling Screen (`/pos`)
│   │   │   └── page.tsx           # Cashier selling console, barcode scanning, split payment
│   │   ├── login/                 # Staff & owner login page
│   │   ├── signup/                # Tenant self-service registration
│   │   ├── globals.css            # Tailwind theme tokens and fonts
│   │   └── layout.tsx             # Root layout with ThemeProvider, AuthProvider, I18nProvider
│   ├── components/                # Reusable UI component library
│   │   ├── common/                # Shared utilities (PermissionGate, DateRangePicker, Pagination)
│   │   ├── layout/                # Sidebar, Header, MobileDrawer
│   │   ├── pos/                   # POS sub-components (ReceiptView, PaymentDialog, CustomerDialog)
│   │   └── ui/                    # shadcn/ui primitives (Button, Dialog, Select, Card, etc.)
│   ├── hooks/                     # Custom React hooks (useHotkeys, useMediaQuery)
│   ├── i18n/                      # Bilingual internationalization engine
│   │   ├── bn.ts                  # Bengali language definitions (default)
│   │   ├── en.ts                  # English language definitions
│   │   └── context.tsx            # React I18n context provider & hook
│   └── lib/                       # Helpers & Utilities
│       ├── api.ts                 # API client utilities
│       ├── auth-context.tsx       # Auth provider, permission checks, tokens, user state
│       └── utils.ts               # Currency formatting, date formatting, cn helper
└── test/                          # Unit & integration tests (Vitest + React Testing Library)
```

---

## 2. Architecture & Design Principles

### Single Route-Group AppShell
All management routes live under `src/app/(admin)/` and inherit a single unified AppShell layout:
- **Left Sidebar:** Collapsible navigation with active soft-tinted highlight indicators. Role-gated based on cashier/manager/owner permissions.
- **Top Header:** Tenant branding, branch switcher, POS quick link, language toggle (BN / EN), theme switcher (Dark / Light), and user profile card.
- **Content Area:** Responsive container with standard padding, 44/56px row height tables, and tabular monospace numerals.

### Counter POS Mode (`/pos`)
A dedicated high-efficiency, full-screen selling console optimized for 1366×768 touchscreen or keyboard-driven operations:
- **Direct Login Redirection:** Staff with only `sale.create` permission (counter-only cashier) land directly on `/pos` without access to management menus.
- **Hardware Integration:** Barcode scanner listener (`F2`), quick cash additions, 58mm/80mm thermal receipt rendering, and denomination counter on shift close.
- **Idempotent Sales:** Generates client UUID v7 sale IDs in both the body and `Idempotency-Key` header to protect against network retry duplicate billing.

---

## 3. How to Add a New Page

1. **Create the Route File:**
   Add a new folder under `src/app/(admin)/your-section/page.tsx`.
   ```tsx
   "use client";

   import React from "react";
   import { PermissionGate } from "@/components/common/permission-gate";
   import { useTranslation } from "@/i18n/context";
   import { useAuth } from "@/lib/auth-context";

   export default function YourFeaturePage() {
     const { strings } = useTranslation();
     const { apiFetch } = useAuth();

     return (
       <PermissionGate permission="your.permission.read">
         <div className="space-y-6">
           <h1 className="text-2xl font-bold tracking-tight text-foreground">
             Feature Title
           </h1>
           {/* Your content */}
         </div>
       </PermissionGate>
     );
   }
   ```

2. **Add to Navigation:**
   Update `src/components/layout/sidebar.tsx` with your route path, bilingual label key, Lucide icon, and required permission.

3. **Secure the Route:**
   Wrap the page component in `<PermissionGate permission="...">`. Restricted users will automatically receive a friendly "Access Denied" message with instructions.

---

## 4. How to Add a Translation

1. Open `src/i18n/en.ts` and add your keys under the appropriate category.
2. Open `src/i18n/bn.ts` and add the matching Bengali translations.
3. Keep exact 1:1 key parity between both files. The unit test `test/i18n.spec.ts` verifies 100% key and shape parity on every run.
4. Consume translations in components using the `useTranslation()` hook:
   ```tsx
   const { strings, locale } = useTranslation();
   return <button>{strings.common.save}</button>;
   ```

---

## 5. Running Tests & Quality Checks

### Unit & Integration Tests (Vitest)
```bash
npm --workspace=@universal-pos/admin test
```

### Static Analysis & Linting (Oxlint)
```bash
npm --workspace=@universal-pos/admin run lint
```

### Production Build
```bash
npm --workspace=@universal-pos/admin run build
```

### End-to-End Tests (Playwright)
Ensure the API server is running on port 4000 and pointing to the isolated E2E database (`universal_pos_e2e`), then run:
```bash
npm --workspace=@universal-pos/admin exec -- playwright test --project=chromium
```

### Database Isolation Guard
E2E tests must **never** execute against the development database (`universal_pos`). Always execute against `universal_pos_e2e` using:
```bash
npm run db:reset:e2e
```
