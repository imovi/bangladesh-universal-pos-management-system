"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Printer,
  RotateCcw,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { formatMoney, formatDateTime } from "@/lib/utils";
import { formatPaymentMethod } from "@/i18n/formatters";

interface ReturnItem {
  id: string;
  variantId: string;
  quantity: number;
  condition: string;
  unitRefundMinor: number;
  taxRefundMinor: number;
  totalRefundMinor: number;
  variant?: {
    id: string;
    sku: string;
    product?: {
      id: string;
      name: string;
    } | null;
  } | null;
}

interface ReturnDetail {
  id: string;
  returnNumber: string;
  refundMethod: string;
  totalRefundMinor: number;
  taxRefundMinor: number;
  reason?: string | null;
  overrideReason?: string | null;
  createdAt: string;
  sale?: {
    id: string;
    invoiceNumber: string;
    customer?: {
      id: string;
      name: string;
      phone: string;
    } | null;
  } | null;
  exchangeSale?: {
    id: string;
    invoiceNumber: string;
    totalMinor: number;
  } | null;
  cashierUser?: {
    id: string;
    name: string;
  } | null;
  branch?: {
    id: string;
    name: string;
  } | null;
  register?: {
    id: string;
    name: string;
    code: string;
  } | null;
  items: ReturnItem[];
}

