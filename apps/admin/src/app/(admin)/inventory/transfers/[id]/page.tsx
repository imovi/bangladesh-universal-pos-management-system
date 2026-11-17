"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Truck,
  CheckCircle2,
  Clock,
  XCircle,
  Printer,
  Send,
  Building,
  User,
  Calendar,
  AlertCircle,
  Barcode,
} from "lucide-react";
import { BarcodePrintModal } from "@/components/barcodes/barcode-print-modal";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export default function StockTransferDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const queryClient = useQueryClient();
  const { currentBranch, user, hasPermission, apiFetch } = useAuth();
  const { locale } = useTranslation();

  // Receive form state
  const [receiveLines, setReceiveLines] = useState<Record<string, { receivedQty: number; lossReason: string }>>({});
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isBarcodePrintOpen, setIsBarcodePrintOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Fetch transfer details
  const { data: transfer, isLoading, error } = useQuery({
    queryKey: ["stock-transfer-detail", id],
    queryFn: async () => {
      const res = await apiFetch(`/inventory/transfers/${id}`);
      if (!res.ok) throw new Error("Transfer not found");
      const json = await res.json();
      return json.data;
    },
    enabled: !!id,
  });

  // Initialize receive lines when transfer data loads
  React.useEffect(() => {
    if (transfer && transfer.items) {
      const init: Record<string, { receivedQty: number; lossReason: string }> = {};
      for (const item of transfer.items) {
        init[item.variantId] = {
          receivedQty: Number(item.sentQty || 0),
          lossReason: "",
        };
      }
      setReceiveLines(init);
    }
  }, [transfer]);

  // Send transfer mutation
  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/inventory/transfers/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "Dispatched from branch" }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Failed to send transfer");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfer-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
    },
  });

  // Cancel transfer mutation
  const cancelMutation = useMutation({
    mutationFn: async () => {
      setCancelError(null);
      const res = await apiFetch(`/inventory/transfers/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Failed to cancel transfer");
      }
      return res.json();
    },
    onSuccess: () => {
      setIsCancelModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["stock-transfer-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
    },
    onError: (err: any) => {
      setCancelError(err.message || "Failed to cancel transfer");
    },
  });

  // Receive transfer mutation
  const receiveMutation = useMutation({
    mutationFn: async () => {
      setReceiveError(null);
      if (!transfer || !transfer.items) return;

      const itemsPayload: Array<{ variantId: string; receivedQty: number; lossReason?: string }> = [];

      for (const item of transfer.items) {
        const line = receiveLines[item.variantId] || { receivedQty: Number(item.sentQty), lossReason: "" };
        const sentQty = Number(item.sentQty);
        const receivedQty = Number(line.receivedQty);

        if (receivedQty < sentQty && !line.lossReason.trim()) {
          throw new Error(
            locale === "bn"
              ? `কম প্রাপ্তির ক্ষেত্রে ক্ষতির কারণ উল্লেখ করা আবশ্যক (${item.variant.product.name} - ${item.variant.sku})`
              : `Discrepancy reason is required for short line (${item.variant.product.name} - ${item.variant.sku})`
          );
        }

        itemsPayload.push({
          variantId: item.variantId,
          receivedQty,
          lossReason: line.lossReason.trim() || undefined,
        });
      }

      const res = await apiFetch(`/inventory/transfers/${id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsPayload }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Failed to receive transfer");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfer-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
    },
    onError: (err: any) => {
      setReceiveError(err.message || "Failed to receive transfer");
    },
  });

  if (isLoading) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        {locale === "bn" ? "ট্রান্সফার বিবরণ লোড হচ্ছে..." : "Loading transfer details..."}
      </div>
    );
  }

  if (error || !transfer) {
    return (
      <div className="py-20 text-center space-y-4">
        <div className="text-rose-600 font-semibold">
          {locale === "bn" ? "ট্রান্সফার পাওয়া যায়নি" : "Transfer not found"}
        </div>
        <Link href="/inventory/transfers">
          <Button variant="outline" size="sm">
            {locale === "bn" ? "তালিকায় ফিরুন" : "Back to Transfers"}
          </Button>
        </Link>
      </div>
    );
  }

  const isOwner = Boolean(user?.isOwner) || (Array.isArray(user?.roles) && user?.roles.includes("Owner"));
  const canReceive =
    transfer.status === "sent" &&
    hasPermission("transfer.receive") &&
    (isOwner || currentBranch?.id === transfer.destinationBranchId);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 gap-1.5 px-2.5 py-1">
            <Clock className="w-3.5 h-3.5" />
            {locale === "bn" ? "খসড়া" : "Draft"}
          </Badge>
        );
      case "sent":
        return (
          <Badge variant="outline" className="bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30 gap-1.5 px-2.5 py-1">
            <Truck className="w-3.5 h-3.5" />
            {locale === "bn" ? "ট্রানজিটে আছে" : "In Transit"}
          </Badge>
        );
      case "received":
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1.5 px-2.5 py-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {locale === "bn" ? "গৃহীত" : "Received"}
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="outline" className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30 gap-1.5 px-2.5 py-1">
            <XCircle className="w-3.5 h-3.5" />
            {locale === "bn" ? "বাতিল" : "Cancelled"}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Print CSS styling */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-transfer-note, #printable-transfer-note * {
            visibility: visible;
          }
          #printable-transfer-note {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 20px;
            background: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Action Header (hidden on print) */}
      <div className="no-print flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <Link href="/inventory/transfers">
            <Button variant="outline" size="sm" className="h-8 px-2.5">
              <ArrowLeft className="w-4 h-4 mr-1" />
              {locale === "bn" ? "তালিকায় ফিরুন" : "Back"}
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground font-mono" data-testid="transfer-number-title">
                {transfer.transferNumber}
              </h1>
              <div data-testid="transfer-status-badge">{getStatusBadge(transfer.status)}</div>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {locale === "bn" ? "তৈরি:" : "Created:"}{" "}
              {new Date(transfer.createdAt).toLocaleString(locale === "bn" ? "bn-BD" : "en-GB")}
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2">
          {transfer.status === "received" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsBarcodePrintOpen(true)}
              data-testid="print-transfer-barcodes-btn"
              className="gap-1.5 h-8 text-xs"
            >
              <Barcode className="w-3.5 h-3.5" />
              {locale === "bn" ? "বারকোড প্রিন্ট" : "Print Barcodes"}
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="print-transfer-btn" className="gap-1.5 h-8 text-xs">
            <Printer className="w-3.5 h-3.5" />
            {locale === "bn" ? "চালান প্রিন্ট" : "Print Transfer Note"}
          </Button>

          {transfer.status === "draft" && hasPermission("transfer.send") && (
            <Button
              size="sm"
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending}
              data-testid="send-transfer-btn"
              className="gap-1.5 h-8 text-xs"
            >
              <Send className="w-3.5 h-3.5" />
              {locale === "bn" ? "পাঠিয়ে দিন" : "Dispatch Transfer"}
            </Button>
          )}

          {transfer.status === "draft" && hasPermission("transfer.create") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCancelModalOpen(true)}
              data-testid="cancel-transfer-btn"
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-8 text-xs"
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              {locale === "bn" ? "বাতিল করুন" : "Cancel"}
            </Button>
          )}
        </div>
      </div>

      {/* Metadata Cards (hidden on print) */}
      <div className="no-print grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Source Branch */}
        <div className="p-4 rounded-lg border border-border bg-card shadow-sm space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Building className="w-3.5 h-3.5 text-primary" />
            <span>{locale === "bn" ? "উৎস শাখা" : "Source Branch"}</span>
          </div>
          <div className="font-semibold text-sm text-foreground" data-testid="source-branch-name">
            {transfer.sourceBranch?.name}
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            {transfer.sourceBranch?.code}
          </div>
          {transfer.sentByUser && (
            <div className="text-[11px] text-muted-foreground pt-1 flex items-center gap-1">
              <User className="w-3 h-3" />
              <span>{locale === "bn" ? "পাঠিয়েছেন:" : "Sent by:"} {transfer.sentByUser.name}</span>
            </div>
          )}
        </div>

        {/* Destination Branch */}
        <div className="p-4 rounded-lg border border-border bg-card shadow-sm space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Building className="w-3.5 h-3.5 text-emerald-600" />
            <span>{locale === "bn" ? "গন্তব্য শাখা" : "Destination Branch"}</span>
          </div>
          <div className="font-semibold text-sm text-foreground" data-testid="destination-branch-name">
            {transfer.destinationBranch?.name}
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            {transfer.destinationBranch?.code}
          </div>
          {transfer.receivedByUser && (
            <div className="text-[11px] text-muted-foreground pt-1 flex items-center gap-1">
              <User className="w-3 h-3" />
              <span>{locale === "bn" ? "গ্রহণ করেছেন:" : "Received by:"} {transfer.receivedByUser.name}</span>
            </div>
          )}
        </div>

        {/* Timestamps & Info */}
        <div className="p-4 rounded-lg border border-border bg-card shadow-sm space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <span>{locale === "bn" ? "সময়রেখা" : "Timeline"}</span>
          </div>
          <div className="text-xs space-y-1 pt-0.5">
            <div>
              <span className="text-muted-foreground">{locale === "bn" ? "তৈরি: " : "Created: "}</span>
              <span className="font-medium text-foreground">
                {new Date(transfer.createdAt).toLocaleDateString(locale === "bn" ? "bn-BD" : "en-GB")}
              </span>
            </div>
            {transfer.sentAt && (
              <div>
                <span className="text-muted-foreground">{locale === "bn" ? "প্রেরণ: " : "Sent: "}</span>
                <span className="font-medium text-foreground">
                  {new Date(transfer.sentAt).toLocaleDateString(locale === "bn" ? "bn-BD" : "en-GB")}
                </span>
              </div>
            )}
            {transfer.receivedAt && (
              <div>
                <span className="text-muted-foreground">{locale === "bn" ? "গ্রহণ: " : "Received: "}</span>
                <span className="font-medium text-foreground">
                  {new Date(transfer.receivedAt).toLocaleDateString(locale === "bn" ? "bn-BD" : "en-GB")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {transfer.notes && (
        <div className="no-print p-3.5 rounded-lg border border-border bg-card text-xs">
          <span className="font-semibold text-muted-foreground">{locale === "bn" ? "নোট: " : "Notes: "}</span>
          <span className="text-foreground">{transfer.notes}</span>
        </div>
      )}

      {/* Receive Section (only if sent) */}
      {transfer.status === "sent" && (
        <div className="no-print p-5 rounded-lg border border-sky-500/30 bg-sky-500/5 shadow-sm space-y-4" data-testid="receive-section">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-sky-500/20 pb-3">
            <div>
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Truck className="w-4 h-4 text-sky-600" />
                {locale === "bn" ? "পণ্য গ্রহণ ও যাচাই ফরম" : "Receive & Stock Verification Form"}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {locale === "bn"
                  ? "গন্তব্য শাখায় প্রাপ্ত পণ্যের পরিমাণ মিলিয়ে দেখুন। ঘাটতি থাকলে কারণ উল্লেখ করুন।"
                  : "Verify received stock against sent quantities. Provide loss reason for discrepancies."}
              </p>
            </div>

            {!canReceive && (
              <Badge variant="outline" className="text-xs text-amber-700 bg-amber-500/10 border-amber-500/30">
                {locale === "bn"
                  ? "শুধুমাত্র গন্তব্য শাখার কর্মী গ্রহণ করতে পারবেন"
                  : "Destination branch access required to receive"}
              </Badge>
            )}
          </div>

          {receiveError && (
            <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{receiveError}</span>
            </div>
          )}

          <div className="rounded-md border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{locale === "bn" ? "পণ্য ও অপশন" : "Product & Variant"}</TableHead>
                  <TableHead className="w-[120px] text-right">{locale === "bn" ? "প্রেরিত পরিমাণ" : "Sent Qty"}</TableHead>
                  <TableHead className="w-[140px] text-right">{locale === "bn" ? "প্রাপ্ত পরিমাণ" : "Received Qty"}</TableHead>
                  <TableHead className="w-[220px]">{locale === "bn" ? "ঘাটতি ও ক্ষতির কারণ" : "Discrepancy / Loss Reason"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfer.items?.map((item: any) => {
                  const line = receiveLines[item.variantId] || { receivedQty: Number(item.sentQty), lossReason: "" };
                  const sent = Number(item.sentQty);
                  const received = Number(line.receivedQty);
                  const discrepancy = sent - received;

                  return (
                    <TableRow key={item.id} className="h-[56px]">
                      <TableCell>
                        <div className="font-semibold text-xs text-foreground">{item.variant?.product?.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{item.variant?.sku}</div>
                      </TableCell>

                      <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                        {sent}
                      </TableCell>

                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={sent}
                          value={line.receivedQty}
                          disabled={!canReceive || receiveMutation.isPending}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setReceiveLines((prev) => ({
                              ...prev,
                              [item.variantId]: {
                                ...prev[item.variantId],
                                receivedQty: isNaN(val) ? 0 : val,
                              },
                            }));
                          }}
                          className="w-20 h-7 text-xs text-right font-mono tabular-nums ml-auto"
                          data-testid={`receive-qty-input-${item.variantId}`}
                        />
                      </TableCell>

                      <TableCell>
                        {discrepancy > 0 ? (
                          <div className="space-y-1">
                            <span className="text-[11px] text-rose-600 font-semibold">
                              {locale === "bn" ? `ঘাটতি: ${discrepancy} টি` : `Short: ${discrepancy}`}
                            </span>
                            <Input
                              placeholder={locale === "bn" ? "ঘাটতি বা ক্ষতির কারণ লিখুন (আবশ্যক)..." : "Loss reason (required)..."}
                              value={line.lossReason}
                              disabled={!canReceive || receiveMutation.isPending}
                              onChange={(e) => {
                                const val = e.target.value;
                                setReceiveLines((prev) => ({
                                  ...prev,
                                  [item.variantId]: {
                                    ...prev[item.variantId],
                                    lossReason: val,
                                  },
                                }));
                              }}
                              className="h-7 text-xs border-amber-500/40 focus:border-amber-500"
                              data-testid={`loss-reason-input-${item.variantId}`}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-emerald-600 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {locale === "bn" ? "সম্পূর্ণ প্রাপ্ত" : "Full delivery"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              disabled={!canReceive || receiveMutation.isPending}
              onClick={() => receiveMutation.mutate()}
              data-testid="confirm-receive-btn"
              className="gap-2 text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="w-4 h-4" />
              {locale === "bn" ? "প্রাপ্তি নিশ্চিত করুন ও স্টক আপডেট করুন" : "Confirm Receipt & Update Stock"}
            </Button>
          </div>
        </div>
      )}

      {/* Items Summary Table (shown when not in receive mode or after received) */}
      <div className="no-print rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {locale === "bn" ? "ট্রান্সফার আইটেম বিবরণ" : "Transfer Line Items"}
          </h2>
          <Badge variant="outline" className="text-xs font-mono">
            {transfer.items?.length || 0} {locale === "bn" ? "টি আইটেম" : "items"}
          </Badge>
        </div>

        <Table data-testid="transfer-items-table">
          <TableHeader>
            <TableRow>
              <TableHead>{locale === "bn" ? "পণ্য" : "Product"}</TableHead>
              <TableHead className="w-[140px]">{locale === "bn" ? "এসকেইউ" : "SKU"}</TableHead>
              <TableHead className="w-[140px]">{locale === "bn" ? "অপশন" : "Options"}</TableHead>
              <TableHead className="w-[120px] text-right">{locale === "bn" ? "প্রেরিত পরিমাণ" : "Sent Qty"}</TableHead>
              {transfer.status === "received" && (
                <>
                  <TableHead className="w-[120px] text-right">{locale === "bn" ? "গৃহীত পরিমাণ" : "Received Qty"}</TableHead>
                  <TableHead className="w-[120px] text-right">{locale === "bn" ? "ঘাটতি" : "Loss / Short"}</TableHead>
                  <TableHead className="w-[200px]">{locale === "bn" ? "ঘাটতির কারণ" : "Loss Reason"}</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfer.items?.map((item: any) => {
              const rawOpts = item.variant?.optionValues || [];
              const optionsLabel =
                rawOpts.length > 0
                  ? rawOpts.map((vov: any) => vov.optionValue?.value).filter(Boolean).join(" / ")
                  : (locale === "bn" ? "সাধারণ" : "Standard");

              return (
                <TableRow key={item.id} className="h-[52px]">
                  <TableCell className="font-semibold text-xs text-foreground">
                    {item.variant?.product?.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.variant?.sku}
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="outline" className="text-[11px] font-normal py-0">
                      {optionsLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                    {Number(item.sentQty)}
                  </TableCell>
                  {transfer.status === "received" && (
                    <>
                      <TableCell className="text-right font-mono text-xs text-emerald-600 font-semibold tabular-nums">
                        {Number(item.receivedQty ?? item.sentQty)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-rose-600 tabular-nums">
                        {Number(item.lossQty) > 0 ? Number(item.lossQty) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.lossReason || "—"}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* PRINTABLE TRANSFER NOTE (A4 LAYOUT) */}
      <div id="printable-transfer-note" className="p-8 border border-border bg-card rounded-lg space-y-6">
        <div className="border-b-2 border-foreground pb-4 flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold tracking-tight uppercase">
              {locale === "bn" ? "স্টক ট্রান্সফার নোট / চালান" : "STOCK TRANSFER NOTE / CHALLAN"}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">Universal POS Management System • Bangladesh</p>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold font-mono">{transfer.transferNumber}</div>
            <div className="text-xs text-muted-foreground">
              {locale === "bn" ? "তারিখ: " : "Date: "}
              {new Date(transfer.createdAt).toLocaleDateString(locale === "bn" ? "bn-BD" : "en-GB")}
            </div>
            <div className="text-xs font-semibold mt-1">
              {locale === "bn" ? "স্ট্যাটাস: " : "Status: "}{transfer.status.toUpperCase()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 text-xs">
          <div className="border p-3 rounded">
            <div className="font-bold uppercase text-muted-foreground mb-1">
              {locale === "bn" ? "উৎস শাখা (প্রেরক)" : "DISPATCHED FROM (SOURCE)"}
            </div>
            <div className="font-bold text-sm">{transfer.sourceBranch?.name}</div>
            <div>{locale === "bn" ? "কোড: " : "Code: "}{transfer.sourceBranch?.code}</div>
            {transfer.sentByUser && (
              <div className="mt-1 text-muted-foreground">
                {locale === "bn" ? "প্রেরক: " : "Sent by: "}{transfer.sentByUser.name}
              </div>
            )}
          </div>

          <div className="border p-3 rounded">
            <div className="font-bold uppercase text-muted-foreground mb-1">
              {locale === "bn" ? "গন্তব্য শাখা (প্রাপক)" : "RECEIVING AT (DESTINATION)"}
            </div>
            <div className="font-bold text-sm">{transfer.destinationBranch?.name}</div>
            <div>{locale === "bn" ? "কোড: " : "Code: "}{transfer.destinationBranch?.code}</div>
            {transfer.receivedByUser && (
              <div className="mt-1 text-muted-foreground">
                {locale === "bn" ? "গ্রহীতা: " : "Received by: "}{transfer.receivedByUser.name}
              </div>
            )}
          </div>
        </div>

        <div className="border rounded overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/50 border-b font-semibold">
              <tr>
                <th className="p-2 w-12 text-center">#</th>
                <th className="p-2">{locale === "bn" ? "পণ্যের বিবরণ" : "Product Description"}</th>
                <th className="p-2">{locale === "bn" ? "এসকেইউ ও অপশন" : "SKU & Variant"}</th>
                <th className="p-2 text-right w-24">{locale === "bn" ? "প্রেরিত" : "Sent Qty"}</th>
                <th className="p-2 text-right w-24">{locale === "bn" ? "গৃহীত" : "Recv Qty"}</th>
                <th className="p-2 w-48">{locale === "bn" ? "ঘাটতি ও কারণ" : "Loss / Short Reason"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transfer.items?.map((item: any, idx: number) => {
                const rawOpts = item.variant?.optionValues || [];
                const optionsLabel =
                  rawOpts.length > 0
                    ? rawOpts.map((vov: any) => vov.optionValue?.value).filter(Boolean).join(" / ")
                    : "—";

                return (
                  <tr key={item.id} className="h-9">
                    <td className="p-2 text-center font-mono">{idx + 1}</td>
                    <td className="p-2 font-medium">{item.variant?.product?.name}</td>
                    <td className="p-2 font-mono text-muted-foreground">{item.variant?.sku} ({optionsLabel})</td>
                    <td className="p-2 text-right font-mono font-bold">{Number(item.sentQty)}</td>
                    <td className="p-2 text-right font-mono font-bold">
                      {item.receivedQty !== null ? Number(item.receivedQty) : "—"}
                    </td>
                    <td className="p-2 text-muted-foreground text-[11px]">{item.lossReason || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="pt-8 grid grid-cols-2 gap-12 text-xs">
          <div className="border-t border-foreground pt-2 text-center">
            <div className="font-bold">{locale === "bn" ? "প্রেরণকারীর স্বাক্ষর" : "Authorized Dispatch Signature"}</div>
            <div className="text-muted-foreground text-[11px] mt-0.5">{transfer.sourceBranch?.name}</div>
          </div>
          <div className="border-t border-foreground pt-2 text-center">
            <div className="font-bold">{locale === "bn" ? "গ্রহণকারীর স্বাক্ষর" : "Authorized Receiving Signature"}</div>
            <div className="text-muted-foreground text-[11px] mt-0.5">{transfer.destinationBranch?.name}</div>
          </div>
        </div>
      </div>

      {/* Cancel Modal */}
      {isCancelModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border p-5 rounded-lg max-w-md w-full space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-foreground">
              {locale === "bn" ? "ট্রান্সফার বাতিল নিশ্চিতকরণ" : "Cancel Stock Transfer"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {locale === "bn"
                ? "খসড়া ট্রান্সফারটি বাতিল করতে চান? বাতিলের কারণ উল্লেখ করুন।"
                : "Are you sure you want to cancel this draft transfer? Provide a cancellation reason."}
            </p>

            {cancelError && (
              <div className="p-2.5 rounded bg-rose-500/10 text-rose-700 text-xs">
                {cancelError}
              </div>
            )}

            <Input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={locale === "bn" ? "বাতিলের কারণ (যেমন: ভুল আইটেম যুক্ত)..." : "Cancellation reason..."}
              className="h-9 text-xs"
              data-testid="cancel-reason-input"
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setIsCancelModalOpen(false)}>
                {locale === "bn" ? "ফিরে যান" : "Go Back"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
                data-testid="confirm-cancel-transfer-btn"
              >
                {locale === "bn" ? "বাতিল নিশ্চিত করুন" : "Confirm Cancel"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {transfer && (
        <BarcodePrintModal
          isOpen={isBarcodePrintOpen}
          onClose={() => setIsBarcodePrintOpen(false)}
          shopName={transfer.destinationBranch?.name || "Universal POS"}
          items={transfer.items.map((item: any) => ({
            variantId: item.variantId,
            productName: item.variant?.product?.name || "Product",
            variantName: item.variant?.sku || "",
            priceMinor: item.variant?.priceMinor || 0,
            barcode: item.variant?.barcodes?.[0]?.barcode,
            quantity: Number(item.receivedQty || item.quantity),
          }))}
          onBarcodesUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ["stock-transfer-detail", id] });
          }}
        />
      )}
    </div>
  );
}
