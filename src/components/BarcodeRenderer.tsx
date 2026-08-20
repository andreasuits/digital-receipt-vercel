import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeRendererProps {
  value: string;
  format?: 'CODE128';
  width?: number;
  height?: number;
  fontSize?: number;
  displayValue?: boolean;
  className?: string;
}

export const BarcodeRenderer: React.FC<BarcodeRendererProps> = ({
  value,
  format = 'CODE128',
  width = 2.5,
  height = 120,
  fontSize = 18,
  displayValue = true,
  className = '',
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        // Clear previous barcode content
        svgRef.current.innerHTML = '';
        
        JsBarcode(svgRef.current, value, {
          format,
          width,
          height,
          displayValue,
          fontSize,
          fontOptions: 'bold',
          font: 'monospace',
          textMargin: 8,
          margin: 16, // Generous quiet zone for scanner legibility
          background: '#ffffff',
          lineColor: '#000000',
        });
      } catch (err) {
        console.error('Barcode generation error:', err);
      }
    }
  }, [value, format, width, height, fontSize, displayValue]);

  return (
    <div className={`inline-block bg-white p-4 rounded-xl shadow-sm border border-slate-200 ${className}`}>
      <svg ref={svgRef} className="max-w-full h-auto mx-auto block"></svg>
    </div>
  );
};
