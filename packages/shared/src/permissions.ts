export const PERMISSIONS = {
  // Tenant
  TENANT_READ: "tenant.read",
  TENANT_UPDATE: "tenant.update",

  // Branch
  BRANCH_READ: "branch.read",
  BRANCH_MANAGE: "branch.manage",

  // User
  USER_READ: "user.read",
  USER_MANAGE: "user.manage",

  // Role
  ROLE_READ: "role.read",
  ROLE_MANAGE: "role.manage",

  // Audit
  AUDIT_READ: "audit.read",

  // POS & Sales
  SALE_READ: "sale.read",
  SALE_CREATE: "sale.create",
  SALE_VOID: "sale.void",
  SALE_DISCOUNT_OVERRIDE: "sale.discount_override",

  // Inventory & Catalog
  CATALOG_READ: "catalog.read",
  CATALOG_MANAGE: "catalog.manage",
  INVENTORY_READ: "inventory.read",
  INVENTORY_MANAGE: "inventory.manage",
  STOCK_ADJUST: "stock.adjust",

  // Shifts & Registers
  REGISTER_MANAGE: "register.manage",
  SHIFT_MANAGE: "shift.manage",
  SHIFT_OPEN: "shift.open",
  SHIFT_CLOSE: "shift.close",

  // Customers
  CUSTOMER_READ: "customer.read",
  CUSTOMER_MANAGE: "customer.manage",

  // Purchase
  PURCHASE_READ: "purchase.read",
  PURCHASE_MANAGE: "purchase.manage",
  PURCHASE_RECEIVE: "purchase.receive",

  // Reports
  REPORT_SALES: "report.sales",
  REPORT_FINANCIAL: "report.financial",
  REPORT_PROFIT: "report.profit",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const SYSTEM_ROLES = {
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  STORE_KEEPER: "Store Keeper",
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/**
 * Default permission mappings for seeded system roles
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, PermissionKey[]> = {
  [SYSTEM_ROLES.OWNER]: Object.values(PERMISSIONS),
  [SYSTEM_ROLES.MANAGER]: [
    PERMISSIONS.BRANCH_READ,
    PERMISSIONS.USER_READ,
    PERMISSIONS.ROLE_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.SALE_READ,
    PERMISSIONS.SALE_CREATE,
    PERMISSIONS.SALE_VOID,
    PERMISSIONS.SALE_DISCOUNT_OVERRIDE,
    PERMISSIONS.CATALOG_READ,
    PERMISSIONS.CATALOG_MANAGE,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_MANAGE,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.REGISTER_MANAGE,
    PERMISSIONS.SHIFT_MANAGE,
    PERMISSIONS.SHIFT_OPEN,
    PERMISSIONS.SHIFT_CLOSE,
    PERMISSIONS.CUSTOMER_READ,
    PERMISSIONS.CUSTOMER_MANAGE,
    PERMISSIONS.PURCHASE_READ,
    PERMISSIONS.PURCHASE_MANAGE,
    PERMISSIONS.PURCHASE_RECEIVE,
    PERMISSIONS.REPORT_SALES,
    PERMISSIONS.REPORT_PROFIT,
  ],
  [SYSTEM_ROLES.CASHIER]: [
    PERMISSIONS.BRANCH_READ,
    PERMISSIONS.SALE_READ,
    PERMISSIONS.SALE_CREATE,
    PERMISSIONS.CATALOG_READ,
    PERMISSIONS.SHIFT_MANAGE,
    PERMISSIONS.SHIFT_OPEN,
    PERMISSIONS.SHIFT_CLOSE,
    PERMISSIONS.CUSTOMER_READ,
    PERMISSIONS.CUSTOMER_MANAGE,
  ],
  [SYSTEM_ROLES.STORE_KEEPER]: [
    PERMISSIONS.BRANCH_READ,
    PERMISSIONS.CATALOG_READ,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_MANAGE,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.PURCHASE_READ,
    PERMISSIONS.PURCHASE_MANAGE,
    PERMISSIONS.PURCHASE_RECEIVE,
  ],
};

export const DEFAULT_ROLE_MAX_DISCOUNT: Record<SystemRole, number> = {
  [SYSTEM_ROLES.OWNER]: 100,
  [SYSTEM_ROLES.MANAGER]: 50,
  [SYSTEM_ROLES.CASHIER]: 10,
  [SYSTEM_ROLES.STORE_KEEPER]: 0,
};
