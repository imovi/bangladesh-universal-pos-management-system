"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { FailedSyncModal } from "@/components/pos/failed-sync-modal";
import { PinUnlockModal } from "@/components/pos/pin-unlock-modal";
import { ServiceWorkerPrompt } from "@/components/pos/service-worker-prompt";
import { saveOfflinePinVerifier } from "@/lib/pos/offline/pin-verifier";
import {
  db,
  initPersistentStorage,
  getNextOfflineInvoiceNumber,
  getServerClockOffset,
  clampSaleTime,
  enqueueSale,
  runSync,
  startSyncWorker,
  stopSyncWorker,
  getOutboxStats,
  acquireRegisterTabLock,
  isSignOutAllowed,
  syncCatalog,
} from "@/lib/pos/offline";
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
  Sun,
  Moon,
  Keyboard,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  X,
  CreditCard,
  RotateCcw,
  ChevronDown,
  MoreHorizontal,
  LogOut,
} from "lucide-react";

const ONLINE_SALE_TIMEOUT_MS = 6000;

export default function PosPage() {
  const router = useRouter();
  const { user, currentBranch, apiFetch, hasPermission, logout, isLoading: isAuthLoading } = useAuth();
  const { strings, locale, setLocale } = useTranslation();
  const { theme, setTheme } = useTheme();

  // Network & Online state
  const [isOnline, setIsOnline] = useState(true);
  const [isServerReachable, setIsServerReachable] = useState(true);
  const isEffectivelyOnline = isOnline && isServerReachable;

  const checkServerHealth = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!window.navigator.onLine) {
      setIsServerReachable(false);
      return;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await apiFetch("/health", {
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timer);
      if (res && res.ok) {
        setIsServerReachable(true);
      } else {
        setIsServerReachable(false);
      }
    } catch {
      setIsServerReachable(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__checkServerHealth = checkServerHealth;
    }
    checkServerHealth();
    const interval = setInterval(checkServerHealth, 15000);
    return () => {
      if (typeof window !== "undefined") {
        delete (window as any).__checkServerHealth;
      }
      clearInterval(interval);
    };
  }, [checkServerHealth]);

  const [outboxStats, setOutboxStats] = useState({ pending: 0, syncing: 0, synced: 0, failed: 0 });
  const [isFailedSyncModalOpen, setIsFailedSyncModalOpen] = useState(false);
  const [isTabLockedOut, setIsTabLockedOut] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{ message: string; type: "info" | "success" | "warning" } | null>(null);
  const [isPinUnlockOpen, setIsPinUnlockOpen] = useState(false);
  const [signOutBlockedBanner, setSignOutBlockedBanner] = useState<string | null>(null);

  // Initialize demo offline PIN verifier online, or trigger unlock modal if offline reload
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (navigator.onLine && user?.id) {
      saveOfflinePinVerifier(user.id, "1234").catch(() => {});
    }
    if (!navigator.onLine) {
      const isUnlocked = sessionStorage.getItem("pos_session_unlocked");
      if (!isUnlocked) {
        setIsPinUnlockOpen(true);
      }
    }
  }, [user?.id]);

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
  const checkRegisterShiftRef = useRef<() => Promise<void>>(async () => {});
  const loadLocalShiftSalesRef = useRef<() => Promise<void>>(async () => {});

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
  const [loyaltySettings, setLoyaltySettings] = useState<any>(null);

  useEffect(() => {
    apiFetch("/settings/loyalty")
      .then((r) => r.json())
      .then((data) => {
        const s = data.data || data;
        if (s && s.isEnabled !== undefined) {
          setLoyaltySettings(s);
        }
      })
      .catch(() => {});
  }, [apiFetch]);

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

    apiFetch(`/customers/${selectedCustomer.id}`)
      .then((r) => r.json())
      .then((data) => {
        const c = data.data || data;
        if (active && c && c.loyaltyPointsBalance !== undefined) {
          setSelectedCustomer((prev) => ({
            ...prev,
            loyaltyPointsBalance: c.loyaltyPointsBalance,
          }));
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
  const [localShiftSales, setLocalShiftSales] = useState<any[]>([]);
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
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<PosProduct | null>(null);
  const [isWideScreen, setIsWideScreen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 1440px)");
    setIsWideScreen(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsWideScreen(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cashierMenuRef.current && !cashierMenuRef.current.contains(e.target as Node)) {
        setIsCashierMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    if (isCashierMenuOpen || isMoreMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCashierMenuOpen, isMoreMenuOpen]);
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

  // Promotions & Coupon
  const [activePromotions, setActivePromotions] = useState<any[]>([]);
  const [couponCode, setCouponCode] = useState<string>("");

  const mappedPromotions = useMemo(() => {
    return activePromotions.map((p) => {
      const promoCoupons = p.coupons || [];
      const validCodes = promoCoupons
        .filter((c: any) => {
          if (!c.isActive) return false;
          if (!isEffectivelyOnline) {
            return c.usageLimitTotal === null && c.usageLimitPerCustomer === null;
          }
          return true;
        })
        .map((c: any) => c.code.toUpperCase());

      const isCouponRequired = Boolean((p.conditions as any)?.couponRequired || promoCoupons.length > 0);
      const explicitCodes = (p.conditions as any)?.couponCodes || [];
      const allCodes = Array.from(new Set([...validCodes, ...explicitCodes.map((c: string) => c.toUpperCase())]));
      return {
        ...p,
        couponRequired: isCouponRequired,
        couponCodes: allCodes.length > 0 ? allCodes : undefined,
      };
    });
  }, [activePromotions, isEffectivelyOnline]);

  const isOfflineCouponLimited = useMemo(() => {
    if (isEffectivelyOnline || !couponCode.trim()) return false;
    const upper = couponCode.trim().toUpperCase();
    for (const p of activePromotions) {
      const coupons = p.coupons || [];
      for (const c of coupons) {
        if (c.code.toUpperCase() === upper) {
          if (c.usageLimitTotal !== null || c.usageLimitPerCustomer !== null) {
            return true;
          }
        }
      }
    }
    return false;
  }, [isEffectivelyOnline, couponCode, activePromotions]);

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
    promotions: mappedPromotions,
    couponCode: couponCode.trim() || undefined,
    customerId: selectedCustomer?.id,
    branchId: currentBranch?.id,
    allowPromotionOverride: hasPermission("promotion.override"),
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

  // Initialize storage persistence & outbox stats
  useEffect(() => {
    initPersistentStorage();
    getOutboxStats().then(setOutboxStats).catch(() => {});
  }, []);

  // Background sync worker
  useEffect(() => {
    startSyncWorker(
      {
        customSender: async (item) => {
          const endpoint = item.type === "sale" ? "/sales" : "/customers";
          try {
            const res = await apiFetch(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": item.idempotencyKey,
                "x-idempotency-key": item.idempotencyKey,
              },
              body: JSON.stringify(item.payload),
            });
            let body: any = null;
            try {
              body = await res.json();
            } catch {}
            return {
              status: res.status,
              body,
              error: !res.ok ? (body?.message || `HTTP ${res.status}`) : undefined,
            };
          } catch (err: any) {
            return {
              status: 0,
              error: err?.message || "Network request failed",
            };
          }
        },
        onStatusChange: (stats) => {
          setOutboxStats(stats);
        },
        onSyncCompleted: (result) => {
          if (result.synced > 0) {
            checkRegisterShiftRef.current?.();
            loadLocalShiftSalesRef.current?.();
          }
        },
      },
      5000
    );

    return () => {
      stopSyncWorker();
    };
  }, [apiFetch]);

  // Online / Offline listeners & auto-sync trigger
  useEffect(() => {
    setIsOnline(typeof window !== "undefined" ? window.navigator.onLine : true);

    const handleOnline = () => {
      setIsOnline(true);
      checkServerHealth();
      runSync({
        forceImmediate: true,
        customSender: async (item) => {
          const endpoint = item.type === "sale" ? "/sales" : "/customers";
          try {
            const res = await apiFetch(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": item.idempotencyKey,
                "x-idempotency-key": item.idempotencyKey,
              },
              body: JSON.stringify(item.payload),
            });
            let body: any = null;
            try {
              body = await res.json();
            } catch {}
            return {
              status: res.status,
              body,
              error: !res.ok ? (body?.message || `HTTP ${res.status}`) : undefined,
            };
          } catch (err: any) {
            return {
              status: 0,
              error: err?.message || "Network request failed",
            };
          }
        },
        onStatusChange: (stats) => {
          setOutboxStats(stats);
        },
        onSyncCompleted: (result) => {
          if (result.synced > 0) {
            checkRegisterShiftRef.current?.();
            loadLocalShiftSalesRef.current?.();
            setStatusBanner({
              message: strings.pos.allSalesSyncedToast,
              type: "success",
            });
            setTimeout(() => setStatusBanner(null), 4000);
          }
        },
      }).catch(() => {});
    };

    const handleOffline = () => {
      setIsOnline(false);
      setIsServerReachable(false);
      setStatusBanner({
        message: strings.pos.offlineModeToast,
        type: "warning",
      });
      setTimeout(() => setStatusBanner(null), 4000);
    };

    (window as any).__triggerPosSync = handleOnline;
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      delete (window as any).__triggerPosSync;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [apiFetch, strings.pos]);

  // Tab lock per register
  useEffect(() => {
    if (!selectedRegister?.id) return;
    let cancelled = false;
    let lockHandle: any = null;

    acquireRegisterTabLock(selectedRegister.id, () => {
      if (!cancelled) setIsTabLockedOut(true);
    }).then((handle) => {
      if (cancelled) {
        handle.release();
        return;
      }
      lockHandle = handle;
      setIsTabLockedOut(!handle.hasLock);
    });

    return () => {
      cancelled = true;
      if (lockHandle) {
        lockHandle.release();
      }
    };
  }, [selectedRegister?.id]);

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

  // Load unsynced sales from local IndexedDB for current shift
  const loadLocalShiftSales = useCallback(async () => {
    try {
      if (!activeShift?.id) {
        setLocalShiftSales([]);
        return;
      }
      const allLocal = await db.localSales.toArray();
      const serverIds = new Set((activeShift.sales || []).map((s: any) => s.id));
      const serverInvoices = new Set((activeShift.sales || []).map((s: any) => s.invoiceNumber));

      const unsyncedForShift = allLocal
        .filter((ls) => {
          if (ls.shiftId && ls.shiftId !== activeShift.id) return false;
          if (serverIds.has(ls.id)) return false;
          if (ls.serverInvoiceNumber && serverInvoices.has(ls.serverInvoiceNumber)) return false;
          if (ls.offlineInvoiceNumber && serverInvoices.has(ls.offlineInvoiceNumber)) return false;
          if (serverInvoices.has(ls.invoiceNumber)) return false;
          return ls.status === "unsynced" || !ls.serverInvoiceNumber;
        })
        .map((ls) => {
          const payload = ls.saleData;
          return {
            id: ls.id,
            invoiceNumber: ls.offlineInvoiceNumber || ls.invoiceNumber,
            totalMinor: payload.expectedTotalMinor,
            createdAt: new Date(ls.createdAt).toISOString(),
            status: "completed",
            isUnsynced: true,
            customer: payload.customerId
              ? { name: strings.pos.walkInCustomer, id: payload.customerId }
              : null,
            payments: payload.payments,
            items: payload.items,
          };
        });
      setLocalShiftSales(unsyncedForShift);
    } catch {
      setLocalShiftSales([]);
    }
  }, [activeShift, strings.pos.walkInCustomer]);

  // Refresh shift sales list when opened
  useEffect(() => {
    checkRegisterShiftRef.current = checkRegisterShift;
    loadLocalShiftSalesRef.current = loadLocalShiftSales;
  });

  useEffect(() => {
    if (isShiftSalesOpen) {
      checkRegisterShift();
      loadLocalShiftSales();
    }
  }, [isShiftSalesOpen, checkRegisterShift, loadLocalShiftSales]);

  // Combined shift sales (unsynced local sales at top + server sales)
  const combinedShiftSales = useMemo(() => {
    const serverSales = (activeShift?.sales || []).map((s: any) => ({
      ...s,
      isUnsynced: false,
    }));
    return [...localShiftSales, ...serverSales];
  }, [activeShift?.sales, localShiftSales]);

  // Load Products & Categories for Branch (Local IndexedDB as source of truth)
  const loadCatalog = useCallback(async () => {
    const branchId = currentBranch?.id || user?.branches?.[0]?.id;
    if (!branchId) return;

    // 1. Immediately render cached catalog from Dexie if available
    try {
      const cached = await db.catalog.toArray();
      if (cached.length > 0) {
        setProducts(cached as any);
      }
      const cachedPromoSetting = await db.settings.get("cachedPromotions");
      if (cachedPromoSetting && Array.isArray(cachedPromoSetting.value)) {
        setActivePromotions(cachedPromoSetting.value);
      }
    } catch {}

    // 2. If online, perform catalog delta sync
    if (typeof window !== "undefined" && navigator.onLine) {
      let syncSucceeded = false;
      try {
        const result = await syncCatalog({
          branchId,
          customFetcher: async (url, init) => {
            const path = url.replace(/^https?:\/\/[^/]+(\/api\/v1)?/, "");
            return apiFetch(path, init);
          },
        });
        if (result.success) {
          const updated = await db.catalog.toArray();
          if (updated.length > 0) {
            setProducts(updated as any);
            syncSucceeded = true;
          }
          const promoSetting = await db.settings.get("cachedPromotions");
          if (promoSetting && Array.isArray(promoSetting.value)) {
            setActivePromotions(promoSetting.value);
          }
        }
      } catch {}

      try {
        const promoRes = await apiFetch("/promotions?status=active");
        if (promoRes.ok) {
          const promoJson = await promoRes.json();
          const pList = Array.isArray(promoJson.data)
            ? promoJson.data
            : Array.isArray(promoJson.data?.data)
            ? promoJson.data.data
            : [];
          setActivePromotions(pList);
          await db.settings.put({ key: "cachedPromotions", value: pList });
        }
      } catch {}

      if (!syncSucceeded) {
        // Fallback to legacy endpoint if catalog sync fails or yields empty
        try {
          const prodUrl = `/products?branchId=${branchId}&limit=100`;
          const prodRes = await apiFetch(prodUrl);
          if (prodRes.ok) {
            const data = await prodRes.json();
            setProducts(data.data || []);
          }
        } catch {}
      }
    }

    // Categories
    try {
      const catRes = await apiFetch(`/categories`);
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

      // F6: Returns & Exchanges (Only allowed when online and server reachable)
      if (e.key === "F6") {
        e.preventDefault();
        if (activeShift && !activeReceipt && isEffectivelyOnline) {
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
  }, [cartItems.length, activeShift, activeReceipt, isEffectivelyOnline]);

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

    // UNIFIED OUTBOX SELLING PATH (Online & Offline alike)
    const nowOffset = await getServerClockOffset();
    const rawOccurredAt = Date.now() + nowOffset;
    const shiftOpenedAtMs = new Date(activeShift.openedAt).getTime();
    const shiftClosedAtMs = activeShift.closedAt ? new Date(activeShift.closedAt).getTime() : undefined;
    const clampedOccurredAt = clampSaleTime(rawOccurredAt, shiftOpenedAtMs, shiftClosedAtMs, Date.now() + 60_000);

    const counterResult = await getNextOfflineInvoiceNumber({
      registerId: selectedRegister.id,
      registerCode: selectedRegister.code || "REG01",
      timeZone: posConfig.timezone,
      timestampMs: clampedOccurredAt,
    });
    const assignedInvoiceNumber = counterResult.invoiceNumber;
    const isActuallyOffline = !isEffectivelyOnline;

    let currentCatalogVersion: string | undefined = undefined;
    try {
      const cv = await db.settings.get("catalogVersion");
      if (cv && cv.value !== undefined && cv.value !== null) {
        currentCatalogVersion = String(cv.value);
      }
    } catch {}

    const pointsPayment = payments.find((p) => p.paymentMethod === "points");
    const pointsRedeemed = (pointsPayment && loyaltySettings?.pointValueMinor)
      ? Math.floor(pointsPayment.amountMinor / (loyaltySettings.pointValueMinor || 100))
      : undefined;

    const salePayload = {
      id: saleId,
      shiftId: activeShift.id,
      branchId: currentBranch.id,
      registerId: selectedRegister.id,
      invoiceNumber: assignedInvoiceNumber,
      occurredAt: new Date(clampedOccurredAt).toISOString(),
      isOffline: isActuallyOffline,
      catalogVersion: currentCatalogVersion,
      customerId: selectedCustomer.id || undefined,
      pointsRedeemed,
      billDiscount: billDiscount
        ? {
            type: billDiscount.type,
            amountMinor: billDiscount.amountMinor,
            percentBp: billDiscount.percentBp,
          }
        : undefined,
      billPromotionId: cartTotals.billPromotionId || null,
      billPromotionDiscountMinor: cartTotals.billPromotionDiscountMinor || 0,
      couponCode: couponCode.trim() ? couponCode.trim().toUpperCase() : null,
      items: cartItems.map((it, idx) => {
        const calcLine = cartTotals.lines[idx];
        return {
          variantId: it.variantId,
          productId: it.productId,
          quantity: it.quantity,
          overrideUnitPriceMinor: it.overrideUnitPriceMinor,
          unitPriceMinor: it.overrideUnitPriceMinor !== undefined ? it.overrideUnitPriceMinor : it.unitPriceMinor,
          discount: it.discount
            ? {
                type: it.discount.type,
                amountMinor: it.discount.amountMinor,
                percentBp: it.discount.percentBp,
              }
            : undefined,
          promotionId: calcLine?.promotionId || null,
          promotionDiscountMinor: calcLine?.promotionDiscountMinor || 0,
          promotionLabel: calcLine?.promotionLabel || null,
        };
      }),
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

    try {
      let serverInvoiceNumber: string | undefined = undefined;

      // 1. If effectively online, attempt direct send with ONLINE_SALE_TIMEOUT_MS (6 seconds)
      if (isEffectivelyOnline) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), ONLINE_SALE_TIMEOUT_MS);
          const res = await apiFetch("/sales", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": saleId,
              "x-idempotency-key": saleId,
            },
            body: JSON.stringify(salePayload),
            signal: controller.signal,
          });
          clearTimeout(timer);
          let body: any = null;
          try {
            body = await res.json();
          } catch {}
          if (res.ok) {
            const sInv = body?.data?.invoiceNumber || body?.invoiceNumber;
            if (sInv) {
              serverInvoiceNumber = sInv;
            }
          } else {
            checkServerHealth();
          }
        } catch (err) {
          console.warn("[POS] Online sale send timed out or network failed:", err);
          checkServerHealth();
        }
      }

      // 2. Rule: Whatever number is printed on the customer's receipt must be the number stored on the server.
      // A sale gets a server number only if the server answered before the receipt was shown.
      // Otherwise it is an offline sale, fixed before any retry:
      // - isOffline: true;
      // - the -O- number;
      // - occurredAt.
      if (serverInvoiceNumber) {
        // Online sale succeeded immediately before receipt
        await db.localSales.put({
          id: saleId,
          invoiceNumber: serverInvoiceNumber,
          serverInvoiceNumber,
          offlineInvoiceNumber: assignedInvoiceNumber,
          shiftId: activeShift.id,
          saleData: { ...salePayload, invoiceNumber: serverInvoiceNumber, isOffline: false } as any,
          status: "synced",
          createdAt: clampedOccurredAt,
        });
        // Decrement local Dexie stock to keep cache in sync
        for (const it of salePayload.items) {
          try {
            const cur = await db.stock.get(it.variantId);
            const newQty = (cur?.stockQty ?? 0) - it.quantity;
            await db.stock.put({
              variantId: it.variantId,
              stockQty: newQty,
              updatedAt: new Date().toISOString(),
            });

            const prodId = (it as any).productId;
            if (prodId) {
              const product = await db.catalog.get(prodId);
              if (product && product.variants) {
                const vIndex = product.variants.findIndex((v) => v.id === it.variantId);
                if (vIndex >= 0) {
                  product.variants[vIndex].stockQty = newQty;
                  const vAny = product.variants[vIndex] as any;
                  if (vAny.stockLevels && Array.isArray(vAny.stockLevels)) {
                    for (const sl of vAny.stockLevels) {
                      if (!sl.branchId || sl.branchId === currentBranch.id) {
                        sl.qty = String(newQty);
                      }
                    }
                  } else {
                    vAny.stockLevels = [{ branchId: currentBranch.id, qty: String(newQty) }];
                  }
                  await db.catalog.put(product);
                }
              }
            }
          } catch {}
        }
      } else {
        // Offline sale (either device was offline OR server was unreachable / timed out)
        salePayload.isOffline = true;
        salePayload.invoiceNumber = assignedInvoiceNumber;
        await enqueueSale(salePayload as any);
        getOutboxStats().then(setOutboxStats).catch(() => {});
        loadLocalShiftSales();
      }

      const displayInvoiceNumber = serverInvoiceNumber || assignedInvoiceNumber;
      const isReceiptOffline = !serverInvoiceNumber;

      // 3. Format receipt data
      const totalPaid = payments.reduce((sum, p) => sum + p.amountMinor, 0);

      const redeemedPts = (pointsPayment && loyaltySettings?.pointValueMinor)
        ? Math.floor(pointsPayment.amountMinor / (loyaltySettings.pointValueMinor || 100))
        : undefined;

      const nonPointsTotal = cartTotals.totalMinor - (pointsPayment?.amountMinor || 0);
      const earnedPts = (selectedCustomer.id && loyaltySettings?.isEnabled && !isActuallyOffline && nonPointsTotal > 0)
        ? Math.floor(nonPointsTotal / (loyaltySettings.earnRateMinor || 10000))
        : undefined;

      const currentCustPts = Number(selectedCustomer.loyaltyPointsBalance || 0);
      const newCustPts = selectedCustomer.id && loyaltySettings?.isEnabled
        ? currentCustPts - (redeemedPts || 0) + (earnedPts || 0)
        : undefined;

      if (newCustPts !== undefined) {
        setSelectedCustomer((prev) => ({
          ...prev,
          loyaltyPointsBalance: newCustPts,
        }));
      }

      const receiptData: ReceiptData = {
        saleId,
        invoiceNumber: displayInvoiceNumber,
        isOffline: isReceiptOffline,
        createdAt: new Date(clampedOccurredAt).toISOString(),
        cashierName: user?.name || "Cashier",
        registerName: selectedRegister?.name || "Register 1",
        branchName: currentBranch?.name || "Main Branch",
        branchAddress: currentBranch?.code ? `Branch: ${currentBranch.code}` : undefined,
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        shopName: posConfig.shopName,
        receiptHeader: posConfig.receiptHeader,
        receiptFooter: posConfig.receiptFooter,
        pointsEarned: earnedPts,
        pointsRedeemed: redeemedPts,
        newPointsBalance: newCustPts,
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
            promotionLabel: calcLine?.promotionLabel,
          };
        }),
        grossMinor: cartTotals.grossMinor,
        discountMinor: cartTotals.totalDiscountMinor,
        billPromotionLabel: cartTotals.billPromotionLabel,
        billPromotionDiscountMinor: cartTotals.billPromotionDiscountMinor,
        couponCode: couponCode.trim() ? couponCode.trim().toUpperCase() : undefined,
        taxMinor: cartTotals.taxMinor,
        totalMinor: cartTotals.totalMinor,
        paidMinor: totalPaid,
        changeMinor: Math.max(0, totalPaid - cartTotals.totalMinor),
        dueMinor: payments.find((p) => (p.paymentMethod as string) === "credit")?.amountMinor || 0,
        customerTotalDueMinor: selectedCustomer.id
          ? (customerBalance?.currentDueMinor ?? Number(selectedCustomer.currentDueMinor || 0)) +
            (payments.find((p) => (p.paymentMethod as string) === "credit")?.amountMinor || 0)
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
        const errMsg = data.error?.message || data.message || (locale === "bn" ? "শিফট বন্ধ করা যায়নি।" : "Failed to close shift");
        console.error("Failed to close shift:", errMsg);
        setServerErrorBanner(errMsg);
        throw new Error(errMsg);
      }
    } catch (err: any) {
      console.error("Failed to close shift:", err.message);
      setServerErrorBanner(err.message);
      throw err;
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
      <header className="h-14 border-b border-border bg-card px-2.5 sm:px-4 flex items-center justify-between shrink-0 select-none overflow-hidden flex-nowrap gap-2">
        {/* Left Zone: Shop, Branch, Register */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1 md:flex-initial shrink">
          <div className="flex items-center gap-1.5 text-primary shrink-0">
            <Store className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
            <h1 className="text-xs sm:text-sm font-bold truncate hidden lg:inline" title={posConfig.shopName}>
              {posConfig.shopName}
            </h1>
          </div>

          <div className="h-4 w-px bg-border hidden lg:block shrink-0" />

          {/* Branch Name */}
          <div className="min-w-0 shrink flex items-center">
            <span
              className="font-semibold text-xs text-foreground block truncate min-w-0 max-w-[75px] sm:max-w-[120px] md:max-w-[160px] lg:max-w-[200px]"
              title={`${currentBranch?.code ? currentBranch.code + " - " : ""}${currentBranch?.name || ""}`}
            >
              <span className="hidden xl:inline">{currentBranch?.code ? `${currentBranch.code} - ` : ""}</span>
              {currentBranch?.name}
            </span>
          </div>

          <span className="text-muted-foreground/50 shrink-0 select-none hidden sm:inline">•</span>

          {/* Register Selector */}
          <div className="min-w-0 shrink items-center hidden sm:flex">
            {registers.length > 0 ? (
              <select
                value={selectedRegister?.id || ""}
                onChange={(e) => {
                  const reg = registers.find((r) => r.id === e.target.value);
                  if (reg) handleSelectRegister(reg);
                }}
                aria-label={locale === "bn" ? "রেজিস্টার নির্বাচন" : "Select Register"}
                className="h-7 text-xs font-semibold bg-muted/50 border border-input rounded-md px-1.5 max-w-[95px] sm:max-w-[110px] md:max-w-[130px] xl:max-w-[180px] min-[1440px]:max-w-[280px] focus:outline-none focus:ring-1 focus:ring-primary truncate"
                data-testid="register-select"
                title={selectedRegister ? `${selectedRegister.name} (${selectedRegister.code})` : ""}
              >
                {registers.map((r) => (
                  <option key={r.id} value={r.id} title={`${r.name} (${r.code})`}>
                    {isWideScreen ? `${r.name} (${r.code})` : r.code}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-rose-500 font-semibold text-xs">{strings.pos.noRegisters}</span>
            )}
          </div>
        </div>

        {/* Middle Zone: Unified Shift + Cashier Pill */}
        <div className="flex items-center gap-1 sm:gap-2 shrink min-w-0 justify-center">
          {/* Unified Shift + Cashier Pill */}
          <div className="relative shrink min-w-0 max-w-[110px] sm:max-w-[150px] md:max-w-[190px] lg:max-w-[240px] xl:max-w-[300px]" ref={cashierMenuRef}>
            <button
              type="button"
              data-testid="cashier-name-block"
              onClick={() => setIsCashierMenuOpen((prev) => !prev)}
              className="flex items-center gap-1 sm:gap-1.5 h-8 px-2 sm:px-2.5 rounded-full border text-xs font-medium w-full max-w-full transition-colors bg-muted/40 hover:bg-muted/70 border-border/60 text-left min-w-0 shrink overflow-hidden"
              title={`${activeShift ? (locale === "bn" ? "শিফট চলমান" : "Shift Open") : (locale === "bn" ? "শিফট বন্ধ" : "Shift Closed")} · ${user.name}`}
            >
              {activeShift ? (
                <span
                  data-testid="shift-status-badge"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="hidden sm:inline">{locale === "bn" ? "শিফট " : "Shift "}</span>
                  <span>{locale === "bn" ? "চলমান" : "Open"}</span>
                </span>
              ) : (
                <span
                  data-testid="shift-status-badge"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-500 shrink-0"
                >
                  <Lock className="h-3 w-3" />
                  <span className="hidden sm:inline">{locale === "bn" ? "শিফট " : "Shift "}</span>
                  <span>{locale === "bn" ? "বন্ধ" : "Closed"}</span>
                </span>
              )}

              <span className="text-muted-foreground/40 shrink-0 select-none">·</span>

              <span
                data-testid="cashier-name"
                className="block truncate font-medium text-foreground min-w-0"
                title={user.name}
              >
                {user.name}
              </span>

              <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 opacity-70" />
            </button>

            {/* Dropdown Menu */}
            {isCashierMenuOpen && (
              <div
                data-testid="cashier-menu-dropdown"
                className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 w-64 bg-card border border-border rounded-xl shadow-xl p-3 z-50 text-xs space-y-2.5 animate-in fade-in"
              >
                <div className="border-b border-border pb-2">
                  <p className="font-semibold text-foreground truncate">{user.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    {user.roles?.join(", ") || (user.isOwner ? "Owner" : "Staff")}
                  </Badge>
                </div>

                <div className="space-y-1 text-[11px] border-b border-border pb-2">
                  <div className="flex justify-between items-center text-muted-foreground">
                    <span>{locale === "bn" ? "শিফট অবস্থা" : "Shift Status"}</span>
                    <span className="font-medium text-foreground">
                      {activeShift ? (locale === "bn" ? "চলমান" : "Open") : (locale === "bn" ? "বন্ধ" : "Closed")}
                    </span>
                  </div>
                  {activeShift && (
                    <div className="flex justify-between items-center text-muted-foreground">
                      <span>{locale === "bn" ? "শুরুর সময়" : "Opened At"}</span>
                      <span className="font-mono text-foreground">
                        {new Date(activeShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-muted-foreground pt-1">
                    <span>{strings.pos.discountLimit}</span>
                    <span
                      data-testid="cashier-discount-limit"
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-primary/10 text-primary border border-primary/20"
                    >
                      {user?.isOwner || user?.roles?.includes("Owner") || maxDiscountPercent === null
                        ? locale === "bn" ? "সীমাহীন" : "No limit"
                        : `${maxDiscountPercent}%`}
                    </span>
                  </div>
                </div>

                {canAccessAdmin && (
                  <Link
                    href="/dashboard"
                    onClick={() => setIsCashierMenuOpen(false)}
                    className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors text-foreground"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>{strings.pos.backToAdmin}</span>
                  </Link>
                )}

                <div className="border-t border-border pt-1">
                  <button
                    type="button"
                    data-testid="pos-signout-button"
                    onClick={async () => {
                      const stats = await getOutboxStats();
                      setOutboxStats(stats);
                      const unsyncedCount = stats.pending + stats.syncing;
                      if (!isSignOutAllowed(isEffectivelyOnline, unsyncedCount)) {
                        setSignOutBlockedBanner("অফলাইন বিক্রি বাকি থাকা অবস্থায় সাইন আউট করা যাবে না। সব বিক্রি পাঠানো পর্যন্ত অপেক্ষা করুন।");
                        setIsCashierMenuOpen(false);
                        setTimeout(() => setSignOutBlockedBanner(null), 6000);
                        return;
                      }
                      setIsCashierMenuOpen(false);
                      await logout();
                    }}
                    className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg border border-destructive/20 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>{locale === "bn" ? "সাইন আউট" : "Sign Out"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Zone: Actions, Held Carts, Menus */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Connection Status Pill with 4 states */}
          <div
            data-testid="connection-status-pill"
            onClick={() => {
              if (outboxStats.failed > 0) {
                setIsFailedSyncModalOpen(true);
              }
            }}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 transition-colors select-none ${
              outboxStats.failed > 0
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 cursor-pointer hover:bg-rose-500/20"
                : !isEffectivelyOnline
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                : (outboxStats.pending > 0 || outboxStats.syncing > 0)
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 animate-pulse"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
            }`}
            title={outboxStats.failed > 0 ? strings.pos.viewFailedSalesTooltip : undefined}
          >
            {outboxStats.failed > 0 ? (
              <span>{strings.pos.syncFailedCount.replace("{count}", String(outboxStats.failed))}</span>
            ) : !isEffectivelyOnline ? (
              <span>{strings.pos.offlinePill}</span>
            ) : (outboxStats.pending > 0 || outboxStats.syncing > 0) ? (
              <span>
                {strings.pos.syncingRemaining.replace("{count}", String(outboxStats.pending + outboxStats.syncing))}
              </span>
            ) : (
              <span>{strings.pos.onlinePill}</span>
            )}
          </div>

          {/* Core Shift Actions */}
          {activeShift ? (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCashMoveOpen(true)}
                disabled={!isEffectivelyOnline}
                className="h-8 px-2 text-xs font-medium disabled:opacity-50"
                data-testid="cash-movement-button"
                title={!isEffectivelyOnline ? strings.pos.availableWhenOnline : strings.pos.cashManagement}
                aria-label={strings.pos.cashManagement}
              >
                <ArrowRightLeft className="h-3.5 w-3.5 xl:mr-1" />
                <span className="hidden xl:inline">{strings.pos.cashManagement}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsShiftSalesOpen(true)}
                className="h-8 px-2 text-xs font-medium"
                data-testid="shift-sales-button"
                title={locale === "bn" ? "শিফট বিক্রি তালিকা" : "Shift Sales"}
                aria-label={locale === "bn" ? "শিফট বিক্রি তালিকা" : "Shift Sales"}
              >
                <Receipt className="h-3.5 w-3.5 xl:mr-1" />
                <span className="hidden xl:inline">{locale === "bn" ? "বিক্রি তালিকা" : "Sales"}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsReturnOpen(true)}
                disabled={!isEffectivelyOnline}
                className="h-8 px-2 text-xs font-medium text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 disabled:opacity-50"
                data-testid="pos-return-button"
                title={!isEffectivelyOnline ? strings.pos.availableWhenOnline : (locale === "bn" ? "পণ্য ফেরত / বদল (F6)" : "Returns & Exchanges (F6)")}
                aria-label={locale === "bn" ? "পণ্য ফেরত / বদল (F6)" : "Returns & Exchanges (F6)"}
              >
                <RotateCcw className="h-3.5 w-3.5 xl:mr-1" />
                <span className="hidden xl:inline">{locale === "bn" ? "ফেরত (F6)" : "Return (F6)"}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCloseShiftOpen(true)}
                disabled={!isEffectivelyOnline}
                className="h-8 px-2 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 disabled:opacity-50"
                data-testid="close-shift-button"
                title={!isEffectivelyOnline ? strings.pos.availableWhenOnline : strings.pos.closeShift}
                aria-label={strings.pos.closeShift}
              >
                <Lock className="h-3.5 w-3.5 xl:mr-1" />
                <span className="hidden xl:inline">{strings.pos.closeShift}</span>
              </Button>
            </div>
          ) : (
            selectedRegister && (
              <Button
                size="sm"
                onClick={() => setIsOpenShiftOpen(true)}
                className="h-8 px-2.5 text-xs font-semibold"
                data-testid="open-shift-button"
                title={strings.pos.openShift}
              >
                <Unlock className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">{strings.pos.openShift}</span>
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
            aria-label={strings.pos.holdCart}
          >
            <PauseCircle className="h-3.5 w-3.5" />
            {heldCarts.length > 0 && (
              <span
                data-testid="held-carts-badge"
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center"
              >
                {heldCarts.length}
              </span>
            )}
          </Button>

          {/* Full Screen / Desktop Actions (visible on xl and up) */}
          <div className="hidden xl:flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsShortcutsOpen(true)}
              aria-label={strings.pos.shortcuts}
              className="h-8 w-8 text-muted-foreground"
              title={strings.pos.shortcuts}
            >
              <Keyboard className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={locale === "bn" ? "থিম পরিবর্তন" : "Toggle theme"}
              className="h-8 w-8"
              title={locale === "bn" ? "থিম পরিবর্তন" : "Toggle theme"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocale(locale === "bn" ? "en" : "bn")}
              className="h-8 px-2 text-xs font-semibold"
              title={locale === "bn" ? "Switch to English" : "বাংলায় পরিবর্তন করুন"}
            >
              {locale === "bn" ? "EN" : "বাং"}
            </Button>

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

          {/* Overflow Menu for Narrow Screens (< xl) */}
          <div className="relative xl:hidden shrink-0" ref={moreMenuRef}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMoreMenuOpen((prev) => !prev)}
              aria-label={locale === "bn" ? "আরও অপশন" : "More options"}
              className="h-8 w-8 text-muted-foreground"
              title={locale === "bn" ? "আরও অপশন" : "More options"}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>

            {isMoreMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-48 bg-card border border-border rounded-xl shadow-xl p-2 z-50 text-xs space-y-1 animate-in fade-in">
                <button
                  type="button"
                  onClick={() => {
                    setIsShortcutsOpen(true);
                    setIsMoreMenuOpen(false);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg hover:bg-muted text-foreground text-left"
                >
                  <Keyboard className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{strings.pos.shortcuts}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTheme(theme === "dark" ? "light" : "dark");
                    setIsMoreMenuOpen(false);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg hover:bg-muted text-foreground text-left"
                >
                  {theme === "dark" ? <Sun className="h-3.5 w-3.5 text-muted-foreground" /> : <Moon className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span>{theme === "dark" ? (locale === "bn" ? "লাইট মোড" : "Light Mode") : (locale === "bn" ? "ডার্ক মোড" : "Dark Mode")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLocale(locale === "bn" ? "en" : "bn");
                    setIsMoreMenuOpen(false);
                  }}
                  className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg hover:bg-muted text-foreground text-left"
                >
                  <span>{locale === "bn" ? "ভাষা: বাংলা" : "Language: English"}</span>
                  <span className="font-semibold text-primary">{locale === "bn" ? "EN" : "বাং"}</span>
                </button>

                {canAccessAdmin && (
                  <div className="border-t border-border pt-1">
                    <Link
                      href="/dashboard"
                      onClick={() => setIsMoreMenuOpen(false)}
                      className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg hover:bg-muted text-foreground text-left"
                    >
                      <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{strings.pos.backToAdmin}</span>
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Tab lockout banner */}
      {isTabLockedOut && (
        <div data-testid="tab-lockout-banner" className="bg-rose-600 text-white px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{strings.pos.concurrentTabBlocked}</span>
        </div>
      )}

      {/* Non-blocking Status Toast/Banner */}
      {statusBanner && (
        <div
          role="status"
          aria-live="polite"
          className={`px-4 py-2 text-xs font-semibold flex items-center justify-between border-b transition-all ${
            statusBanner.type === "warning"
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
              : statusBanner.type === "success"
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
              : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30"
          }`}
        >
          <span>{statusBanner.message}</span>
          <button onClick={() => setStatusBanner(null)} className="text-xs hover:underline ml-2">
            ✕
          </button>
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

      {/* Sign-Out Blocked Offline Banner */}
      {signOutBlockedBanner && (
        <div
          data-testid="sign-out-blocked-banner"
          className="bg-rose-500/15 border-b border-rose-500/30 text-rose-700 dark:text-rose-400 px-4 py-2 text-xs font-semibold flex items-center justify-between animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{signOutBlockedBanner}</span>
          </div>
          <button onClick={() => setSignOutBlockedBanner(null)} className="text-xs hover:underline">
            ✕
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
              {Boolean(selectedCustomer.id) && (
                <span
                  className="ml-1.5 px-1.5 py-0.5 bg-primary/15 text-primary text-[10px] rounded font-mono font-semibold shrink-0"
                  data-testid="pos-customer-loyalty-pill"
                >
                  {selectedCustomer.loyaltyPointsBalance ?? 0} {strings.loyalty.pts}
                </span>
              )}
            </Button>

            {/* Hold, Return & Clear Cart Actions */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (isEffectivelyOnline) setIsReturnOpen(true);
              }}
              disabled={!isEffectivelyOnline}
              data-testid="pos-cart-return-button"
              className="h-8 px-2 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 hover:bg-amber-500/10 disabled:opacity-50 disabled:pointer-events-none"
              title={!isEffectivelyOnline ? strings.pos.availableWhenOnline : (locale === "bn" ? "পণ্য ফেরত বা বদল (F6)" : "Return / Exchange (F6)")}
              aria-label={!isEffectivelyOnline ? strings.pos.availableWhenOnline : (locale === "bn" ? "পণ্য ফেরত বা বদল (F6)" : "Return / Exchange (F6)")}
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
                          disabled={Boolean(calcLine?.promotionId && !hasPermission("promotion.override"))}
                          title={calcLine?.promotionId && !hasPermission("promotion.override") ? strings.promotions.conditions.stackableHelp : ""}
                          onClick={() => {
                            if (calcLine?.promotionId && !hasPermission("promotion.override")) return;
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

                      {calcLine?.promotionLabel && (
                        <div className="mt-1">
                          <Badge
                            data-testid={`line-promo-badge-${idx}`}
                            variant="secondary"
                            className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 text-[10px] px-1.5 py-0 font-normal"
                          >
                            <Tag className="h-2.5 w-2.5 inline mr-1" />
                            {calcLine.promotionLabel} ({strings.promotions.pos.badgeSaving} ৳{formatMoney(calcLine.promotionDiscountMinor)})
                          </Badge>
                        </div>
                      )}
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
            {/* Bill Threshold Hint Banner */}
            {cartTotals.billThresholdHint && (
              <div
                data-testid="bill-threshold-hint"
                className="p-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded text-xs text-emerald-800 dark:text-emerald-300 font-medium flex items-center justify-between"
              >
                <span>{cartTotals.billThresholdHint.hintText}</span>
              </div>
            )}

            {/* Coupon Code Input */}
            <div className="space-y-1">
              <div className="flex gap-2">
                <Input
                  data-testid="coupon-code-input"
                  placeholder={strings.promotions.coupon.placeholder}
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  className="h-7 text-xs font-mono uppercase"
                />
              </div>
              {isOfflineCouponLimited && couponCode.trim() ? (
                <div className="text-[11px] pt-0.5">
                  <span className="text-destructive font-medium text-[11px]" data-testid="coupon-offline-disabled-msg">
                    {strings.promotions.coupon.limitReached || "কুপনটিতে ব্যবহারের লিমিট থাকায় এটি অফলাইনে ব্যবহার করা যাবে না"}
                  </span>
                </div>
              ) : cartTotals.couponState && couponCode.trim() ? (
                <div className="text-[11px] pt-0.5">
                  {cartTotals.couponState.valid ? (
                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px]" data-testid="coupon-saving-badge">
                      {cartTotals.couponState.promotionName || cartTotals.couponState.code} ({strings.promotions.pos.badgeSaving} {formatMoney(cartTotals.couponState.savingMinor || 0)})
                    </Badge>
                  ) : (
                    <span className="text-destructive font-medium text-[11px]" data-testid="coupon-error-msg">
                      {cartTotals.couponState.invalidReason === "EXPIRED"
                        ? strings.promotions.coupon.expired
                        : cartTotals.couponState.invalidReason === "NOT_STARTED"
                        ? strings.promotions.coupon.notStarted
                        : cartTotals.couponState.invalidReason === "WRONG_BRANCH"
                        ? strings.promotions.coupon.wrongBranch
                        : cartTotals.couponState.invalidReason === "USAGE_LIMIT_EXCEEDED"
                        ? strings.promotions.coupon.limitReached
                        : cartTotals.couponState.invalidReason === "THRESHOLD_NOT_MET"
                        ? strings.promotions.coupon.thresholdNotMet
                        : strings.promotions.coupon.invalid}
                    </span>
                  )}
                </div>
              ) : null}
            </div>

            {/* Calculation Figures */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>{strings.pos.subtotal}</span>
                <span className="font-mono tabular-nums">{formatMoney(cartTotals.grossMinor)}</span>
              </div>

              {/* Bill Promotion Row */}
              {cartTotals.billPromotionDiscountMinor > 0 && (
                <div data-testid="bill-promotion-row" className="flex justify-between items-center text-emerald-600 dark:text-emerald-400 font-medium">
                  <span>{cartTotals.billPromotionLabel || strings.promotions.pos.billPromotion}</span>
                  <span className="font-mono tabular-nums">-{formatMoney(cartTotals.billPromotionDiscountMinor)}</span>
                </div>
              )}

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

              {/* Total Savings */}
              {cartTotals.totalDiscountMinor > 0 && (
                <div data-testid="total-savings-row" className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 font-semibold pt-0.5">
                  <span>{strings.promotions.pos.totalSavings}</span>
                  <span className="font-mono tabular-nums">৳{formatMoney(cartTotals.totalDiscountMinor)}</span>
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
                if (isTabLockedOut) {
                  return;
                }
                if (!activeShift) {
                  setIsOpenShiftOpen(true);
                  return;
                }
                setIsPaymentOpen(true);
              }}
              disabled={cartItems.length === 0 || isCompletingSale || isTabLockedOut}
              data-testid="pos-checkout-button"
              className="w-full h-12 text-base font-bold tracking-wide shadow-md"
            >
              <CreditCard className="h-5 w-5 mr-2" />
              <span>
                {!activeShift ? strings.pos.startShiftAndPay : strings.pos.checkout}
              </span>
            </Button>
          </div>
        </aside>
      </main>

      {/* --- ALL POS MODALS & DIALOGS --- */}

      {/* 1. Payment Dialog (F4) */}
      <PaymentDialog
        isOpen={isPaymentOpen}
        isOnline={isEffectivelyOnline}
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
        loyalty={
          loyaltySettings?.isEnabled
            ? {
                balance: Number(selectedCustomer.loyaltyPointsBalance ?? 0),
                pointValueMinor: Number(loyaltySettings.pointValueMinor ?? 100),
                minRedeemPoints: Number(loyaltySettings.minRedeemPoints ?? 0),
                maxBillSharePercent: Number(loyaltySettings.maxBillSharePercent ?? 50),
                isEnabled: Boolean(loyaltySettings.isEnabled),
              }
            : null
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
        sales={combinedShiftSales}
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
            grossMinor: Number(sale.subtotalMinor || sale.expectedTotalMinor || sale.totalMinor || 0),
            discountMinor: Number(sale.discountMinor || 0),
            taxMinor: Number(sale.taxMinor || 0),
            totalMinor: Number(sale.totalMinor || sale.expectedTotalMinor || 0),
            paidMinor: Number(sale.paidMinor || (sale.payments || []).reduce((s: number, p: any) => s + Number(p.amountMinor || 0), 0)),
            changeMinor: Number(sale.changeMinor || 0),
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
                <span>{locale === "bn" ? "পণ্য ফেরত / বদল" : "Returns & Exchanges"}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono font-bold">F6</kbd>
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
              <div className="col-span-2 p-2.5 rounded-lg bg-muted/40 border border-border flex justify-between items-center">
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

      {/* 13. Failed Outbox Sync Modal */}
      <FailedSyncModal
        isOpen={isFailedSyncModalOpen}
        onClose={() => setIsFailedSyncModalOpen(false)}
      />

      {/* 14. Offline PIN Unlock Modal */}
      <PinUnlockModal
        isOpen={isPinUnlockOpen}
        userName={user?.name || "ক্যাশিয়ার"}
        userId={user?.id}
        onUnlock={() => {
          if (typeof window !== "undefined") {
            sessionStorage.setItem("pos_session_unlocked", "true");
          }
          setIsPinUnlockOpen(false);
        }}
      />

      {/* 15. Service Worker Update Prompt */}
      <ServiceWorkerPrompt
        hasCartItems={cartItems.length > 0}
        hasUnsyncedOutbox={outboxStats.pending > 0 || outboxStats.syncing > 0}
      />
    </div>
  );
}
