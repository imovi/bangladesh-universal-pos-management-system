'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { BarcodeSvg } from './barcode-svg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Printer,
  X,
  Plus,
  Minus,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export interface BarcodePrintItem {
  variantId: string;
  productId?: string;
  productName: string;
  variantName: string;
  priceMinor: number | string | bigint;
  barcode?: string;
  quantity: number;
}

export type BarcodeLabelFormat = '38x25' | '50x30' | 'a4_3x8';

interface BarcodePrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  shopName?: string;
  items: BarcodePrintItem[];
  onBarcodesUpdated?: (updated: { variantId: string; barcode: string }[]) => void;
}

export function BarcodePrintModal({
  isOpen,
  onClose,
  shopName = 'Universal POS',
  items: initialItems,
  onBarcodesUpdated,
}: BarcodePrintModalProps) {
  const { apiFetch } = useAuth();
  const [format, setFormat] = useState<BarcodeLabelFormat>('38x25');
  const [items, setItems] = useState<BarcodePrintItem[]>(initialItems);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setItems(initialItems);
    setError(null);
    setSuccess(null);
  }, [initialItems, isOpen]);

  if (!isOpen) return null;

  const updateQuantity = (variantId: string, delta: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.variantId === variantId) {
          const newQty = Math.max(0, item.quantity + delta);
          return { ...item, quantity: newQty };
        }
        return item;
      }),
    );
  };

  const setExactQuantity = (variantId: string, qty: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.variantId === variantId
          ? { ...item, quantity: Math.max(0, qty) }
          : item,
      ),
    );
  };

  const handleGenerateBarcode = async (variantId: string) => {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await apiFetch(`/variants/${variantId}/generate-barcode`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to generate barcode');
      }

      const generatedBarcode = data.data.barcode;
      setItems((prev) =>
        prev.map((item) =>
          item.variantId === variantId
            ? { ...item, barcode: generatedBarcode }
            : item,
        ),
      );

      if (onBarcodesUpdated) {
        onBarcodesUpdated([{ variantId, barcode: generatedBarcode }]);
      }
      setSuccess('বারকোড সফলভাবে তৈরি হয়েছে');
    } catch (err: any) {
      setError(err.message || 'Error generating barcode');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAllMissing = async () => {
    const missing = items.filter((i) => !i.barcode);
    if (missing.length === 0) return;

    setIsGenerating(true);
    setError(null);
    const updatedList: { variantId: string; barcode: string }[] = [];

    try {
      for (const item of missing) {
        const res = await apiFetch(`/variants/${item.variantId}/generate-barcode`, {
          method: 'POST',
        });
        const data = await res.json();
        if (res.ok && data.data?.barcode) {
          updatedList.push({ variantId: item.variantId, barcode: data.data.barcode });
        }
      }

      setItems((prev) =>
        prev.map((item) => {
          const match = updatedList.find((u) => u.variantId === item.variantId);
          return match ? { ...item, barcode: match.barcode } : item;
        }),
      );

      if (onBarcodesUpdated && updatedList.length > 0) {
        onBarcodesUpdated(updatedList);
      }
      setSuccess(`${updatedList.length}টি বারকোড সফলভাবে তৈরি হয়েছে`);
    } catch (err: any) {
      setError(err.message || 'Error generating barcodes');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Build flattened array of labels to render based on quantity
  const labelsToPrint: BarcodePrintItem[] = [];
  items.forEach((item) => {
    for (let i = 0; i < item.quantity; i++) {
      labelsToPrint.push(item);
    }
  });

  const missingBarcodeCount = items.filter((i) => !i.barcode && i.quantity > 0).length;

  return (
    <>
      {/* Print Stylesheet */}
      <style>{`
        @media print {
          @page {
            size: ${
              format === '38x25'
                ? '38mm 25mm'
                : format === '50x30'
                  ? '50mm 30mm'
                  : 'A4 portrait'
            };
            margin: 0;
          }
          body * {
            visibility: hidden !important;
          }
          #barcode-print-area, #barcode-print-area * {
            visibility: visible !important;
          }
          #barcode-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }
          .barcode-label-roll {
            page-break-after: always;
            break-after: page;
          }
          .barcode-label-sheet-page {
            page-break-after: always;
            break-after: page;
          }
        }
      `}</style>

      {/* Screen Modal Dialog */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        data-testid="barcode-print-modal"
      >
        <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-6 py-4 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                বারকোড লেবেল প্রিন্ট
              </h2>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Feedback messages */}
          {error && (
            <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Body Content */}
          <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 md:grid-cols-12">
            {/* Left Controls: Formats & Items (5 cols) */}
            <div className="flex flex-col gap-5 md:col-span-5">
              {/* Format Selection */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  লেবেল সাইজ / ফরম্যাট
                </Label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormat('38x25')}
                    className={`rounded-lg border p-2.5 text-center text-xs font-medium transition ${
                      format === '38x25'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm dark:bg-indigo-950/50 dark:text-indigo-300'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    38×25 mm
                    <span className="block text-[10px] text-zinc-500">থার্মাল রোল</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormat('50x30')}
                    className={`rounded-lg border p-2.5 text-center text-xs font-medium transition ${
                      format === '50x30'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm dark:bg-indigo-950/50 dark:text-indigo-300'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    50×30 mm
                    <span className="block text-[10px] text-zinc-500">থার্মাল রোল</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormat('a4_3x8')}
                    className={`rounded-lg border p-2.5 text-center text-xs font-medium transition ${
                      format === 'a4_3x8'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm dark:bg-indigo-950/50 dark:text-indigo-300'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    A4 শিট
                    <span className="block text-[10px] text-zinc-500">২৪ লেবেল (৩×৮)</span>
                  </button>
                </div>
              </div>

              {/* Items List & Copies */}
              <div className="flex flex-1 flex-col">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    আইটেম ও প্রিন্ট কপি
                  </Label>
                  {missingBarcodeCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateAllMissing}
                      disabled={isGenerating}
                      className="h-7 text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                    >
                      {isGenerating ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                      )}
                      বারকোড তৈরি ({missingBarcodeCount})
                    </Button>
                  )}
                </div>

                <div className="mt-2 max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
                  {items.map((item) => (
                    <div
                      key={item.variantId}
                      className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/40"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                            {item.productName}
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {item.variantName} • ৳{Number(item.priceMinor) / 100}
                          </div>
                        </div>

                        {/* Barcode status */}
                        {item.barcode ? (
                          <span className="font-mono text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                            {item.barcode}
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleGenerateBarcode(item.variantId)}
                            disabled={isGenerating}
                            className="h-6 px-2 text-[10px] text-amber-600 hover:bg-amber-50 dark:text-amber-400"
                          >
                            তৈরি করুন
                          </Button>
                        )}
                      </div>

                      {/* Quantity Selector */}
                      <div className="mt-1 flex items-center justify-between border-t border-zinc-200/60 pt-2 dark:border-zinc-700/60">
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">কপি সংখ্যা:</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.variantId, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <Input
                            type="number"
                            min="0"
                            value={item.quantity}
                            onChange={(e) =>
                              setExactQuantity(item.variantId, parseInt(e.target.value) || 0)
                            }
                            className="h-7 w-14 text-center font-mono text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.variantId, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Preview Panel (7 cols) */}
            <div className="flex flex-col rounded-lg border border-zinc-200 bg-zinc-100 p-4 dark:border-zinc-800 dark:bg-zinc-950 md:col-span-7">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  প্রিভিউ ({labelsToPrint.length} লেবেল)
                </span>
                <span className="text-[11px] text-zinc-400">প্রকৃত প্রিন্ট রেজ্যুলেশন</span>
              </div>

              {/* Preview scroll area */}
              <div className="flex max-h-[460px] flex-1 flex-wrap items-start justify-center gap-4 overflow-y-auto rounded bg-zinc-200/50 p-4 dark:bg-zinc-900/50">
                {labelsToPrint.length === 0 ? (
                  <div className="flex h-40 w-full items-center justify-center text-xs text-zinc-400">
                    কোন লেবেল সিলেক্ট করা নেই (কপি সংখ্যা বাড়ান)
                  </div>
                ) : (
                  labelsToPrint.slice(0, 12).map((item, idx) => (
                    <div
                      key={`${item.variantId}-${idx}`}
                      className="shadow-sm"
                      style={{
                        width:
                          format === '38x25'
                            ? '144px'
                            : format === '50x30'
                              ? '190px'
                              : '180px',
                        height:
                          format === '38x25'
                            ? '95px'
                            : format === '50x30'
                              ? '114px'
                              : '110px',
                      }}
                    >
                      <SingleLabelCard
                        shopName={shopName}
                        item={item}
                        format={format}
                        preview={true}
                      />
                    </div>
                  ))
                )}
                {labelsToPrint.length > 12 && (
                  <div className="w-full text-center text-xs text-zinc-500">
                    + আরও {labelsToPrint.length - 12}টি লেবেল প্রিন্ট হবে
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-between border-t px-6 py-4 dark:border-zinc-800">
            <div className="text-xs text-zinc-500">
              মোট প্রিন্ট কপি:{' '}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {labelsToPrint.length}
              </span>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose}>
                বাতিল
              </Button>
              <Button
                onClick={handlePrint}
                disabled={labelsToPrint.length === 0 || isGenerating}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                data-testid="confirm-barcode-print"
              >
                <Printer className="mr-2 h-4 w-4" />
                বারকোড প্রিন্ট করুন ({labelsToPrint.length})
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Actual Hidden Print Target Area */}
      <div id="barcode-print-area" className="hidden">
        {format === 'a4_3x8' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '2mm',
              padding: '6mm 4mm',
              width: '210mm',
              boxSizing: 'border-box',
            }}
            className="barcode-label-sheet-page"
          >
            {labelsToPrint.map((item, idx) => (
              <div
                key={`print-sheet-${item.variantId}-${idx}`}
                style={{
                  width: '66mm',
                  height: '34mm',
                  border: '1px dashed #e2e8f0',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  breakInside: 'avoid',
                }}
              >
                <SingleLabelCard shopName={shopName} item={item} format={format} preview={false} />
              </div>
            ))}
          </div>
        ) : (
          labelsToPrint.map((item, idx) => (
            <div
              key={`print-roll-${item.variantId}-${idx}`}
              style={{
                width: format === '38x25' ? '38mm' : '50mm',
                height: format === '38x25' ? '25mm' : '30mm',
                margin: '0 auto',
                boxSizing: 'border-box',
                overflow: 'hidden',
              }}
              className="barcode-label-roll"
            >
              <SingleLabelCard shopName={shopName} item={item} format={format} preview={false} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

interface SingleLabelCardProps {
  shopName: string;
  item: BarcodePrintItem;
  format: BarcodeLabelFormat;
  preview?: boolean;
}

function SingleLabelCard({ shopName, item, format, preview = false }: SingleLabelCardProps) {
  const isSmall = format === '38x25';
  const priceDisplay = `৳${(Number(item.priceMinor) / 100).toLocaleString('en-US')}`;

  return (
    <div
      className={`flex h-full w-full flex-col justify-between bg-white text-black ${
        preview ? 'border border-zinc-300 p-1.5' : 'p-1'
      }`}
      style={{ boxSizing: 'border-box', fontFamily: 'system-ui, sans-serif' }}
    >
      {/* Header: Shop name & Price */}
      <div className="flex items-center justify-between border-b border-zinc-200 pb-0.5 leading-none">
        <span
          className="truncate font-semibold tracking-tight uppercase"
          style={{ fontSize: isSmall ? '8px' : '9px' }}
        >
          {shopName}
        </span>
        <span
          className="font-bold text-zinc-900"
          style={{ fontSize: isSmall ? '9px' : '10px' }}
        >
          {priceDisplay}
        </span>
      </div>

      {/* Product Title and Variant */}
      <div className="my-0.5 leading-tight">
        <div
          className="truncate font-medium text-zinc-900"
          style={{ fontSize: isSmall ? '8px' : '9px' }}
        >
          {item.productName}
        </div>
        <div
          className="truncate text-zinc-600"
          style={{ fontSize: isSmall ? '7px' : '8px' }}
        >
          {item.variantName}
        </div>
      </div>

      {/* Barcode Vector SVG */}
      <div className="flex flex-col items-center justify-center my-auto">
        {item.barcode ? (
          <BarcodeSvg
            value={item.barcode}
            width={isSmall ? 1.0 : 1.25}
            height={isSmall ? 22 : 30}
            fontSize={isSmall ? 8 : 9}
            displayValue={true}
          />
        ) : (
          <div
            className="flex items-center justify-center border border-dashed border-zinc-300 text-zinc-400"
            style={{ height: isSmall ? '24px' : '32px', fontSize: '8px', width: '90%' }}
          >
            [বারকোড নেই]
          </div>
        )}
      </div>
    </div>
  );
}
