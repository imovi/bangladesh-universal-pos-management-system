"use client";

import React, { useState, useEffect } from "react";
import { useTranslation } from "@/i18n/context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Printer,
  Usb,
  Cable,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  PrinterDeviceConfig,
  getPrinterConfig,
  savePrinterConfig,
} from "@/lib/printing/printer-settings";
import { getPrinterTransport } from "@/lib/printing/printer-transport";
import { renderReceiptToCanvasBitmap } from "@/lib/printing/canvas-rasterizer";
import { encodeReceiptEscPos, ReceiptModel } from "@universal-pos/shared";

export default function PrinterSettingsPage() {
  const { strings } = useTranslation();
  const [config, setConfig] = useState<PrinterDeviceConfig>(getPrinterConfig());
  const [status, setStatus] = useState({ connected: false, deviceName: "", error: "" });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const currentConfig = getPrinterConfig();
    setConfig(currentConfig);
    const transport = getPrinterTransport(currentConfig);
    const s = transport.getStatus();
    setStatus({
      connected: s.connected,
      deviceName: s.deviceName || "",
      error: s.error || "",
    });
  }, []);

  const updateConfig = (patch: Partial<PrinterDeviceConfig>) => {
    const updated = savePrinterConfig(patch);
    setConfig(updated);
    const transport = getPrinterTransport(updated);
    const s = transport.getStatus();
    setStatus({
      connected: s.connected,
      deviceName: s.deviceName || "",
      error: s.error || "",
    });
  };

  const handleConnect = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const transport = getPrinterTransport(config);
      const ok = await transport.connect();
      if (ok) {
        const s = transport.getStatus();
        setStatus({
          connected: s.connected,
          deviceName: s.deviceName || "",
          error: "",
        });
        setMessage({ type: "success", text: strings.settings.printerConnected });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || strings.settings.printerError });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      const transport = getPrinterTransport(config);
      await transport.disconnect();
      setStatus({ connected: false, deviceName: "", error: "" });
    } finally {
      setLoading(false);
    }
  };

  const handleTestPrint = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const sampleReceipt: ReceiptModel = {
        shopName: "আর্টিসান ফ্যাশন লিমিটেড",
        branchName: "ধানমন্ডি শাখা",
        branchAddress: "বাড়ি ১২, রোড ২৭, ঢাকা",
        invoiceNumber: "INV-TEST-0001",
        createdAt: new Date().toLocaleString("bn-BD"),
        cashierName: "ক্যাশিয়ার টেস্ট",
        registerName: "রেজিস্টার ০১",
        customerName: "সাধারণ ক্রেতা",
        customerPhone: "01700000000",
        items: [
          {
            name: "প্রিমিয়াম সিল্ক পাঞ্জাবি",
            sku: "PAN-SLK-01",
            size: "৪২",
            quantity: 1,
            unitPriceMinor: 250000,
            totalMinor: 250000,
          },
          {
            name: "কটন পায়জামা",
            sku: "PAJ-COT-02",
            size: "L",
            quantity: 1,
            unitPriceMinor: 80000,
            totalMinor: 80000,
          },
        ],
        grossMinor: 330000,
        discountMinor: 30000,
        taxMinor: 15000,
        totalMinor: 315000,
        paidMinor: 320000,
        changeMinor: 5000,
        dueMinor: 0,
        payments: [{ paymentMethod: "cash", amountMinor: 320000 }],
        receiptHeader: "বিআইএন: ০০১২৩৪৫৬৭-০১০১ (মুসক ৬.৩)",
        receiptFooter: "৭ দিনের মধ্যে চালান সহ পণ্য পরিবর্তনের সুবিধা।",
      };

      const transport = getPrinterTransport(config);

      let bytes: Uint8Array;
      if (config.mode === "raster") {
        const bitmap = renderReceiptToCanvasBitmap(sampleReceipt, {
          paperWidth: config.paperWidth,
        });
        bytes = encodeReceiptEscPos(
          sampleReceipt,
          {
            paperWidth: config.paperWidth,
            mode: "raster",
            copies: config.copies,
            openCashDrawer: config.openCashDrawer,
          },
          bitmap || undefined
        );
      } else {
        bytes = encodeReceiptEscPos(sampleReceipt, {
          paperWidth: config.paperWidth,
          mode: "text",
          copies: config.copies,
          openCashDrawer: config.openCashDrawer,
        });
      }

      await transport.print(bytes);
      setMessage({ type: "success", text: strings.settings.testPrintSuccess });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || strings.settings.printerError });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDrawer = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const transport = getPrinterTransport(config);
      const ok = await transport.openCashDrawer();
      if (ok) {
        setMessage({ type: "success", text: strings.settings.openDrawerSuccess });
      } else {
        setMessage({ type: "error", text: "Cash drawer signal requires Web Serial or WebUSB connection." });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || strings.settings.printerError });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {strings.settings.printerTitle}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {strings.settings.printerDesc}
        </p>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-sm border flex items-center gap-2 ${
            message.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {status.error && (
        <div className="p-3 rounded-lg text-sm border bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{status.error}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg">{strings.settings.printerConnection}</CardTitle>
                <CardDescription>
                  {status.deviceName || (status.connected ? strings.settings.printerConnected : strings.settings.printerDisconnected)}
                </CardDescription>
              </div>
            </div>
            <Badge
              variant="outline"
              className={
                status.connected
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                  : "bg-muted text-muted-foreground"
              }
            >
              {status.connected ? strings.settings.printerConnected : strings.settings.printerDisconnected}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Connection Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {strings.settings.printerConnection}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => updateConfig({ connectionType: "webserial" })}
                className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-colors ${
                  config.connectionType === "webserial"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-muted/50 text-foreground"
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Cable className="w-4 h-4" />
                  <span>Web Serial</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {strings.settings.printerWebSerial}
                </span>
              </button>

              <button
                type="button"
                onClick={() => updateConfig({ connectionType: "webusb" })}
                className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-colors ${
                  config.connectionType === "webusb"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-muted/50 text-foreground"
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Usb className="w-4 h-4" />
                  <span>WebUSB</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {strings.settings.printerWebUsb}
                </span>
              </button>

              <button
                type="button"
                onClick={() => updateConfig({ connectionType: "browser_dialog" })}
                className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-colors ${
                  config.connectionType === "browser_dialog"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-muted/50 text-foreground"
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Printer className="w-4 h-4" />
                  <span>Browser Print</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {strings.settings.printerBrowserDialog}
                </span>
              </button>
            </div>
          </div>

          {/* Paper Width & Print Mode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {strings.settings.paperWidth}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant={config.paperWidth === "80mm" ? "default" : "outline"}
                  onClick={() => updateConfig({ paperWidth: "80mm" })}
                  className="w-full text-xs"
                >
                  {strings.settings.paper80mm}
                </Button>
                <Button
                  type="button"
                  variant={config.paperWidth === "58mm" ? "default" : "outline"}
                  onClick={() => updateConfig({ paperWidth: "58mm" })}
                  className="w-full text-xs"
                >
                  {strings.settings.paper58mm}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {strings.settings.printMode}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant={config.mode === "raster" ? "default" : "outline"}
                  onClick={() => updateConfig({ mode: "raster" })}
                  className="w-full text-xs"
                >
                  {strings.settings.modeRaster}
                </Button>
                <Button
                  type="button"
                  variant={config.mode === "text" ? "default" : "outline"}
                  onClick={() => updateConfig({ mode: "text" })}
                  className="w-full text-xs"
                >
                  {strings.settings.modeText}
                </Button>
              </div>
            </div>
          </div>

          {/* Copies & Auto Print */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {strings.settings.autoPrintOnSale}
                </div>
                <div className="text-xs text-muted-foreground">
                  {strings.settings.autoPrintHelp}
                </div>
              </div>
              <input
                type="checkbox"
                checked={config.autoPrintOnSale}
                onChange={(e) => updateConfig({ autoPrintOnSale: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {strings.settings.printCopies}
                </div>
                <div className="text-xs text-muted-foreground">
                  1 – 3 copies
                </div>
              </div>
              <select
                value={config.copies}
                onChange={(e) => updateConfig({ copies: Number(e.target.value) })}
                className="rounded border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-4 border-t">
            {config.connectionType !== "browser_dialog" && (
              <>
                <Button
                  type="button"
                  onClick={handleConnect}
                  disabled={loading}
                  className="gap-2"
                >
                  <Cable className="w-4 h-4" />
                  {strings.settings.connectPrinter}
                </Button>

                {status.connected && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleDisconnect}
                    disabled={loading}
                    className="gap-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    {strings.settings.disconnectPrinter}
                  </Button>
                )}
              </>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={handleTestPrint}
              disabled={loading}
              className="gap-2"
            >
              <Play className="w-4 h-4" />
              {strings.settings.testPrint}
            </Button>

            {config.connectionType !== "browser_dialog" && (
              <Button
                type="button"
                variant="outline"
                onClick={handleOpenDrawer}
                disabled={loading}
                className="gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {strings.settings.openDrawer}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
