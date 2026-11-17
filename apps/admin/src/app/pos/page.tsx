"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { v7 as uuidv7 } from "uuid";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { useTheme } from "next-themes";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  computeCartTotals,
  matchBarcodeOrSku,
  CartItem,
  CartLineDiscount,
  PaymentItemInput,
} from "@/lib/pos/cart-calculations";
import type { PosProduct, PosProductVariant } from "@/lib/pos/types";
import { getProductBranchStock } from "@/lib/pos/variant-matrix";
import {
  loadActiveCart,
  saveActiveCart,
  clearActiveCart,
  loadHeldCarts,
  saveHeldCart,
  removeHeldCart,
  getSavedRegisterId,
  setSavedRegisterId,
  HeldCart,
} from "@/lib/pos/pos-storage";
import { playErrorBeep, playSuccessBeep } from "@/lib/pos/audio-beep";
import { PaymentDialog } from "@/components/pos/payment-dialog";
import { ReceiptView, ReceiptData } from "@/components/pos/receipt-view";
import {
  OpenShiftDialog,
  ShiftInUseAlert,
  CashMovementDialog,
  CloseShiftDialog,
} from "@/components/pos/shift-dialogs";
import { CustomerDialog, SelectedCustomer } from "@/components/pos/customer-dialog";
import { VariantPickerModal } from "@/components/pos/variant-picker-modal";
import { HoldCartDialog } from "@/components/pos/hold-cart-dialog";
import { ShiftSalesModal } from "@/components/pos/shift-sales-modal";
import { ReturnModal, ReturnSelectedLine } from "@/components/pos/return-modal";
import {
  Store,
  Search,
  ShoppingCart,
  User,
  PauseCircle,
  Plus,
  Minus,
  Trash2,
  Tag,
  ArrowRightLeft,
  Lock,
  Unlock,
  Receipt,
  WifiOff,
  Sun,
  Moon,
  Keyboard,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  X,
  CreditCard,
  RotateCcw,
} from "lucide-react";

