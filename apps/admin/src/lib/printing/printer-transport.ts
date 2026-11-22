import { ESCPOS_COMMANDS } from "@universal-pos/shared";
import { PrinterDeviceConfig, getPrinterConfig } from "./printer-settings";

export interface PrinterStatus {
  connected: boolean;
  type: string;
  deviceName?: string;
  error?: string;
}

export interface PrinterTransport {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  print(data: Uint8Array): Promise<boolean>;
  openCashDrawer(): Promise<boolean>;
  getStatus(): PrinterStatus;
}

// Global active hardware handle references (persists in browser memory across component mounts)
let activeSerialPort: any = null;
let activeUsbDevice: any = null;

export class WebSerialPrinterTransport implements PrinterTransport {
  private config: PrinterDeviceConfig;

  constructor(config?: PrinterDeviceConfig) {
    this.config = config || getPrinterConfig();
  }

  getStatus(): PrinterStatus {
    const isSupported = typeof navigator !== "undefined" && "serial" in navigator;
    return {
      connected: Boolean(activeSerialPort),
      type: "webserial",
      deviceName: activeSerialPort ? "Serial Thermal Printer" : undefined,
      error: !isSupported ? "Web Serial is not supported in this browser. Use Chrome or Edge." : undefined,
    };
  }

  async connect(): Promise<boolean> {
    if (typeof navigator === "undefined" || !("serial" in navigator)) {
      throw new Error("Web Serial API is not supported in this browser. Please use Chrome or Edge.");
    }
    try {
      const serial = (navigator as any).serial;
      const port = await serial.requestPort();
      await port.open({ baudRate: this.config.baudRate || 9600 });
      activeSerialPort = port;
      return true;
    } catch (err: any) {
      if (err.name === "NotFoundError") {
        return false; // User cancelled prompt
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (activeSerialPort) {
      try {
        await activeSerialPort.close();
      } catch {
        // Ignore close error
      }
      activeSerialPort = null;
    }
  }

  async print(data: Uint8Array): Promise<boolean> {
    if (!activeSerialPort || !activeSerialPort.writable) {
      // Try to re-request or prompt
      const connected = await this.connect();
      if (!connected) return false;
    }

    const writer = activeSerialPort.writable.getWriter();
    try {
      await writer.write(data);
      return true;
    } finally {
      writer.releaseLock();
    }
  }

  async openCashDrawer(): Promise<boolean> {
    return this.print(ESCPOS_COMMANDS.DRAWER_KICK);
  }
}

export class WebUsbPrinterTransport implements PrinterTransport {
  private config: PrinterDeviceConfig;
  private endpointNumber = 1;

  constructor(config?: PrinterDeviceConfig) {
    this.config = config || getPrinterConfig();
  }

  getStatus(): PrinterStatus {
    const isSupported = typeof navigator !== "undefined" && "usb" in navigator;
    return {
      connected: Boolean(activeUsbDevice && activeUsbDevice.opened),
      type: "webusb",
      deviceName: activeUsbDevice?.productName || (activeUsbDevice ? "USB Thermal Printer" : undefined),
      error: !isSupported ? "WebUSB is not supported in this browser. Use Chrome or Edge." : undefined,
    };
  }

  async connect(): Promise<boolean> {
    if (typeof navigator === "undefined" || !("usb" in navigator)) {
      throw new Error("WebUSB API is not supported in this browser. Please use Chrome or Edge.");
    }
    try {
      const usb = (navigator as any).usb;
      const device = await usb.requestDevice({ filters: [] });
      await device.open();
      if (device.configuration === null) {
        await device.selectConfiguration(1);
      }
      await device.claimInterface(0);

      // Locate bulk out endpoint
      const iface = device.configuration.interfaces[0];
      const outEndpoint = iface.alternate.endpoints.find(
        (e: any) => e.direction === "out" && e.type === "bulk"
      );
      if (outEndpoint) {
        this.endpointNumber = outEndpoint.endpointNumber;
      }

      activeUsbDevice = device;
      return true;
    } catch (err: any) {
      if (err.name === "NotFoundError") {
        return false;
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (activeUsbDevice) {
      try {
        await activeUsbDevice.close();
      } catch {
        // ignore
      }
      activeUsbDevice = null;
    }
  }

  async print(data: Uint8Array): Promise<boolean> {
    if (!activeUsbDevice || !activeUsbDevice.opened) {
      const connected = await this.connect();
      if (!connected) return false;
    }

    try {
      await activeUsbDevice.transferOut(this.endpointNumber, data);
      return true;
    } catch (err) {
      throw new Error(`WebUSB print error: ${err}`);
    }
  }

  async openCashDrawer(): Promise<boolean> {
    return this.print(ESCPOS_COMMANDS.DRAWER_KICK);
  }
}

export class BrowserDialogPrinterTransport implements PrinterTransport {
  getStatus(): PrinterStatus {
    return {
      connected: true,
      type: "browser_dialog",
      deviceName: "Browser System Print Dialog",
    };
  }

  async connect(): Promise<boolean> {
    return true;
  }

  async disconnect(): Promise<void> {}

  async print(_data: Uint8Array): Promise<boolean> {
    if (typeof window !== "undefined") {
      window.print();
      return true;
    }
    return false;
  }

  async openCashDrawer(): Promise<boolean> {
    // Cannot kick cash drawer via browser print dialog
    return false;
  }
}

/**
 * Factory function returning the appropriate printer transport based on stored configuration.
 */
export function getPrinterTransport(config?: PrinterDeviceConfig): PrinterTransport {
  const currentConfig = config || getPrinterConfig();
  switch (currentConfig.connectionType) {
    case "webserial":
      return new WebSerialPrinterTransport(currentConfig);
    case "webusb":
      return new WebUsbPrinterTransport(currentConfig);
    case "browser_dialog":
    default:
      return new BrowserDialogPrinterTransport();
  }
}
