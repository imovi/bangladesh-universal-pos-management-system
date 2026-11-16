import { CartItem, CartLineDiscount } from "./cart-calculations";

export interface StoredCart {
  saleId: string;
  items: CartItem[];
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  billDiscount?: CartLineDiscount;
  notes?: string;
  updatedAt: string;
}

export interface HeldCart extends StoredCart {
  id: string;
  label: string;
  heldAt: string;
}

export const POS_STORAGE_KEYS = {
  ACTIVE_CART: (registerId: string) => `pos_cart_${registerId}`,
  HELD_CARTS: (registerId: string) => `pos_held_carts_${registerId}`,
  SELECTED_REGISTER: (branchId: string) => `pos_reg_${branchId}`,
  PRINTER_SIZE: "pos_printer_size",
};

export function loadActiveCart(registerId: string): StoredCart | null {
  if (typeof window === "undefined" || !registerId) return null;
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEYS.ACTIVE_CART(registerId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveActiveCart(registerId: string, cart: StoredCart): void {
  if (typeof window === "undefined" || !registerId) return;
  try {
    localStorage.setItem(POS_STORAGE_KEYS.ACTIVE_CART(registerId), JSON.stringify(cart));
  } catch (e) {
    console.error("Failed to save active cart to localStorage", e);
  }
}

export function clearActiveCart(registerId: string): void {
  if (typeof window === "undefined" || !registerId) return;
  try {
    localStorage.removeItem(POS_STORAGE_KEYS.ACTIVE_CART(registerId));
  } catch (e) {
    console.error("Failed to clear active cart from localStorage", e);
  }
}

export function loadHeldCarts(registerId: string): HeldCart[] {
  if (typeof window === "undefined" || !registerId) return [];
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEYS.HELD_CARTS(registerId));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveHeldCart(registerId: string, held: HeldCart): boolean {
  if (typeof window === "undefined" || !registerId) return false;
  try {
    const current = loadHeldCarts(registerId);
    if (current.length >= 10) {
      return false; // Max 10 reached
    }
    const updated = [held, ...current.filter((c) => c.id !== held.id)];
    localStorage.setItem(POS_STORAGE_KEYS.HELD_CARTS(registerId), JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}

export function removeHeldCart(registerId: string, heldCartId: string): void {
  if (typeof window === "undefined" || !registerId) return;
  try {
    const current = loadHeldCarts(registerId);
    const updated = current.filter((c) => c.id !== heldCartId);
    localStorage.setItem(POS_STORAGE_KEYS.HELD_CARTS(registerId), JSON.stringify(updated));
  } catch {}
}

export function getSavedRegisterId(branchId: string): string | null {
  if (typeof window === "undefined" || !branchId) return null;
  return localStorage.getItem(POS_STORAGE_KEYS.SELECTED_REGISTER(branchId));
}

export function setSavedRegisterId(branchId: string, registerId: string): void {
  if (typeof window === "undefined" || !branchId) return;
  localStorage.setItem(POS_STORAGE_KEYS.SELECTED_REGISTER(branchId), registerId);
}

export type PrinterPaperSize = "80mm" | "58mm" | "a4";

export function getPrinterPaperSize(): PrinterPaperSize {
  if (typeof window === "undefined") return "80mm";
  const saved = localStorage.getItem(POS_STORAGE_KEYS.PRINTER_SIZE);
  if (saved === "58mm" || saved === "a4") return saved;
  return "80mm";
}

export function setPrinterPaperSize(size: PrinterPaperSize): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(POS_STORAGE_KEYS.PRINTER_SIZE, size);
}