export default function PosPage() {
  const router = useRouter();
  const { user, currentBranch, apiFetch, hasPermission, isLoading: isAuthLoading } = useAuth();
  const { strings, locale, setLocale } = useTranslation();
  const { theme, setTheme } = useTheme();

  // Network & Online state
  const [isOnline, setIsOnline] = useState(true);

  // Tenant / POS Settings
  const [posConfig, setPosConfig] = useState({
    shopName: "Universal POS",
    currency: "BDT",
    timezone: "Asia/Dhaka",
    pricesIncludeTax: false,
    receiptHeader: "",
    receiptFooter: "",
  });

  // Branch & Register state
  const [registers, setRegisters] = useState<any[]>([]);
  const [selectedRegister, setSelectedRegister] = useState<any | null>(null);
  const [activeShift, setActiveShift] = useState<any | null>(null);
  const [shiftInUseOtherUser, setShiftInUseOtherUser] = useState<any | null>(null);
  const [_isLoadingRegister, setIsLoadingRegister] = useState(true);

  // Products & Categories
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [barcodeSearchNotice, setBarcodeSearchNotice] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Cart state
  const [saleId, setSaleId] = useState<string>(() => uuidv7());
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer>({
    name: strings.pos.walkInCustomer,
  });
  const [customerBalance, setCustomerBalance] = useState<{
    currentDueMinor: number;
    creditLimitMinor: number;
    availableCreditMinor: number;
  } | null>(null);

  useEffect(() => {
    if (!selectedCustomer.id) {
      setCustomerBalance(null);
      return;
    }
    let active = true;
    apiFetch(`/customers/${selectedCustomer.id}/balance`)
      .then((r) => r.json())
      .then((data) => {
        if (active && data.success && data.data) {
          setCustomerBalance({
            currentDueMinor: Number(data.data.currentDueMinor || 0),
            creditLimitMinor: Number(data.data.creditLimitMinor || 0),
            availableCreditMinor: Number(data.data.availableCreditMinor || 0),
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedCustomer.id, apiFetch]);

  const [billDiscount, setBillDiscount] = useState<CartLineDiscount | undefined>(undefined);
  const [saleNotes, setSaleNotes] = useState<string>("");
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);

  // Dialogs
  const [isOpenShiftOpen, setIsOpenShiftOpen] = useState(false);
  const [isCashMoveOpen, setIsCashMoveOpen] = useState(false);
  const [isCloseShiftOpen, setIsCloseShiftOpen] = useState(false);
  const [isCustomerOpen, setIsCustomerOpen] = useState(false);
  const [isHoldCartOpen, setIsHoldCartOpen] = useState(false);
  const [isShiftSalesOpen, setIsShiftSalesOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isReturnOpen, setIsReturnOpen] = useState(false);
  const [initialReturnInvoice, setInitialReturnInvoice] = useState<string>("");
  const [exchangeContext, setExchangeContext] = useState<{
    originalSale: any;
    returnItems: ReturnSelectedLine[];
    returnRefundMinor: number;
    reason: string;
    overrideReason?: string;
  } | null>(null);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isCashierMenuOpen, setIsCashierMenuOpen] = useState(false);
  const cashierMenuRef = useRef<HTMLDivElement>(null);
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<PosProduct | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cashierMenuRef.current && !cashierMenuRef.current.contains(e.target as Node)) {
        setIsCashierMenuOpen(false);
      }
    };
    if (isCashierMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCashierMenuOpen]);
  const [activeReceipt, setActiveReceipt] = useState<ReceiptData | null>(null);

  // Line Discount Modal
  const [editingDiscountLineIdx, setEditingDiscountLineIdx] = useState<number | null>(null);
  const [lineDiscountType, setLineDiscountType] = useState<"percent" | "fixed">("percent");
  const [lineDiscountVal, setLineDiscountVal] = useState<string>("");

  // Bill Discount Modal
  const [isBillDiscountOpen, setIsBillDiscountOpen] = useState(false);
  const [billDiscountType, setBillDiscountType] = useState<"percent" | "fixed">("percent");
  const [billDiscountVal, setBillDiscountVal] = useState<string>("");

  // Price Override Modal
  const [editingPriceLineIdx, setEditingPriceLineIdx] = useState<number | null>(null);
  const [overridePriceVal, setOverridePriceVal] = useState<string>("");

  // Submitting states
  const [isCompletingSale, setIsCompletingSale] = useState(false);
  const [isShiftSubmitting, setIsShiftSubmitting] = useState(false);
  const [serverErrorBanner, setServerErrorBanner] = useState<string | null>(null);

  // Cashier Limit (in percent)
  const maxDiscountPercent = user?.maxDiscountPercent ?? (user?.isOwner ? null : 0);
  const maxDiscountBp = maxDiscountPercent !== null ? maxDiscountPercent * 100 : null;

  // Compute Cart Totals
  const cartTotals = computeCartTotals(cartItems, {
    pricesIncludeTax: posConfig.pricesIncludeTax,
    billDiscount,
  });

  const exchangeReturnCreditMinor = exchangeContext?.returnRefundMinor ?? 0;
  const netPayableMinor = exchangeContext
    ? Math.max(0, cartTotals.totalMinor - exchangeReturnCreditMinor)
    : cartTotals.totalMinor;
  const exchangeDifferenceMinor = exchangeContext
    ? cartTotals.totalMinor - exchangeReturnCreditMinor
    : cartTotals.totalMinor;

  // Check discount limit
  const isDiscountLimitExceeded =
    maxDiscountBp !== null && cartTotals.effectiveDiscountBp > maxDiscountBp;

  // Online / Offline listeners
  useEffect(() => {
    setIsOnline(typeof window !== "undefined" ? window.navigator.onLine : true);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Check URL query parameters for returnInvoice
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const retInv = params.get("returnInvoice");
      if (retInv) {
        setInitialReturnInvoice(retInv);
        setIsReturnOpen(true);
      }
    }
  }, []);

  // Load POS Settings
  useEffect(() => {
    if (!user) return;
    apiFetch("/settings/pos")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          const cfg = data.data || data;
          setPosConfig({
            shopName: cfg.shopName || user.tenantName || "Universal POS",
            currency: cfg.currency || "BDT",
            timezone: cfg.timezone || "Asia/Dhaka",
            pricesIncludeTax: Boolean(cfg.pricesIncludeTax),
            receiptHeader: cfg.receiptHeader || "",
            receiptFooter: cfg.receiptFooter || "",
          });
        }
      })
      .catch(() => {});
  }, [user, apiFetch]);

  // Load Registers for current branch
  const loadRegisters = useCallback(async () => {
    if (!currentBranch?.id) return;
    setIsLoadingRegister(true);
    try {
      const res = await apiFetch(`/registers?branchId=${currentBranch.id}`);
      if (res.ok) {
        const data = await res.json();
        const list = data.data || [];
        setRegisters(list);

        // Restore saved register
        const savedId = getSavedRegisterId(currentBranch.id);
        const match = list.find((r: any) => r.id === savedId) || list[0] || null;
        setSelectedRegister(match);
      }
    } catch {
      // Ignore
    } finally {
      setIsLoadingRegister(false);
    }
  }, [currentBranch?.id, apiFetch]);

  useEffect(() => {
    loadRegisters();
  }, [loadRegisters]);

  // Check Shift for selected register
  const checkRegisterShift = useCallback(async () => {
    if (!selectedRegister?.id || !user) {
      setActiveShift(null);
      setShiftInUseOtherUser(null);
      return;
    }
    try {
      const res = await apiFetch(`/shifts?registerId=${selectedRegister.id}&status=open`);
      if (res.ok) {
        const data = await res.json();
        const items = data.data?.items || [];
        const openShift = items[0] || null;

        if (openShift) {
          if (openShift.cashierUserId === user.id || openShift.cashierUser?.id === user.id) {
            // Fetch detailed shift with cash movements and sales
            const shiftRes = await apiFetch(`/shifts/${openShift.id}`);
            const shiftJson = shiftRes.ok ? await shiftRes.json() : null;
            const fullShift = shiftJson?.data || shiftJson || openShift;
            setActiveShift(fullShift);
            setShiftInUseOtherUser(null);
          } else {
            // Shift is open by another cashier!
            setActiveShift(null);
            setShiftInUseOtherUser(openShift);
          }
        } else {
          setActiveShift(null);
          setShiftInUseOtherUser(null);
        }
      }
    } catch {
      // Ignore
    }
  }, [selectedRegister?.id, user, apiFetch]);

  useEffect(() => {
    checkRegisterShift();
  }, [checkRegisterShift]);

  // Load Products & Categories for Branch
  const loadCatalog = useCallback(async () => {
    const branchId = currentBranch?.id || user?.branches?.[0]?.id;
    try {
      const prodUrl = branchId
        ? `/products?branchId=${branchId}&limit=100`
        : `/products?limit=100`;
      const [prodRes, catRes] = await Promise.all([
        apiFetch(prodUrl),
        apiFetch(`/categories`),
      ]);
      if (prodRes.ok) {
        const data = await prodRes.json();
        setProducts(data.data || []);
      }
      if (catRes.ok) {
        const data = await catRes.json();
        setCategories(data.data || []);
      }
    } catch {}
  }, [currentBranch?.id, user?.branches, apiFetch]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Restore cart and held carts when register changes
  useEffect(() => {
    if (!selectedRegister?.id) return;
    const stored = loadActiveCart(selectedRegister.id);
    if (stored) {
      setSaleId(stored.saleId || uuidv7());
      setCartItems(stored.items || []);
      setSelectedCustomer(
        stored.customerId
          ? { id: stored.customerId, name: stored.customerName || "", phone: stored.customerPhone }
          : { name: strings.pos.walkInCustomer },
      );
      setBillDiscount(stored.billDiscount);
      setSaleNotes(stored.notes || "");
    } else {
      setSaleId(uuidv7());
      setCartItems([]);
      setBillDiscount(undefined);
      setSaleNotes("");
    }
    setHeldCarts(loadHeldCarts(selectedRegister.id));
  }, [selectedRegister?.id, strings.pos.walkInCustomer]);

  // Persist active cart to localStorage
  useEffect(() => {
    if (!selectedRegister?.id) return;
    if (cartItems.length > 0 || billDiscount || saleNotes) {
      saveActiveCart(selectedRegister.id, {
        saleId,
        items: cartItems,
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        billDiscount,
        notes: saleNotes,
        updatedAt: new Date().toISOString(),
      });
    } else {
      clearActiveCart(selectedRegister.id);
    }
  }, [selectedRegister?.id, saleId, cartItems, selectedCustomer, billDiscount, saleNotes]);

  // Focus search input when no modal open
  useEffect(() => {
    const isAnyModalOpen =
      isOpenShiftOpen ||
      isCashMoveOpen ||
      isCloseShiftOpen ||
      isCustomerOpen ||
      isHoldCartOpen ||
      isShiftSalesOpen ||
      isPaymentOpen ||
      isShortcutsOpen ||
      Boolean(selectedProductForVariants) ||
      Boolean(activeReceipt) ||
      editingDiscountLineIdx !== null ||
      isBillDiscountOpen ||
      editingPriceLineIdx !== null;

    if (!isAnyModalOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [
    isOpenShiftOpen,
    isCashMoveOpen,
    isCloseShiftOpen,
    isCustomerOpen,
    isHoldCartOpen,
    isShiftSalesOpen,
    isPaymentOpen,
    isShortcutsOpen,
    selectedProductForVariants,
    activeReceipt,
    editingDiscountLineIdx,
    isBillDiscountOpen,
    editingPriceLineIdx,
  ]);

  // Keyboard Shortcuts (F2, F4, F8, F9, Esc, Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes open modals
      if (e.key === "Escape") {
        setIsOpenShiftOpen(false);
        setIsCashMoveOpen(false);
        setIsCloseShiftOpen(false);
        setIsCustomerOpen(false);
        setIsHoldCartOpen(false);
        setIsShiftSalesOpen(false);
        setIsPaymentOpen(false);
        setIsShortcutsOpen(false);
        setIsReturnOpen(false);
        setSelectedProductForVariants(null);
        setEditingDiscountLineIdx(null);
        setIsBillDiscountOpen(false);
        setEditingPriceLineIdx(null);
        return;
      }

      // Enter on Receipt starts next sale
      if (e.key === "Enter" && activeReceipt) {
        e.preventDefault();
        handleStartNewSale();
        return;
      }

      // F2: Focus Search
      if (e.key === "F2") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // F4: Payment / Checkout
      if (e.key === "F4") {
        e.preventDefault();
        if (cartItems.length > 0 && !activeReceipt) {
          if (!activeShift) {
            setIsOpenShiftOpen(true);
          } else {
            setIsPaymentOpen(true);
          }
        }
        return;
      }

      // F6: Returns & Exchanges
      if (e.key === "F6") {
        e.preventDefault();
        if (activeShift && !activeReceipt) {
          setIsReturnOpen(true);
        }
        return;
      }

      // F8: Hold / Resume Carts
      if (e.key === "F8") {
        e.preventDefault();
        setIsHoldCartOpen(true);
        return;
      }

      // F9: Customer Dialog
      if (e.key === "F9") {
        e.preventDefault();
        setIsCustomerOpen(true);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cartItems.length, activeShift, activeReceipt]);

  // Add Item to Cart
  const handleAddToCart = (variant: PosProductVariant, product: PosProduct, qty = 1) => {
    setCartItems((prev) => {
      const existingIdx = prev.findIndex((item) => item.variantId === variant.id);
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = {
          ...next[existingIdx],
          quantity: next[existingIdx].quantity + qty,
        };
        return next;
      }

      let size: string | undefined = undefined;
      let color: string | undefined = undefined;
      if (variant.optionValues && Array.isArray(variant.optionValues)) {
        for (const ov of variant.optionValues) {
          const optName = ov.optionValue?.option?.name?.toLowerCase().trim();
          const val = ov.optionValue?.value;
          if (optName === "size") size = val;
          else if (optName === "color" || optName === "colour") color = val;
        }
      }

      const newItem: CartItem = {
        variantId: variant.id,
        productId: product.id,
        name: product.name,
        sku: variant.sku,
        size,
        color,
        unitPriceMinor: variant.priceMinor,
        quantity: qty,
        taxRateBp: variant.taxRateBp ?? product.taxClass?.rateBp ?? 0,
        allowDecimals: product.allowDecimals ?? false,
      };

      return [...prev, newItem];
    });

    playSuccessBeep();
  };

  // Barcode / SKU scan or Enter Handler
  const handleBarcodeSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBarcodeSearchNotice(null);
    const code = searchQuery.trim();
    if (!code) return;

    const branchId = currentBranch?.id || user?.branches?.[0]?.id;

    // First: Match against in-memory products by exact barcode or SKU
    const match = matchBarcodeOrSku(code, products, branchId);
    if (match.matched && match.variant && match.product) {
      handleAddToCart(match.variant, match.product, 1);
      setSearchQuery("");
      return;
    }

    // If search text already filtered matching products on the screen, let user pick from the cards
    if (filteredProducts.length > 0) {
      return;
    }

    // Second: Fetch from API if not found in first page
    try {
      const branchParam = branchId ? `branchId=${branchId}&` : "";
      const res = await apiFetch(`/products?${branchParam}search=${encodeURIComponent(code)}`);
      if (res.ok) {
        const data = await res.json();
        const serverProducts = Array.isArray(data.data) ? data.data : (data.data?.items || data.items || []);
        const serverMatch = matchBarcodeOrSku(code, serverProducts, branchId);
        if (serverMatch.matched && serverMatch.variant && serverMatch.product) {
          handleAddToCart(serverMatch.variant, serverMatch.product, 1);
          setSearchQuery("");
          return;
        }
      }
    } catch {}

    // Not found: Audible beep + Notice; do NOT clear box silently
    playErrorBeep();
    setBarcodeSearchNotice(
      locale === "bn"
        ? `বারকোড বা পণ্য পাওয়া যায়নি: "${code}"`
        : `Barcode or product not found: "${code}"`,
    );
  };

  // Update Cart Quantity
  const handleUpdateQuantity = (idx: number, delta: number) => {
    setCartItems((prev) => {
      const next = [...prev];
      const target = next[idx];
      const newQty = target.quantity + delta;
      if (newQty <= 0) {
        return prev.filter((_, i) => i !== idx);
      }
      next[idx] = { ...target, quantity: newQty };
      return next;
    });
  };

  // Direct Quantity Input
  const handleDirectQuantity = (idx: number, valueStr: string) => {
    const val = parseFloat(valueStr);
    if (isNaN(val) || val <= 0) return;
    setCartItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: val };
      return next;
    });
  };

  // Remove Item
  const handleRemoveItem = (idx: number) => {
    setCartItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // Line Discount Apply
  const handleApplyLineDiscount = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingDiscountLineIdx === null) return;
    const num = parseFloat(lineDiscountVal);
    setCartItems((prev) => {
      const next = [...prev];
      if (isNaN(num) || num <= 0) {
        delete next[editingDiscountLineIdx].discount;
      } else if (lineDiscountType === "percent") {
        next[editingDiscountLineIdx].discount = {
          type: "percent",
          percentBp: Math.round(num * 100),
        };
      } else {
        next[editingDiscountLineIdx].discount = {
          type: "fixed",
          amountMinor: Math.round(num * 100),
        };
      }
      return next;
    });
    setEditingDiscountLineIdx(null);
    setLineDiscountVal("");
  };

  // Bill Discount Apply
  const handleApplyBillDiscount = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(billDiscountVal);
    if (isNaN(num) || num <= 0) {
      setBillDiscount(undefined);
    } else if (billDiscountType === "percent") {
      setBillDiscount({ type: "percent", percentBp: Math.round(num * 100) });
    } else {
      setBillDiscount({ type: "fixed", amountMinor: Math.round(num * 100) });
    }
    setIsBillDiscountOpen(false);
    setBillDiscountVal("");
  };

  // Price Override Apply
  const handleApplyPriceOverride = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPriceLineIdx === null) return;
    const num = parseFloat(overridePriceVal);
    setCartItems((prev) => {
      const next = [...prev];
      if (isNaN(num) || num <= 0) {
        delete next[editingPriceLineIdx].overrideUnitPriceMinor;
      } else {
        next[editingPriceLineIdx].overrideUnitPriceMinor = Math.round(num * 100);
      }
      return next;
    });
    setEditingPriceLineIdx(null);
    setOverridePriceVal("");
  };

  // Start New Sale (clearing cart, resetting UUID v7)
  const handleStartNewSale = () => {
    setSaleId(uuidv7());
    setCartItems([]);
    setSelectedCustomer({ name: strings.pos.walkInCustomer });
    setBillDiscount(undefined);
    setSaleNotes("");
    setActiveReceipt(null);
    setExchangeContext(null);
    setServerErrorBanner(null);

    setBarcodeSearchNotice(null);
    if (selectedRegister?.id) {
      clearActiveCart(selectedRegister.id);
    }
    setTimeout(() => {
      // Only refocus search input if no modal dialog is open
      const hasOpenDialog = document.querySelector('[role="dialog"]');
      if (!hasOpenDialog) {
        searchInputRef.current?.focus();
      }
    }, 50);
  };

  // Complete Sale (with UUID v7 idempotency & retry)
  const handleCompleteSale = async (payments: PaymentItemInput[], refundMethod?: string) => {
    if (!activeShift?.id || !currentBranch?.id) return;
    setIsCompletingSale(true);
    setServerErrorBanner(null);

    // If Exchange mode is active, submit to /sales/exchange
    if (exchangeContext) {
      const exchangeId = uuidv7();
      const exchangePayload = {
        id: exchangeId,
        originalSaleId: exchangeContext.originalSale.id,
        shiftId: activeShift.id,
        branchId: currentBranch.id,
        customerId: selectedCustomer?.id || undefined,
        returnItems: exchangeContext.returnItems.map((ri) => ({
          saleItemId: ri.saleItemId,
          quantity: ri.quantity,
          condition: ri.condition,
        })),
        newItems: cartItems.map((it) => ({
          variantId: it.variantId,
          quantity: it.quantity,
          overrideUnitPriceMinor: it.overrideUnitPriceMinor,
          discount: it.discount
            ? {
                type: it.discount.type,
                amountMinor: it.discount.amountMinor,
                percentBp: it.discount.percentBp,
              }
            : undefined,
        })),
        billDiscount: billDiscount
          ? {
              type: billDiscount.type,
              amountMinor: billDiscount.amountMinor,
              percentBp: billDiscount.percentBp,
            }
          : undefined,
        payments: payments
          .filter((p) => p.amountMinor > 0)
          .map((p) => ({
            paymentMethod: p.paymentMethod,
            amountMinor: p.amountMinor,
            reference: p.reference?.trim() || undefined,
          })),
        refundMethod: refundMethod || "cash",
        returnReason: exchangeContext.reason,
        overrideReason: exchangeContext.overrideReason,
        notes: saleNotes.trim() || undefined,
      };

      try {
        const res = await apiFetch("/sales/exchange", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": exchangeId,
          },
          body: JSON.stringify(exchangePayload),
        });

        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.message || json.message || "Failed to process exchange");
        }

        const exchangeData = json.data || json;
        const newSale = exchangeData.sale || exchangeData.exchangeSale || exchangeData;
        const saleReturn = exchangeData.return || exchangeData;

        // Build Exchange Receipt
        const receiptData: ReceiptData = {
          saleId: newSale.id,
          invoiceNumber: newSale.invoiceNumber,
          createdAt: newSale.createdAt || new Date().toISOString(),
          cashierName: user?.name || "Cashier",
          registerName: selectedRegister?.name || "Register 1",
          branchName: currentBranch?.name || "Main Branch",
          branchAddress: currentBranch?.code ? `Branch: ${currentBranch.code}` : undefined,
          customerName: selectedCustomer.name,
          customerPhone: selectedCustomer.phone,
          shopName: posConfig.shopName,
          receiptHeader: posConfig.receiptHeader,
          receiptFooter: posConfig.receiptFooter,
          isExchange: true,
          exchangeInfo: {
            returnNumber: saleReturn.returnNumber || exchangeData.returnNumber,
            originalInvoice: exchangeContext.originalSale.invoiceNumber,
            returnedItems: exchangeContext.returnItems.map((ri) => ({
              name: ri.productName,
              quantity: ri.quantity,
              refundMinor: ri.estimatedLineRefundMinor,
              condition: ri.condition,
            })),
            totalRefundMinor: exchangeContext.returnRefundMinor,
            differenceMinor: exchangeDifferenceMinor,
            refundMethod: refundMethod || "cash",
          },
          items: cartItems.map((it, idx) => {
            const calcLine = cartTotals.lines[idx];
            return {
              name: it.name,
              sku: it.sku,
              size: it.size,
              color: it.color,
              quantity: it.quantity,
              unitPriceMinor: it.overrideUnitPriceMinor ?? it.unitPriceMinor,
              grossMinor: calcLine?.grossMinor ?? it.unitPriceMinor * it.quantity,
              discountMinor: (calcLine?.lineDiscountMinor ?? 0) + (calcLine?.allocatedBillDiscountMinor ?? 0),
              taxMinor: calcLine?.taxMinor ?? 0,
              totalMinor: calcLine?.totalMinor ?? it.unitPriceMinor * it.quantity,
            };
          }),
          grossMinor: cartTotals.grossMinor,
          discountMinor: cartTotals.totalDiscountMinor,
          taxMinor: cartTotals.taxMinor,
          totalMinor: cartTotals.totalMinor,
          paidMinor: payments.reduce((sum, p) => sum + p.amountMinor, 0),
          changeMinor: Math.max(0, payments.reduce((sum, p) => sum + p.amountMinor, 0) - netPayableMinor),
          payments,
        };

        setActiveReceipt(receiptData);
        setIsPaymentOpen(false);
        setExchangeContext(null);

        // In-memory stock decrement for new items
        setProducts((prev) =>
          prev.map((p) => {
            const cartItem = cartItems.find((ci) => ci.productId === p.id);
            if (!cartItem) return p;
            return {
              ...p,
              variants: p.variants.map((v) => {
                if (v.id !== cartItem.variantId) return v;
                return {
                  ...v,
                  stockLevels: v.stockLevels?.map((sl) =>
                    sl.branchId === currentBranch?.id
                      ? {
                          ...sl,
                          qty: Math.max(0, Number(sl.qty || 0) - cartItem.quantity).toString(),
                        }
                      : sl,
                  ),
                };
              }),
            };
          }),
        );

        checkRegisterShift();
        return;
      } catch (err: any) {
        setServerErrorBanner(err.message || "Failed to process exchange");
        return;
      } finally {
        setIsCompletingSale(false);
      }
    }

    const salePayload = {
      id: saleId,
      shiftId: activeShift.id,
      branchId: currentBranch.id,
      customerId: selectedCustomer.id || undefined,
      billDiscount: billDiscount
        ? {
            type: billDiscount.type,
            amountMinor: billDiscount.amountMinor,
            percentBp: billDiscount.percentBp,
          }
        : undefined,
      items: cartItems.map((it) => ({
        variantId: it.variantId,
        quantity: it.quantity,
        overrideUnitPriceMinor: it.overrideUnitPriceMinor,
        discount: it.discount
          ? {
              type: it.discount.type,
              amountMinor: it.discount.amountMinor,
              percentBp: it.discount.percentBp,
            }
          : undefined,
      })),
      payments: payments
        .filter((p) => p.amountMinor > 0)
        .map((p) => ({
          paymentMethod: p.paymentMethod,
          amountMinor: p.amountMinor,
          reference: p.reference?.trim() || undefined,
        })),
      notes: saleNotes.trim() || undefined,
      expectedTotalMinor: cartTotals.expectedTotalMinor,
    };

    const submitSaleWithRetry = async (attempt = 1): Promise<any> => {
      try {
        const res = await apiFetch("/sales", {
          method: "POST",
          headers: {
            "Idempotency-Key": saleId,
          },
          body: JSON.stringify(salePayload),
        });

        const json = await res.json();

        if (res.ok && (json.success || json.id || json.data?.id)) {
          return json.data || json;
        }

        // Handle Discount limit exceeded error (403)
        if (res.status === 403 && (json.code === "DISCOUNT_LIMIT_EXCEEDED" || json.code === "LINE_DISCOUNT_LIMIT_EXCEEDED")) {
          const limitPct = json.limitBp !== undefined ? json.limitBp / 100 : maxDiscountPercent;
          const attemptedPct = json.attemptedBp !== undefined ? (json.attemptedBp / 100).toFixed(1) : "";
          throw new Error(
            locale === "bn"
              ? `ডিসকাউন্ট সীমা অতিক্রম করেছে: অনুমোদিত ${limitPct}%, চেষ্টা করা হয়েছে ${attemptedPct}%`
              : `Discount limit exceeded: permitted ${limitPct}%, attempted ${attemptedPct}%`,
          );
        }

        // Server rejected with specific 409 / 422
        if (res.status === 409 || res.status === 422) {
          throw new Error(json.message || json.error?.message || "Sale validation failed");
        }

        throw new Error(json.error?.message || json.message || "Failed to create sale");
      } catch (err: any) {
        // Network error or timeout: auto-retry once with same UUID v7
        if (attempt === 1 && (err.name === "TypeError" || err.message?.includes("network") || err.message?.includes("fetch"))) {
          return submitSaleWithRetry(2);
        }
        throw err;
      }
    };

    try {
      const createdSale = await submitSaleWithRetry();

      // Format receipt data
      const receiptData: ReceiptData = {
        saleId: createdSale.id,
        invoiceNumber: createdSale.invoiceNumber,
        createdAt: createdSale.createdAt || new Date().toISOString(),
        cashierName: user?.name || "Cashier",
        registerName: selectedRegister?.name || "Register 1",
        branchName: currentBranch?.name || "Main Branch",
        branchAddress: currentBranch?.code ? `Branch: ${currentBranch.code}` : undefined,
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        shopName: posConfig.shopName,
        receiptHeader: posConfig.receiptHeader,
        receiptFooter: posConfig.receiptFooter,
        items: cartItems.map((it, idx) => {
          const calcLine = cartTotals.lines[idx];
          return {
            name: it.name,
            sku: it.sku,
            size: it.size,
            color: it.color,
            quantity: it.quantity,
            unitPriceMinor: it.overrideUnitPriceMinor ?? it.unitPriceMinor,
            grossMinor: calcLine?.grossMinor ?? it.unitPriceMinor * it.quantity,
            discountMinor: (calcLine?.lineDiscountMinor ?? 0) + (calcLine?.allocatedBillDiscountMinor ?? 0),
            taxMinor: calcLine?.taxMinor ?? 0,
            totalMinor: calcLine?.totalMinor ?? it.unitPriceMinor * it.quantity,
          };
        }),
        grossMinor: cartTotals.grossMinor,
        discountMinor: cartTotals.totalDiscountMinor,
        taxMinor: cartTotals.taxMinor,
        totalMinor: cartTotals.totalMinor,
        paidMinor: payments.reduce((sum, p) => sum + p.amountMinor, 0),
        changeMinor: Math.max(0, payments.reduce((sum, p) => sum + p.amountMinor, 0) - cartTotals.totalMinor),
        dueMinor: createdSale?.dueMinor !== undefined
          ? Number(createdSale.dueMinor)
          : Math.max(0, cartTotals.totalMinor - payments.reduce((sum, p) => sum + p.amountMinor, 0)),
        customerTotalDueMinor: selectedCustomer.id
          ? (customerBalance?.currentDueMinor ?? Number(selectedCustomer.currentDueMinor || 0)) +
            (createdSale?.dueMinor !== undefined
              ? Number(createdSale.dueMinor)
              : Math.max(0, cartTotals.totalMinor - payments.reduce((sum, p) => sum + p.amountMinor, 0)))
          : undefined,
        payments,
      };

      setActiveReceipt(receiptData);
      setIsPaymentOpen(false);

      // Decrement in-memory stock immediately for responsive feel
      setProducts((prev) =>
        prev.map((p) => {
          const cartItem = cartItems.find((ci) => ci.productId === p.id);
          if (!cartItem) return p;
          return {
            ...p,
            variants: p.variants.map((v) => {
              if (v.id !== cartItem.variantId) return v;
              return {
                ...v,
                stockLevels: v.stockLevels?.map((sl) =>
                  sl.branchId === currentBranch?.id
                    ? {
                        ...sl,
                        qty: Math.max(0, Number(sl.qty || 0) - cartItem.quantity).toString(),
                      }
                    : sl,
                ),
              };
            }),
          };
        }),
      );

      // Refresh shift data
      checkRegisterShift();
    } catch (err: any) {
      setServerErrorBanner(err.message || "Failed to complete sale");
    } finally {
      setIsCompletingSale(false);
    }
  };

  // Open Shift
  const handleOpenShift = async (openingCashMinor: number, notes?: string) => {
    if (!selectedRegister?.id || !currentBranch?.id) return;
    setIsShiftSubmitting(true);
    try {
      const res = await apiFetch("/shifts/open", {
        method: "POST",
        body: JSON.stringify({
          registerId: selectedRegister.id,
          branchId: currentBranch.id,
          openingCashMinor,
          notes,
        }),
      });
      const data = await res.json();
      if (res.ok && (data.success || data.id)) {
        setIsOpenShiftOpen(false);
        checkRegisterShift();
      } else if (res.status === 409) {
        // Shift is already open on this register
        setIsOpenShiftOpen(false);
        checkRegisterShift();
      } else {
        console.error("Failed to open shift:", data.error?.message || data.message);
      }
    } catch (err: any) {
      console.error("Failed to open shift:", err.message);
    } finally {
      setIsShiftSubmitting(false);
    }
  };

  // Cash In / Cash Out
  const handleCashMovement = async (type: "cash_in" | "cash_out", amountMinor: number, reason: string) => {
    if (!activeShift?.id) return;
    setIsShiftSubmitting(true);
    try {
      const res = await apiFetch(`/shifts/${activeShift.id}/cash-movements`, {
        method: "POST",
        body: JSON.stringify({ type, amountMinor, reason }),
      });
      if (res.ok) {
        checkRegisterShift();
      }
    } catch {} finally {
      setIsShiftSubmitting(false);
    }
  };

  // Close Shift
  const handleCloseShift = async (closingCashMinor: number, notes?: string) => {
    if (!activeShift?.id) return null;
    setIsShiftSubmitting(true);
    try {
      const res = await apiFetch(`/shifts/${activeShift.id}/close`, {
        method: "POST",
        body: JSON.stringify({ closingCashMinor, notes }),
      });
      const data = await res.json();
      if (res.ok) {
        const closed = data.data || data;
        checkRegisterShift();
        return closed;
      } else {
        const errMsg = data.error?.message || data.message || "Failed to close shift";
        console.error("Failed to close shift:", errMsg);
        setServerErrorBanner(errMsg);
        return null;
      }
    } catch (err: any) {
      console.error("Failed to close shift:", err.message);
      setServerErrorBanner(err.message);
      return null;
    } finally {
      setIsShiftSubmitting(false);
    }
  };

  // Void Sale
  const handleVoidSale = async (saleIdToVoid: string, reason: string): Promise<boolean> => {
    try {
      const res = await apiFetch(`/sales/${saleIdToVoid}/void`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        checkRegisterShift();
        loadCatalog();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // Hold active cart
  const handleHoldCart = (label: string) => {
    if (!selectedRegister?.id || cartItems.length === 0) return;
    const held: HeldCart = {
      id: uuidv7(),
      label,
      heldAt: new Date().toISOString(),
      saleId,
      items: cartItems,
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      customerPhone: selectedCustomer.phone,
      billDiscount,
      notes: saleNotes,
      updatedAt: new Date().toISOString(),
    };
    saveHeldCart(selectedRegister.id, held);
    setHeldCarts(loadHeldCarts(selectedRegister.id));
    handleStartNewSale();
  };

  // Resume held cart
  const handleResumeCart = (held: HeldCart) => {
    if (!selectedRegister?.id) return;
    setSaleId(held.saleId || uuidv7());
    setCartItems(held.items || []);
    setSelectedCustomer(
      held.customerId
        ? { id: held.customerId, name: held.customerName || "", phone: held.customerPhone }
        : { name: strings.pos.walkInCustomer },
    );
    setBillDiscount(held.billDiscount);
    setSaleNotes(held.notes || "");
    removeHeldCart(selectedRegister.id, held.id);
    setHeldCarts(loadHeldCarts(selectedRegister.id));
  };

  // Remove held cart
  const handleRemoveHeld = (heldId: string) => {
    if (!selectedRegister?.id) return;
    removeHeldCart(selectedRegister.id, heldId);
    setHeldCarts(loadHeldCarts(selectedRegister.id));
  };

  // Register selection
  const handleSelectRegister = (reg: any) => {
    setSelectedRegister(reg);
    if (currentBranch?.id) {
      setSavedRegisterId(currentBranch.id, reg.id);
    }
  };

  // Check auth & permissions
  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    router.push("/login?from=/pos");
    return null;
  }

  // Filter products by search and category
  const filteredProducts = products.filter((p) => {
    if (selectedCategoryId !== "all" && p.categoryId !== selectedCategoryId) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const nameMatch = p.name.toLowerCase().includes(q);
      const skuMatch = p.variants?.some((v: any) => v.sku?.toLowerCase().includes(q));
      const barcodeMatch = p.variants?.some((v: any) =>
        v.barcodes?.some((b: any) => b.barcode?.toLowerCase().includes(q)),
      );
      return nameMatch || skuMatch || barcodeMatch;
    }
    return true;
  });

  const canAccessAdmin =
    user.isOwner ||
    user.permissions.includes("*") ||
    user.permissions.some((p) =>
      ["report.sales", "report.profit", "tenant.read", "purchase.read", "catalog.manage"].includes(p),
    );

  // If viewing active receipt
  if (activeReceipt) {
    return (
      <ReceiptView
        receipt={activeReceipt}
        onNewSale={handleStartNewSale}
        timezone={posConfig.timezone}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background">
      {/* 1. POS Top Bar */}
      <header className="h-14 border-b border-border bg-card px-4 flex items-center justify-between shrink-0 select-none">
        {/* Left: Brand & Register status */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-2 text-primary shrink-0">
            <Store className="h-5 w-5" />
            <h1 className="text-sm font-bold truncate">
              <span className="hidden xl:inline">{posConfig.shopName}</span>
            </h1>
          </div>

          <div className="h-4 w-px bg-border hidden xl:block" />

          {/* Branch & Register Dropdowns */}
          <div className="flex items-center gap-1.5 text-xs font-medium shrink-0">
            <span className="font-semibold truncate max-w-[75px] xl:max-w-[140px]">
              <span className="hidden xl:inline">{currentBranch?.code || "BR"} - </span>
              {currentBranch?.name}
            </span>

            <span className="text-muted-foreground">•</span>

            {registers.length > 0 ? (
              <select
                value={selectedRegister?.id || ""}
                onChange={(e) => {
                  const reg = registers.find((r) => r.id === e.target.value);
                  if (reg) handleSelectRegister(reg);
                }}
                aria-label={locale === "bn" ? "রেজিস্টার নির্বাচন" : "Select Register"}
                className="h-7 text-xs font-semibold bg-muted/50 border border-input rounded-md px-1.5 max-w-[95px] sm:max-w-[130px] focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="register-select"
              >
                {registers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-rose-500 font-semibold">{strings.pos.noRegisters}</span>
            )}
          </div>

          {/* Shift status badge */}
          {activeShift ? (
            <Badge
              variant="default"
              data-testid="shift-status-badge"
              className="text-[10px] py-1 px-2 font-medium flex items-center gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-none shrink-0 whitespace-nowrap"
            >
              <Unlock className="h-3 w-3 shrink-0" />
              <span>
                <span className="hidden sm:inline">{locale === "bn" ? "শিফট " : "Shift "}</span>
                <span>{locale === "bn" ? "চলমান" : "Open"}</span>
                <span className="hidden md:inline"> ({new Date(activeShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})</span>
              </span>
            </Badge>
          ) : (
            <Badge
              variant="outline"
              data-testid="shift-status-badge"
              className="text-[10px] py-1 px-2 font-medium flex items-center gap-1 border-dashed shrink-0 whitespace-nowrap"
            >
              <Lock className="h-3 w-3 shrink-0" />
              <span>
                <span className="hidden sm:inline">{locale === "bn" ? "শিফট " : "Shift "}</span>
                <span>{locale === "bn" ? "বন্ধ" : "Closed"}</span>
              </span>
            </Badge>
          )}
        </div>

        {/* Right: Cashier, Discount Limit, Shift Actions, Network, Theme, Language, Back */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Offline warning indicator */}
          {!isOnline && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-semibold shrink-0">
              <WifiOff className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{locale === "bn" ? "অফলাইন" : "Offline"}</span>
            </div>
          )}

          {/* Cashier Name & Menu (Interactive, moves discount limit inside at narrow widths) */}
          <div className="relative shrink-0" ref={cashierMenuRef}>
            <button
              type="button"
              data-testid="cashier-name-block"
              onClick={() => setIsCashierMenuOpen((prev) => !prev)}
              className="flex items-center gap-1.5 h-8 px-2 rounded-md bg-muted/40 hover:bg-muted/70 border border-border/50 transition-colors text-left"
              title={locale === "bn" ? "ক্যাশিয়ার তথ্য" : "Cashier details"}
            >
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span
                data-testid="cashier-name"
                className="text-xs font-medium text-foreground truncate max-w-[70px] sm:max-w-[100px]"
              >
                {user.name}
              </span>
            </button>

            {/* Cashier Dropdown Menu (Contains discount limit on narrow screens) */}
            {isCashierMenuOpen && (
              <div
                data-testid="cashier-menu-dropdown"
                className="absolute right-0 top-full mt-1.5 w-56 bg-card border border-border rounded-xl shadow-xl p-3 z-50 text-xs space-y-2 animate-in fade-in"
              >
                <div className="border-b border-border pb-2">
                  <p className="font-semibold text-foreground">{user.name}</p>
                  <p className="text-[11px] text-muted-foreground">{user.email}</p>
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    {user.roles?.join(", ") || (user.isOwner ? "Owner" : "Staff")}
                  </Badge>
                </div>
                <div className="py-1">
                  <span className="text-muted-foreground block text-[11px] mb-1">
                    {strings.pos.discountLimit}
                  </span>
                  <span
                    data-testid="cashier-discount-limit"
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-primary/10 text-primary border border-primary/20"
                  >
                    {user?.isOwner || user?.roles?.includes("Owner") || maxDiscountPercent === null
                      ? locale === "bn" ? "সীমাহীন" : "No limit"
                      : `${maxDiscountPercent}%`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Standalone Discount Limit badge on medium/large widths (>= 640px) */}
          <div
            data-testid="cashier-discount-limit"
            className="hidden sm:inline-flex items-center h-8 px-2 rounded-md text-[10px] font-mono font-medium bg-primary/10 text-primary border border-primary/20 shrink-0 whitespace-nowrap"
          >
            <span className="hidden xl:inline">{strings.pos.discountLimit}: </span>
            <span className="xl:hidden">{locale === "bn" ? "সীমা: " : "Limit: "}</span>
            <span>
              {user?.isOwner || user?.roles?.includes("Owner") || maxDiscountPercent === null
                ? locale === "bn" ? "সীমাহীন" : "No limit"
                : `${maxDiscountPercent}%`}
            </span>
          </div>

          {/* Shift Actions */}
          {activeShift ? (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCashMoveOpen(true)}
                className="h-8 px-2 text-xs font-medium"
                data-testid="cash-movement-button"
                title={strings.pos.cashManagement}
              >
                <ArrowRightLeft className="h-3.5 w-3.5 2xl:mr-1" />
                <span className="hidden 2xl:inline">{strings.pos.cashManagement}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsShiftSalesOpen(true)}
                className="h-8 px-2 text-xs font-medium"
                data-testid="shift-sales-button"
                title={locale === "bn" ? "শিফট বিক্রি" : "Shift Sales"}
              >
                <Receipt className="h-3.5 w-3.5 2xl:mr-1" />
                <span className="hidden 2xl:inline">{locale === "bn" ? "বিক্রি তালিকা" : "Sales"}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsReturnOpen(true)}
                className="h-8 px-2 text-xs font-medium text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                data-testid="pos-return-button"
                title={locale === "bn" ? "পণ্য ফেরত / বদল (F6)" : "Returns & Exchanges (F6)"}
              >
                <RotateCcw className="h-3.5 w-3.5 2xl:mr-1" />
                <span className="hidden 2xl:inline">{locale === "bn" ? "ফেরত (F6)" : "Return (F6)"}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCloseShiftOpen(true)}
                className="h-8 px-2 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                data-testid="close-shift-button"
                title={strings.pos.closeShift}
              >
                <Lock className="h-3.5 w-3.5 2xl:mr-1" />
                <span className="hidden 2xl:inline">{strings.pos.closeShift}</span>
              </Button>
            </div>
          ) : (
            selectedRegister && (
              <Button
                size="sm"
                onClick={() => setIsOpenShiftOpen(true)}
                className="h-8 px-3 text-xs font-semibold"
                data-testid="open-shift-button"
              >
                <Unlock className="h-3.5 w-3.5 mr-1" />
                <span>{strings.pos.openShift}</span>
              </Button>
            )
          )}

          {/* Held Carts Badge Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsHoldCartOpen(true)}
            className="h-8 px-2 text-xs font-medium relative"
            title={strings.pos.holdCart}
          >
            <PauseCircle className="h-3.5 w-3.5" />
            {heldCarts.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {heldCarts.length}
              </span>
            )}
          </Button>

          {/* Keyboard Shortcuts Dialog */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsShortcutsOpen(true)}
            aria-label={strings.pos.shortcuts}
            className="h-8 w-8 text-muted-foreground hidden sm:inline-flex"
            title={strings.pos.shortcuts}
          >
            <Keyboard className="h-4 w-4" />
          </Button>

          {/* Theme & Language Switchers */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={locale === "bn" ? "থিম পরিবর্তন" : "Toggle theme"}
            className="h-8 w-8"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocale(locale === "bn" ? "en" : "bn")}
            className="h-8 px-2 text-xs font-semibold"
          >
            {locale === "bn" ? "EN" : "বাং"}
          </Button>

          {/* Back to Back Office (Admin) Link */}
          {canAccessAdmin && (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors"
              title={strings.pos.backToAdmin}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden 2xl:inline">{strings.pos.backToAdmin}</span>
            </Link>
          )}
        </div>
      </header>

      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="bg-rose-600 text-white px-4 py-2 text-xs font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>{strings.pos.offlineNotice} {strings.pos.offlineSubtext}</span>
          </div>
        </div>
      )}

      {/* Server Error Alert Banner */}
      {serverErrorBanner && (
        <div className="bg-rose-500/15 border-b border-rose-500/30 text-rose-700 dark:text-rose-400 px-4 py-2 text-xs font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{serverErrorBanner}</span>
          </div>
          <button onClick={() => setServerErrorBanner(null)} className="text-xs hover:underline">
            {strings.common.cancel}
          </button>
        </div>
      )}

      {/* Main 2-Pane Landscape Layout */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Pane: Items, Search & Barcode Scanner */}
        <div className="flex-1 flex flex-col border-r border-border min-w-0 bg-muted/10">
          {/* Top Search & Barcode Input */}
          <div className="p-3 border-b border-border bg-card">
            <form onSubmit={handleBarcodeSearchSubmit} className="relative">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={strings.pos.searchPlaceholder}
                className="pl-10 pr-24 h-10 font-mono text-xs sm:text-sm font-medium border-primary/30 focus:border-primary"
                data-testid="pos-search-input"
                autoFocus
              />
              <div className="absolute right-2 top-2 flex items-center gap-1">
                <Button type="submit" size="sm" className="h-6 text-xs px-2 font-mono">
                  Enter
                </Button>
              </div>
            </form>

            {/* Unknown Barcode Alert */}
            {barcodeSearchNotice && (
              <div className="mt-2 p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center justify-between animate-in fade-in">
                <span>{barcodeSearchNotice}</span>
                <button
                  type="button"
                  onClick={() => setBarcodeSearchNotice(null)}
                  className="text-xs hover:underline ml-2"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Category Filter Horizontal Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pt-2.5 pb-0.5 no-scrollbar">
              <Button
                variant={selectedCategoryId === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategoryId("all")}
                className="h-7 px-3 text-xs shrink-0 font-medium rounded-full"
              >
                {strings.common.all}
              </Button>
              {categories.map((c) => (
                <Button
                  key={c.id}
                  variant={selectedCategoryId === c.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategoryId(c.id)}
                  className="h-7 px-3 text-xs shrink-0 font-medium rounded-full"
                >
                  {c.name}
                </Button>
              ))}
            </div>
          </div>

          {/* Product Grid */}
          <div className="flex-1 p-3 overflow-y-auto">
            {filteredProducts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground text-xs">
                <Search className="h-8 w-8 mb-2 opacity-40" />
                <p>{locale === "bn" ? "কোন পণ্য পাওয়া যায়নি" : "No products found"}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                {filteredProducts.map((p) => {
                  const hasVariants = p.variants && p.variants.length > 1;
                  const firstVariant = p.variants?.[0];
                  const price = firstVariant?.priceMinor || 0;

                  // Calculate total branch stock
                  const totalStock = getProductBranchStock(p, currentBranch?.id);
                  const isOutOfStock = totalStock <= 0;

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        if (hasVariants) {
                          setSelectedProductForVariants(p);
                        } else if (firstVariant) {
                          handleAddToCart(firstVariant, p, 1);
                        }
                      }}
                      data-testid={`product-card-${p.id}`}
                      className="text-left bg-card border border-border hover:border-primary hover:shadow-md p-3 rounded-xl transition-all flex flex-col justify-between min-h-[96px] active:scale-98 group"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-xs leading-tight line-clamp-2 group-hover:text-primary">
                          {p.name}
                        </div>
                        {hasVariants ? (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {p.variants.length} {locale === "bn" ? "টি ভ্যারিয়েন্ট" : "variants"}
                          </div>
                        ) : (
                          <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                            {firstVariant?.sku}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between mt-2 pt-1 border-t border-border/50">
                        <span className="text-xs font-bold font-mono tabular-nums text-foreground">
                          {formatMoney(price)}
                        </span>
                        <span
                          className={`text-[10px] font-mono ${
                            isOutOfStock
                              ? "text-rose-600 dark:text-rose-400 font-medium"
                              : "text-muted-foreground"
                          }`}
                        >
                          {isOutOfStock
                            ? locale === "bn"
                              ? "স্টক শেষ"
                              : "Out of stock"
                            : `${locale === "bn" ? "স্টক:" : "Stock:"} ${totalStock}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Pane: Cart & Totals (Width ~ 380px to 440px) */}
        <aside aria-label={locale === "bn" ? "কার্ট প্যানেল" : "Cart Panel"} className="w-[380px] sm:w-[420px] lg:w-[460px] flex flex-col bg-card shrink-0 select-none">
          {/* Cart Header */}
          <div className="p-3 border-b border-border flex items-center justify-between bg-muted/20">
            {/* Customer Pill Button (F9) */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCustomerOpen(true)}
              data-testid="customer-button"
              className="h-8 px-2.5 text-xs font-medium max-w-[220px] truncate"
            >
              <User className="h-3.5 w-3.5 mr-1.5 text-primary shrink-0" />
              <span className="truncate">{selectedCustomer.name}</span>
              {(customerBalance?.currentDueMinor ?? Number(selectedCustomer.currentDueMinor || 0)) > 0 && (
                <span className="ml-1.5 px-1 py-0.5 bg-destructive/15 text-destructive text-[10px] rounded font-mono font-semibold shrink-0">
                  {formatMoney(customerBalance?.currentDueMinor ?? Number(selectedCustomer.currentDueMinor || 0))}
                </span>
              )}
            </Button>

            {/* Hold, Return & Clear Cart Actions */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsReturnOpen(true)}
              className="h-8 px-2 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 hover:bg-amber-500/10"
              title={locale === "bn" ? "পণ্য ফেরত বা বদল (F6)" : "Return / Exchange (F6)"}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              <span>{locale === "bn" ? "ফেরত (F6)" : "Return (F6)"}</span>
            </Button>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsHoldCartOpen(true)}
                disabled={cartItems.length === 0}
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                title={strings.pos.holdCart}
              >
                <PauseCircle className="h-3.5 w-3.5 mr-1" />
                <span>{locale === "bn" ? "হোল্ড (F8)" : "Hold (F8)"}</span>
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={handleStartNewSale}
                disabled={cartItems.length === 0}
                aria-label={strings.pos.clearCart}
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                title={strings.pos.clearCart}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Active Exchange Context Banner */}
          {exchangeContext && (
            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-amber-900 dark:text-amber-200">
                <RotateCcw className="h-4 w-4 text-amber-600 shrink-0" />
                <div>
                  <span className="font-semibold">{locale === "bn" ? "পণ্য বদল মোড" : "Exchange Mode"}:</span>{" "}
                  <span className="font-mono">{exchangeContext.originalSale.invoiceNumber}</span>
                  <div className="text-[10px] text-amber-700 dark:text-amber-400">
                    {locale === "bn" ? "ফেরত বাবদ জমা:" : "Return Credit:"} -{formatMoney(exchangeContext.returnRefundMinor)}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExchangeContext(null)}
                className="h-6 px-1.5 text-[10px] text-red-600 hover:text-red-700"
              >
                {locale === "bn" ? "বাতিল" : "Cancel"}
              </Button>
            </div>
          )}

          {/* Discount Limit Exceeded Alert Banner */}
          {isDiscountLimitExceeded && (
            <div
              data-testid="discount-limit-alert"
              className="p-2.5 bg-rose-500/10 border-b border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs flex items-center gap-2"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="leading-tight">
                {strings.pos.discountLimitWarning} ({maxDiscountPercent}%)
              </span>
            </div>
          )}

          {/* Cart Items List Table */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/60">
            {cartItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground text-xs">
                <ShoppingCart className="h-10 w-10 mb-2 opacity-30" />
                <p>{strings.pos.emptyCart}</p>
              </div>
            ) : (
              cartItems.map((item, idx) => {
                const calcLine = cartTotals.lines[idx];
                const unitPrice = item.overrideUnitPriceMinor ?? item.unitPriceMinor;
                const hasDiscount = Boolean(item.discount);
                const hasPriceOverride = item.overrideUnitPriceMinor !== undefined;

                return (
                  <div key={idx} className="p-3 flex items-start gap-2 hover:bg-muted/10 transition-colors">
                    {/* Item Info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-xs leading-snug truncate">{item.name}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono mt-0.5">
                        <span>{item.sku}</span>
                        {(item.size || item.color) && (
                          <>
                            <span>•</span>
                            <span className="font-medium">
                              {[item.color, item.size].filter(Boolean).join(" / ")}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs font-mono font-medium">
                          {formatMoney(unitPrice)}
                        </span>

                        {/* Line Discount Trigger */}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDiscountLineIdx(idx);
                            setLineDiscountType(item.discount?.type || "percent");
                            setLineDiscountVal(
                              item.discount
                                ? item.discount.type === "percent"
                                  ? (item.discount.percentBp! / 100).toString()
                                  : (item.discount.amountMinor! / 100).toString()
                                : "",
                            );
                          }}
                          data-testid={`line-discount-btn-${idx}`}
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            hasDiscount
                              ? "bg-primary/10 border-primary text-primary font-semibold"
                              : "border-dashed border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Tag className="h-2.5 w-2.5 inline mr-0.5" />
                          {hasDiscount
                            ? item.discount?.type === "percent"
                              ? `${item.discount.percentBp! / 100}%`
                              : `৳${(item.discount!.amountMinor! / 100).toFixed(0)}`
                            : locale === "bn"
                            ? "ছাড়"
                            : "Disc"}
                        </button>

                        {/* Price Override Trigger (Gated) */}
                        {hasPermission("sale.price_override") && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPriceLineIdx(idx);
                              setOverridePriceVal((unitPrice / 100).toString());
                            }}
                            data-testid={`line-discount-btn-${idx}`}
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              hasPriceOverride
                                ? "bg-amber-500/10 border-amber-500 text-amber-700 dark:text-amber-400 font-semibold"
                                : "border-dashed border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {locale === "bn" ? "মূল্য" : "Price"}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Quantity Controls (Min 44px touch target) */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleUpdateQuantity(idx, -1)}
                        aria-label={locale === "bn" ? "পরিমাণ কমান" : "Decrease quantity"}
                        className="h-8 w-8 rounded-md"
                        data-testid={`qty-minus-${idx}`}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <input
                        type="number"
                        min="1"
                        step={item.allowDecimals ? "0.001" : "1"}
                        value={item.quantity}
                        onChange={(e) => handleDirectQuantity(idx, e.target.value)}
                        aria-label={locale === "bn" ? "পরিমাণ" : "Quantity"}
                        className="w-10 h-8 text-center text-xs font-mono font-bold bg-muted/40 border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                        data-testid={`qty-input-${idx}`}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleUpdateQuantity(idx, 1)}
                        aria-label={locale === "bn" ? "পরিমাণ বাড়ান" : "Increase quantity"}
                        className="h-8 w-8 rounded-md"
                        data-testid={`qty-plus-${idx}`}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Line Total & Remove */}
                    <div className="text-right shrink-0 min-w-[70px]">
                      <div className="text-xs font-bold font-mono tabular-nums">
                        {formatMoney(calcLine?.totalMinor ?? unitPrice * item.quantity)}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveItem(idx)}
                        aria-label={locale === "bn" ? "আইটেম সরান" : "Remove item"}
                        className="h-6 w-6 mt-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pinned Bottom Summary & Checkout Button (Always visible at 1024x768 and 1366x768) */}
          <div className="p-4 border-t border-border bg-card shrink-0 space-y-3 shadow-lg">
            {/* Calculation Figures */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>{strings.pos.subtotal}</span>
                <span className="font-mono tabular-nums">{formatMoney(cartTotals.grossMinor)}</span>
              </div>

              {/* Bill Discount Row */}
              <div className="flex justify-between items-center text-muted-foreground">
                <button
                  type="button"
                  onClick={() => setIsBillDiscountOpen(true)}
                  className="flex items-center gap-1.5 hover:text-primary transition-colors font-medium text-xs rounded hover:bg-muted/60 px-1 py-0.5 -ml-1 cursor-pointer"
                  title={locale === "bn" ? "পুরো বিলে ছাড় দিতে ক্লিক করুন" : "Click to apply bill discount"}
                >
                  <Tag className="h-3 w-3 text-primary" />
                  <span className="underline decoration-dotted underline-offset-2">{strings.pos.billDiscount}</span>
                  {billDiscount ? (
                    <span className="text-[10px] text-primary font-mono font-bold bg-primary/10 px-1 rounded">
                      (
                      {billDiscount.type === "percent"
                        ? `${billDiscount.percentBp! / 100}%`
                        : `৳${(billDiscount.amountMinor! / 100).toFixed(0)}`}
                      )
                    </span>
                  ) : (
                    <span className="text-[10px] text-primary/80 font-medium">
                      (+ {locale === "bn" ? "যোগ করুন" : "Add"})
                    </span>
                  )}
                </button>
                <span className="font-mono tabular-nums text-foreground">
                  {cartTotals.totalDiscountMinor > 0
                    ? `-${formatMoney(cartTotals.totalDiscountMinor)}`
                    : "—"}
                </span>
              </div>

              {/* Tax Row */}
              <div className="flex justify-between text-muted-foreground">
                <span>
                  {strings.pos.tax} {posConfig.pricesIncludeTax ? `(${locale === "bn" ? "অন্তর্ভুক্ত" : "Included"})` : ""}
                </span>
                <span className="font-mono tabular-nums">{formatMoney(cartTotals.taxMinor)}</span>
              </div>

              {/* Exchange Credit Line if active */}
              {exchangeContext && (
                <div className="flex justify-between text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 p-1.5 rounded border border-amber-200 dark:border-amber-800">
                  <span>{locale === "bn" ? "ফেরত বাবদ সমন্বয়:" : "Return Credit:"}</span>
                  <span className="font-mono tabular-nums font-semibold">-{formatMoney(exchangeReturnCreditMinor)}</span>
                </div>
              )}

              {/* Grand Total */}
              <div className="flex justify-between items-baseline pt-2 border-t border-border">
                <span className="text-base font-bold text-foreground">
                  {exchangeContext
                    ? exchangeDifferenceMinor < 0
                      ? locale === "bn" ? "গ্রাহককে ফেরত" : "Refund to Customer"
                      : locale === "bn" ? "নিট প্রদেয়" : "Net Payable"
                    : strings.pos.payable}
                </span>
                <span className={`text-2xl font-black font-mono tabular-nums ${exchangeContext && exchangeDifferenceMinor < 0 ? "text-amber-600 dark:text-amber-400" : "text-primary"}`}>
                  {formatMoney(Math.abs(exchangeDifferenceMinor))}
                </span>
              </div>
            </div>

            {/* Big Checkout Button (F4) */}
            {!activeShift && cartItems.length > 0 && (
              <div className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs font-medium text-amber-700 dark:text-amber-400 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  {locale === "bn"
                    ? "পেমেন্ট নিতে প্রথমে শিফট শুরু করুন।"
                    : "Please start a shift to take payment."}
                </span>
              </div>
            )}
            <Button
              type="button"
              onClick={() => {
                if (!activeShift) {
                  setIsOpenShiftOpen(true);
                  return;
                }
                setIsPaymentOpen(true);
              }}
              disabled={cartItems.length === 0 || !isOnline || isCompletingSale}
              data-testid="pos-checkout-button"
              className="w-full h-12 text-base font-bold tracking-wide shadow-md"
            >
              <CreditCard className="h-5 w-5 mr-2" />
              <span>
                {!activeShift
                  ? (locale === "bn" ? "শিফট শুরু করে পেমেন্ট নিন (F4)" : "Start Shift & Pay (F4)")
                  : strings.pos.checkout}
              </span>
            </Button>
          </div>
        </aside>
      </main>

      {/* --- ALL POS MODALS & DIALOGS --- */}

      {/* 1. Payment Dialog (F4) */}
      <PaymentDialog
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        totalPayableMinor={exchangeContext ? exchangeDifferenceMinor : cartTotals.expectedTotalMinor}
        isExchange={Boolean(exchangeContext)}
        onCompleteSale={handleCompleteSale}
        isSubmitting={isCompletingSale}
        customer={
          selectedCustomer.id
            ? {
                id: selectedCustomer.id,
                name: selectedCustomer.name,
                phone: selectedCustomer.phone || "",
                creditLimitMinor:
                  customerBalance?.creditLimitMinor ?? Number(selectedCustomer.creditLimitMinor || 0),
              }
            : null
        }
        canSellCredit={hasPermission("sale.credit")}
        customerDueMinor={
          customerBalance?.currentDueMinor ?? Number(selectedCustomer.currentDueMinor || 0)
        }
      />

      {/* Return & Exchange Modal (F6) */}
      <ReturnModal
        isOpen={isReturnOpen}
        onClose={() => {
          setIsReturnOpen(false);
          setInitialReturnInvoice("");
        }}
        shiftId={activeShift?.id || ""}
        branchId={currentBranch?.id || ""}
        drawerCashMinor={
          activeShift
            ? Number(activeShift.summary?.expectedCashMinor ?? activeShift.openingCashMinor ?? 0)
            : 0
        }
        initialInvoiceNumber={initialReturnInvoice}
        onStartExchange={(origSale, returnItems, reason, overrideReason) => {
          const retRefundMinor = returnItems.reduce(
            (s, it) => s + it.estimatedLineRefundMinor,
            0,
          );
          setExchangeContext({
            originalSale: origSale,
            returnItems,
            returnRefundMinor: retRefundMinor,
            reason,
            overrideReason,
          });
        }}
        onReturnCompleted={() => {
          checkRegisterShift();
        }}
      />

      {/* 2. Open Shift Dialog */}
      <OpenShiftDialog
        isOpen={isOpenShiftOpen}
        registerName={selectedRegister?.name || "Register"}
        onOpenShift={handleOpenShift}
        isSubmitting={isShiftSubmitting}
      />

      {/* 3. Shift In Use Alert */}
      <ShiftInUseAlert
        isOpen={Boolean(shiftInUseOtherUser)}
        registerName={selectedRegister?.name || "Register"}
        cashierName={shiftInUseOtherUser?.cashierUser?.name || "Another Cashier"}
        onSwitchRegister={() => {
          setShiftInUseOtherUser(null);
          const other = registers.find((r: any) => r.id !== selectedRegister?.id);
          if (other) {
            handleSelectRegister(other);
          }
        }}
      />

      {/* 4. Cash Movement Dialog */}
      <CashMovementDialog
        isOpen={isCashMoveOpen}
        onClose={() => setIsCashMoveOpen(false)}
        onSubmitMovement={handleCashMovement}
        isSubmitting={isShiftSubmitting}
      />

      {/* 5. Close Shift Dialog */}
      <CloseShiftDialog
        isOpen={isCloseShiftOpen}
        onClose={() => setIsCloseShiftOpen(false)}
        shiftData={activeShift}
        onConfirmClose={handleCloseShift}
        isSubmitting={isShiftSubmitting}
      />

      {/* 6. Customer Dialog (F9) */}
      <CustomerDialog
        isOpen={isCustomerOpen}
        onClose={() => setIsCustomerOpen(false)}
        onSelectCustomer={setSelectedCustomer}
        apiFetch={apiFetch}
      />

      {/* 7. Variant Picker Matrix Modal */}
      <VariantPickerModal
        isOpen={Boolean(selectedProductForVariants)}
        onClose={() => setSelectedProductForVariants(null)}
        product={selectedProductForVariants}
        branchId={currentBranch?.id || ""}
        onSelectVariant={(variant, prod) => handleAddToCart(variant, prod, 1)}
      />

      {/* 8. Hold Cart Dialog (F8) */}
      <HoldCartDialog
        isOpen={isHoldCartOpen}
        onClose={() => setIsHoldCartOpen(false)}
        activeCart={{
          saleId,
          items: cartItems,
          customerId: selectedCustomer.id,
          customerName: selectedCustomer.name,
          customerPhone: selectedCustomer.phone,
          billDiscount,
          notes: saleNotes,
          updatedAt: new Date().toISOString(),
        }}
        heldCarts={heldCarts}
        onHoldCurrentCart={handleHoldCart}
        onResumeCart={handleResumeCart}
        onRemoveHeldCart={handleRemoveHeld}
      />

      {/* 9. Shift Sales Modal */}
      <ShiftSalesModal
        isOpen={isShiftSalesOpen}
        onClose={() => setIsShiftSalesOpen(false)}
        sales={activeShift?.sales || []}
        canVoid={hasPermission("sale.void")}
        onReprintReceipt={(sale) => {
          setIsShiftSalesOpen(false);
          setActiveReceipt({
            saleId: sale.id,
            invoiceNumber: sale.invoiceNumber,
            createdAt: sale.createdAt,
            cashierName: sale.cashierUser?.name || user?.name || "Cashier",
            registerName: selectedRegister?.name || "Register",
            branchName: currentBranch?.name || "Branch",
            customerName: sale.customer?.name,
            customerPhone: sale.customer?.phone,
            shopName: posConfig.shopName,
            receiptHeader: posConfig.receiptHeader,
            receiptFooter: posConfig.receiptFooter,
            items: (sale.items || []).map((it: any) => ({
              name: it.variant?.product?.name || it.name || "Item",
              sku: it.variant?.sku || "",
              quantity: Number(it.quantity),
              unitPriceMinor: Number(it.unitPriceMinor),
              grossMinor: Number(it.subtotalMinor || it.unitPriceMinor * it.quantity),
              discountMinor: Number(it.discountMinor || 0),
              taxMinor: Number(it.taxMinor || 0),
              totalMinor: Number(it.totalMinor || it.unitPriceMinor * it.quantity),
            })),
            grossMinor: Number(sale.subtotalMinor),
            discountMinor: Number(sale.discountMinor),
            taxMinor: Number(sale.taxMinor),
            totalMinor: Number(sale.totalMinor),
            paidMinor: Number(sale.paidMinor),
            changeMinor: Number(sale.changeMinor),
            payments: sale.payments || [],
          });
        }}
        onVoidSale={handleVoidSale}
        timezone={posConfig.timezone}
      />

      {/* 10. Line Discount Modal */}
      {editingDiscountLineIdx !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-card border border-border w-full max-w-xs rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in"
          >
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-sm">{strings.pos.lineDiscount}</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEditingDiscountLineIdx(null)}
                className="h-7 w-7 rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleApplyLineDiscount} className="space-y-3">
              <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg text-xs">
                <Button
                  type="button"
                  variant={lineDiscountType === "percent" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setLineDiscountType("percent")}
                  className="h-7 text-xs"
                >
                  % {locale === "bn" ? "শতাংশ" : "Percent"}
                </Button>
                <Button
                  type="button"
                  variant={lineDiscountType === "fixed" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setLineDiscountType("fixed")}
                  className="h-7 text-xs"
                >
                  ৳ {locale === "bn" ? "টাকা" : "Amount"}
                </Button>
              </div>

              <Input
                type="number"
                min="0"
                step="any"
                value={lineDiscountVal}
                onChange={(e) => setLineDiscountVal(e.target.value)}
                placeholder={lineDiscountType === "percent" ? "10%" : "৳100"}
                className="h-9 text-xs font-mono"
                data-testid="line-discount-input"
                autoFocus
              />

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLineDiscountVal("");
                    handleApplyLineDiscount({ preventDefault: () => {} } as any);
                  }}
                  className="h-8 text-xs"
                >
                  {strings.pos.clearCart}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  data-testid="apply-line-discount-button"
                  className="h-8 text-xs font-semibold"
                >
                  {locale === "bn" ? "প্রয়োগ করুন" : "Apply"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 11. Bill Discount Modal */}
      {isBillDiscountOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-card border border-border w-full max-w-xs rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in"
          >
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-sm">{strings.pos.billDiscount}</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsBillDiscountOpen(false)}
                className="h-7 w-7 rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleApplyBillDiscount} className="space-y-3">
              <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg text-xs">
                <Button
                  type="button"
                  variant={billDiscountType === "percent" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setBillDiscountType("percent")}
                  className="h-7 text-xs"
                >
                  % {locale === "bn" ? "শতাংশ" : "Percent"}
                </Button>
                <Button
                  type="button"
                  variant={billDiscountType === "fixed" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setBillDiscountType("fixed")}
                  className="h-7 text-xs"
                >
                  ৳ {locale === "bn" ? "টাকা" : "Amount"}
                </Button>
              </div>

              <Input
                type="number"
                min="0"
                step="any"
                value={billDiscountVal}
                onChange={(e) => setBillDiscountVal(e.target.value)}
                placeholder={billDiscountType === "percent" ? "10%" : "৳100"}
                className="h-9 text-xs font-mono"
                data-testid="bill-discount-input"
                autoFocus
              />

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setBillDiscount(undefined);
                    setIsBillDiscountOpen(false);
                  }}
                  className="h-8 text-xs"
                >
                  {strings.pos.clearCart}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  data-testid="apply-bill-discount-button"
                  className="h-8 text-xs font-semibold"
                >
                  {locale === "bn" ? "প্রয়োগ করুন" : "Apply"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 12. Unit Price Override Modal */}
      {editingPriceLineIdx !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-card border border-border w-full max-w-xs rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in"
          >
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-sm">{strings.pos.priceOverride}</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEditingPriceLineIdx(null)}
                className="h-7 w-7 rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleApplyPriceOverride} className="space-y-3">
              <div className="relative">
                <span className="absolute left-2.5 top-2 text-xs font-semibold text-muted-foreground">
                  ৳
                </span>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={overridePriceVal}
                  onChange={(e) => setOverridePriceVal(e.target.value)}
                  placeholder="0.00"
                  className="pl-7 h-9 text-xs font-mono font-medium"
                  data-testid="price-override-input"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingPriceLineIdx(null)}
                  className="h-8 text-xs"
                >
                  {strings.common.cancel}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  data-testid="apply-price-override-button"
                  className="h-8 text-xs font-semibold"
                >
                  {strings.common.save}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 13. Keyboard Shortcuts Modal */}
      {isShortcutsOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-4 animate-in fade-in"
          >
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Keyboard className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-base">{strings.pos.shortcuts}</h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsShortcutsOpen(false)}
                className="h-8 w-8 rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border flex justify-between items-center">
                <span>{locale === "bn" ? "অনুসন্ধান বক্স" : "Focus Search"}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono font-bold">F2</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border flex justify-between items-center">
                <span>{locale === "bn" ? "পেমেন্ট / চেকআউট" : "Payment"}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono font-bold">F4</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border flex justify-between items-center">
                <span>{locale === "bn" ? "কার্ট হোল্ড / রিস্টোর" : "Hold / Resume"}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono font-bold">F8</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border flex justify-between items-center">
                <span>{locale === "bn" ? "ক্রেতা নির্বাচন" : "Customer Select"}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono font-bold">F9</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border flex justify-between items-center">
                <span>{locale === "bn" ? "ডায়ালগ বন্ধ" : "Close Dialog"}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono font-bold">Esc</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border flex justify-between items-center">
                <span>{locale === "bn" ? "নতুন বিক্রি (রসিদ)" : "New Sale"}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono font-bold">Enter</kbd>
              </div>
            </div>

            <div className="pt-2 text-right">
              <Button size="sm" onClick={() => setIsShortcutsOpen(false)} className="h-8 px-4">
                {locale === "bn" ? "বুঝেছি" : "Got it"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
