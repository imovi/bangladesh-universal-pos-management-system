"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n/context";
import { PermissionGate } from "@/components/common/permission-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  UploadCloud,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Layers,
  Boxes,
  Users,
} from "lucide-react";

type ImportType = "products" | "stock" | "customers";

interface ImportError {
  field: string;
  messageBn: string;
  messageEn: string;
}

interface ImportRowResult {
  rowNumber: number;
  status: "OK" | "ERROR";
  action?: "CREATE" | "UPDATE" | "SKIP";
  errors: ImportError[];
  data: Record<string, any>;
}

interface ImportPreviewResult {
  type: ImportType;
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: ImportRowResult[];
}

export default function ImportPage() {
  const { apiFetch } = useAuth();
  const { strings, locale } = useTranslation();
  const t = strings.importData;

  const [activeTab, setActiveTab] = useState<ImportType>("products");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Pagination for preview table
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const handleTabChange = (tab: ImportType) => {
    setActiveTab(tab);
    setSelectedFile(null);
    setFileContent("");
    setPreview(null);
    setStatusMessage(null);
    setPage(1);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setStatusMessage(null);
    setPreview(null);
    setPage(1);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setFileContent(content);
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await apiFetch(`/import/templates/${activeTab}`, {
        method: "GET",
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeTab}-template.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      setStatusMessage({ type: "error", text: "টেমপ্লেট ডাউনলোড করতে ব্যর্থ হয়েছে" });
    }
  };

  const handlePreview = async () => {
    if (!fileContent) {
      setStatusMessage({ type: "error", text: t.emptyFile });
      return;
    }

    setLoading(true);
    setStatusMessage(null);

    try {
      const res = await apiFetch("/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activeTab,
          csvText: fileContent,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || json.message || "Failed to preview");
      }

      setPreview(json.data);
      setPage(1);
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Preview failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!preview || preview.errorRows > 0) return;

    setCommitting(true);
    setStatusMessage(null);

    try {
      const res = await apiFetch("/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activeTab,
          csvText: fileContent,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || json.message || t.commitError);
      }

      setStatusMessage({
        type: "success",
        text: json.data?.message || t.commitSuccess,
      });
      setPreview(null);
      setSelectedFile(null);
      setFileContent("");
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || t.commitError });
    } finally {
      setCommitting(false);
    }
  };

  const handleDownloadErrors = () => {
    if (!preview || preview.errorRows === 0) return;

    const errorRows = preview.rows.filter((r) => r.status === "ERROR");
    const headers = ["line_number", "error_field", "error_message_bn", "error_message_en"];
    const csvLines = [headers.join(",")];

    for (const r of errorRows) {
      for (const err of r.errors) {
        csvLines.push(
          `${r.rowNumber},"${err.field}","${err.messageBn.replace(/"/g, '""')}","${err.messageEn.replace(/"/g, '""')}"`
        );
      }
    }

    const blob = new Blob(["\uFEFF" + csvLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeTab}-import-errors.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  // Paginated rows
  const displayedRows = preview?.rows.slice((page - 1) * pageSize, page * pageSize) || [];
  const totalPages = preview ? Math.ceil(preview.rows.length / pageSize) : 1;

  return (
    <PermissionGate permission="data.import">
      <div className="space-y-6 max-w-6xl pb-16">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t.subtitle}</p>
          </div>
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div
            className={`p-4 rounded-lg flex items-center gap-3 text-sm font-medium ${
              statusMessage.type === "success"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                : "bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800"
            }`}
          >
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="h-5 w-5 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Tab Selection */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => handleTabChange("products")}
            className={`p-4 rounded-lg border text-left transition-colors flex items-center gap-3 ${
              activeTab === "products"
                ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary font-medium"
                : "border-border bg-card text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Layers className="h-5 w-5 text-primary" />
            <div>
              <div className="text-sm font-semibold text-foreground">{t.productsTab}</div>
              <div className="text-xs text-muted-foreground mt-0.5">name, category, size, sku, price...</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("stock")}
            className={`p-4 rounded-lg border text-left transition-colors flex items-center gap-3 ${
              activeTab === "stock"
                ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary font-medium"
                : "border-border bg-card text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Boxes className="h-5 w-5 text-primary" />
            <div>
              <div className="text-sm font-semibold text-foreground">{t.stockTab}</div>
              <div className="text-xs text-muted-foreground mt-0.5">sku, branch_code, quantity, cost</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("customers")}
            className={`p-4 rounded-lg border text-left transition-colors flex items-center gap-3 ${
              activeTab === "customers"
                ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary font-medium"
                : "border-border bg-card text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Users className="h-5 w-5 text-primary" />
            <div>
              <div className="text-sm font-semibold text-foreground">{t.customersTab}</div>
              <div className="text-xs text-muted-foreground mt-0.5">name, phone, due, points</div>
            </div>
          </button>
        </div>

        {/* Upload Card */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  {activeTab === "products" && t.productsTab}
                  {activeTab === "stock" && t.stockTab}
                  {activeTab === "customers" && t.customersTab}
                </CardTitle>
                <CardDescription className="text-xs mt-1">{t.selectFileHint}</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
                className="gap-2 shrink-0 self-start sm:self-auto"
              >
                <Download className="h-4 w-4" />
                {t.downloadTemplate}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <label className="flex-1 cursor-pointer">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="border-2 border-dashed border-border rounded-lg p-4 hover:border-primary/50 transition-colors flex items-center gap-3 text-sm text-muted-foreground">
                  <FileSpreadsheet className="h-5 w-5 text-primary shrink-0" />
                  <span className="truncate">
                    {selectedFile ? selectedFile.name : t.chooseFile}
                  </span>
                </div>
              </label>

              <Button
                onClick={handlePreview}
                disabled={!selectedFile || loading}
                className="gap-2"
              >
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {t.previewBtn}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview Summary & Commit Section */}
        {preview && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg bg-card border border-border">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-semibold text-foreground">
                  {t.totalRows}: {preview.totalRows}
                </span>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300">
                  {t.validRows}: {preview.validRows}
                </Badge>
                {preview.errorRows > 0 && (
                  <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300">
                    {t.errorRows}: {preview.errorRows}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                {preview.errorRows > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadErrors}
                    className="gap-2 text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800"
                  >
                    <Download className="h-4 w-4" />
                    {t.downloadErrors}
                  </Button>
                ) : (
                  <Button
                    onClick={handleCommit}
                    disabled={committing}
                    className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {committing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {t.commitBtn}
                  </Button>
                )}
              </div>
            </div>

            {/* Banner based on preview status */}
            {preview.errorRows > 0 ? (
              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 flex items-center gap-3 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{t.hasErrorsNotice}</span>
              </div>
            ) : (
              <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 flex items-center gap-3 text-xs text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{t.readyToCommit}</span>
              </div>
            )}

            {/* Preview Table */}
            <div className="border border-border rounded-lg overflow-hidden bg-card">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted text-muted-foreground uppercase border-b border-border text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3 w-16">{t.rowCol}</th>
                      <th className="py-2.5 px-3 w-20">{t.statusCol}</th>
                      <th className="py-2.5 px-3 w-24">{t.actionCol}</th>
                      <th className="py-2.5 px-3">{t.detailsCol}</th>
                      <th className="py-2.5 px-3">{t.reasonsCol}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {displayedRows.map((row) => (
                      <tr key={row.rowNumber} className={row.status === "ERROR" ? "bg-red-50/40 dark:bg-red-950/20" : ""}>
                        <td className="py-2.5 px-3 font-mono text-muted-foreground">{row.rowNumber}</td>
                        <td className="py-2.5 px-3">
                          {row.status === "OK" ? (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-[10px] px-1.5 py-0">
                              {t.statusOk}
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                              {t.statusError}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {row.action === "UPDATE" ? (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">{t.actionUpdate}</span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t.actionCreate}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 max-w-xs truncate text-foreground font-mono">
                          {activeTab === "products" && `${row.data.productName || ""} [${row.data.sku || ""}]`}
                          {activeTab === "stock" && `${row.data.sku || ""} (${row.data.branchCode || ""}): ${row.data.quantity}`}
                          {activeTab === "customers" && `${row.data.name || ""} [${row.data.phone || ""}]`}
                        </td>
                        <td className="py-2.5 px-3">
                          {row.errors.length > 0 ? (
                            <div className="space-y-1">
                              {row.errors.map((err, i) => (
                                <div key={i} className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1.5">
                                  <span>•</span>
                                  <span>{locale === "bn" ? err.messageBn : err.messageEn}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Table Pagination */}
              {totalPages > 1 && (
                <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <div>
                    পৃষ্ঠা {page} / {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="h-7 text-xs"
                    >
                      পূর্ববর্তী
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="h-7 text-xs"
                    >
                      পরবর্তী
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
