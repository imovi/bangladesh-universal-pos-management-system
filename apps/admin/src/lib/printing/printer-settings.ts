export type PrinterConnectionType = "webserial" | "webusb" | "browser_dialog";
export type PrinterPaperWidth = "80mm" | "58mm";
export type PrinterMode = "raster" | "text";

export interface PrinterDeviceConfig {
  connectionType: PrinterConnectionType;
  paperWidth: PrinterPaperWidth;
  mode: PrinterMode;
  autoPrintOnSale: boolean;
  copies: number;
  openCashDrawer: boolean;
  baudRate: number; // For serial, default 9600
}

const STORAGE_KEY = "universal_pos_printer_config";

export const DEFAULT_PRINTER_CONFIG: PrinterDeviceConfig = {
  connectionType: "browser_dialog",
  paperWidth: "80mm",
  mode: "raster",
  autoPrintOnSale: true,
  copies: 1,
  openCashDrawer: true,
  baudRate: 9600,
};

export function getPrinterConfig(): PrinterDeviceConfig {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_PRINTER_CONFIG;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRINTER_CONFIG;
    return { ...DEFAULT_PRINTER_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PRINTER_CONFIG;
  }
}

export function savePrinterConfig(config: Partial<PrinterDeviceConfig>): PrinterDeviceConfig {
  const current = getPrinterConfig();
  const updated: PrinterDeviceConfig = { ...current, ...config };
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // storage quota or private browsing
    }
  }
  return updated;
}
