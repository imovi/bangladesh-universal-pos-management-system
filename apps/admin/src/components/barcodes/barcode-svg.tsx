'use client';

import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeSvgProps {
  value: string;
  width?: number;
  height?: number;
  fontSize?: number;
  displayValue?: boolean;
  className?: string;
}

export function BarcodeSvg({
  value,
  width = 1.3,
  height = 36,
  fontSize = 11,
  displayValue = true,
  className = '',
}: BarcodeSvgProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        const isEan13 = /^\d{13}$/.test(value.trim());
        JsBarcode(svgRef.current, value.trim(), {
          format: isEan13 ? 'EAN13' : 'CODE128',
          width,
          height,
          fontSize,
          displayValue,
          margin: 0,
          font: 'monospace',
          textMargin: 2,
        });
      } catch (err) {
        console.error('JsBarcode rendering error for barcode:', value, err);
      }
    }
  }, [value, width, height, fontSize, displayValue]);

  return (
    <svg
      ref={svgRef}
      className={`mx-auto max-w-full ${className}`}
      data-testid={`barcode-svg-${value}`}
    />
  );
}