export default function SaleReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const { id } = resolvedParams;
  const { apiFetch } = useAuth();
  const { strings, locale } = useTranslation();

  const [saleReturn, setSaleReturn] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    async function loadReturn() {
      try {
        setLoading(true);
        setErrorMessage(null);
        const res = await apiFetch(`/sales/returns/${id}`);
        if (res.ok) {
          const json = await res.json();
          if (isCurrent) {
            setSaleReturn(json.data);
          }
        } else {
          if (isCurrent) setErrorMessage(strings.common?.error || "Error loading return details");
        }
      } catch {
        if (isCurrent) setErrorMessage(strings.common?.error || "Error loading return details");
      } finally {
        if (isCurrent) setLoading(false);
      }
    }
    loadReturn();
    return () => {
      isCurrent = false;
    };
  }, [apiFetch, id, strings.common?.error]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (errorMessage || !saleReturn) {
    return (
      <div className="space-y-4">
        <Link href="/sales/returns">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {locale === "bn" ? "ফেরত তালিকায় ফিরে যান" : "Back to Returns"}
          </Button>
        </Link>
        <div className="p-6 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl text-red-700 dark:text-red-400">
          <p className="font-medium">{errorMessage || "Return not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Back button and Print header */}
      <div className="flex items-center justify-between no-print">
        <Link href="/sales/returns">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {locale === "bn" ? "ফেরত তালিকায় ফিরে যান" : "Back to Returns"}
          </Button>
        </Link>
        <Button onClick={handlePrint} variant="outline" size="sm">
          <Printer className="h-4 w-4 mr-2" />
          {locale === "bn" ? "প্রিন্ট করুন" : "Print Receipt"}
        </Button>
      </div>

      {/* Return Header Card */}
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-neutral-100 dark:border-neutral-800">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold font-mono text-neutral-900 dark:text-neutral-100">
                {saleReturn.returnNumber}
              </h1>
              <Badge variant="outline" className="border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30">
                <RotateCcw className="h-3 w-3 mr-1" />
                {locale === "bn" ? "পণ্য ফেরত" : "Return"}
              </Badge>
            </div>
            <p className="text-sm text-neutral-500 mt-1">
              {formatDateTime(saleReturn.createdAt)}
            </p>
          </div>

          <div className="text-right">
            <span className="text-xs text-neutral-500 block">
              {locale === "bn" ? "মোট রিফান্ড" : "Total Refund"}
            </span>
            <span className="text-3xl font-extrabold text-red-600 dark:text-red-400">
              -{formatMoney(saleReturn.totalRefundMinor)}
            </span>
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 text-sm">
          <div>
            <span className="text-neutral-500 block text-xs">
              {locale === "bn" ? "মূল ইনভয়েস" : "Original Sale"}
            </span>
            {saleReturn.sale ? (
              <Link
                href={`/sales/${saleReturn.sale.id}`}
                className="font-mono font-medium text-primary hover:underline"
              >
                {saleReturn.sale.invoiceNumber}
              </Link>
            ) : (
              "-"
            )}
          </div>

          <div>
            <span className="text-neutral-500 block text-xs">
              {locale === "bn" ? "রিফান্ড মাধ্যম" : "Refund Method"}
            </span>
            <span className="font-medium capitalize">
              {formatPaymentMethod(saleReturn.refundMethod, strings)}
            </span>
          </div>

          <div>
            <span className="text-neutral-500 block text-xs">
              {locale === "bn" ? "ক্যাশিয়ার" : "Cashier"}
            </span>
            <span className="font-medium">{saleReturn.cashierUser?.name || "-"}</span>
          </div>

          <div>
            <span className="text-neutral-500 block text-xs">
              {locale === "bn" ? "শাখা / কাউন্টার" : "Branch / Register"}
            </span>
            <span className="font-medium">
              {saleReturn.branch?.name || "-"}
              {saleReturn.register ? ` (${saleReturn.register.code})` : ""}
            </span>
          </div>
        </div>

        {/* Reason and Override notices */}
        {(saleReturn.reason || saleReturn.overrideReason) && (
          <div className="mt-6 pt-4 border-t border-neutral-100 dark:border-neutral-800 space-y-2">
            {saleReturn.reason && (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  {locale === "bn" ? "ফেরতের কারণ:" : "Reason:"}
                </span>{" "}
                {saleReturn.reason}
              </p>
            )}
            {saleReturn.overrideReason && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  <strong>{locale === "bn" ? "সময়সীমা ওভাররাইড কারণ:" : "Window Override Reason:"}</strong>{" "}
                  {saleReturn.overrideReason}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Linked Exchange Sale */}
        {saleReturn.exchangeSale && (
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <div>
                <p className="text-sm font-semibold text-blue-950 dark:text-blue-100">
                  {locale === "bn" ? "এই ফেরতের সাথে পণ্য বদল সম্পন্ন হয়েছে" : "This return was part of an exchange"}
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  {locale === "bn" ? "নতুন বিক্রয় ইনভয়েস:" : "New Sale Invoice:"}{" "}
                  <Link
                    href={`/sales/${saleReturn.exchangeSale.id}`}
                    className="font-mono underline font-medium"
                  >
                    {saleReturn.exchangeSale.invoiceNumber}
                  </Link>
                </p>
              </div>
            </div>
            <Link href={`/sales/${saleReturn.exchangeSale.id}`}>
              <Button size="sm" variant="outline" className="border-blue-300 text-blue-800">
                {locale === "bn" ? "নতুন বিক্রয় দেখুন" : "View New Sale"}
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Items Table */}
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-neutral-100 dark:border-neutral-800">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
            {locale === "bn" ? "ফেরতকৃত পণ্যের বিবরণ" : "Returned Items"}
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-200 dark:border-neutral-800">
            <tr>
              <th className="py-3 px-4 text-left font-medium text-neutral-500">{locale === "bn" ? "পণ্য" : "Item"}</th>
              <th className="py-3 px-4 text-center font-medium text-neutral-500">{locale === "bn" ? "অবস্থা" : "Condition"}</th>
              <th className="py-3 px-4 text-center font-medium text-neutral-500">{locale === "bn" ? "পরিমাণ" : "Qty"}</th>
              <th className="py-3 px-4 text-right font-medium text-neutral-500">{locale === "bn" ? "একক রিফান্ড" : "Unit Refund"}</th>
              <th className="py-3 px-4 text-right font-medium text-neutral-500">{locale === "bn" ? "ভ্যাট ফেরত" : "Tax Refund"}</th>
              <th className="py-3 px-4 text-right font-medium text-neutral-500">{locale === "bn" ? "মোট রিফান্ড" : "Total Refund"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {saleReturn.items.map((it) => (
              <tr key={it.id}>
                <td className="py-3 px-4">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">
                    {it.variant?.product?.name || "Product"}
                  </div>
                  <div className="text-xs font-mono text-neutral-400">
                    {it.variant?.sku || it.variantId}
                  </div>
                </td>
                <td className="py-3 px-4 text-center">
                  {it.condition === "resellable" ? (
                    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400">
                      {locale === "bn" ? "পুনর্বিক্রয়যোগ্য" : "Resellable"}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400">
                      {locale === "bn" ? "ক্ষতিগ্রস্ত" : "Damaged"}
                    </Badge>
                  )}
                </td>
                <td className="py-3 px-4 text-center font-medium">
                  {it.quantity}
                </td>
                <td className="py-3 px-4 text-right font-mono text-neutral-600 dark:text-neutral-400">
                  {formatMoney(it.unitRefundMinor)}
                </td>
                <td className="py-3 px-4 text-right font-mono text-neutral-600 dark:text-neutral-400">
                  {formatMoney(it.taxRefundMinor)}
                </td>
                <td className="py-3 px-4 text-right font-mono font-medium text-red-600 dark:text-red-400">
                  -{formatMoney(it.totalRefundMinor)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-neutral-50 dark:bg-neutral-800/50 border-t border-neutral-200 dark:border-neutral-800 font-semibold">
            <tr>
              <td colSpan={4} className="py-3 px-4 text-right text-neutral-600 dark:text-neutral-400">
                {locale === "bn" ? "সর্বমোট ফেরত:" : "Grand Refund Total:"}
              </td>
              <td className="py-3 px-4 text-right font-mono text-neutral-600 dark:text-neutral-400">
                {formatMoney(saleReturn.taxRefundMinor)}
              </td>
              <td className="py-3 px-4 text-right font-mono text-lg text-red-600 dark:text-red-400">
                -{formatMoney(saleReturn.totalRefundMinor)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
