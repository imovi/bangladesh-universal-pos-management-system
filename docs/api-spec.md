# Universal POS REST API Specification (Phase 0)

## Global Envelope

All endpoints return standard envelope responses:

### Success (HTTP 200/201)

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": {
    "timestamp": "2026-11-15T15:00:00.000Z",
    "requestId": "0193309a-6b21-7000-8000-000000000001",
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

### Error (HTTP 4xx/5xx)

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Input validation failed",
    "details": [{ "field": "slug", "issue": "Slug already registered" }]
  },
  "meta": {
    "timestamp": "2026-11-15T15:00:00.000Z",
    "requestId": "0193309a-6b21-7000-8000-000000000001"
  }
}
```

## Security & Tenant Isolation Standards

1. **JWT Auth Only:** Tenant context is strictly resolved from the authenticated JWT token payload. Header or parameter overrides are rejected.
2. **PostgreSQL RLS:** All tenant-scoped tables enforce Row Level Security via `tenant_id = current_setting('app.tenant_id')::uuid`.
3. **Session Variables:** Scoped using `SET LOCAL app.tenant_id = '...'` to prevent connection-pool leakage.
4. **Audit Logs:** Append-only with before/after state snapshots. Modification and deletion are disabled at the database level.
