import React, { useState, useEffect } from 'react';
import { QrCode, Printer, Download, Sparkles, Store, Copy, Check, Lock } from 'lucide-react';
import QRCode from 'qrcode';

export const AdminQrView: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return !!sessionStorage.getItem('cashier_token');
  });
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');

  const [qrUrl, setQrUrl] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [storeName, setStoreName] = useState<string>('MODA ITALIA');
  const [subtitle, setSubtitle] = useState<string>('Scontrino Digitale via Email / Digital Receipt');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const currentHost = window.location.origin;
    const targetCustomerUrl = `${currentHost}/?view=customer`;
    setQrUrl(targetCustomerUrl);

    QRCode.toDataURL(targetCustomerUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch((err) => {
        console.error('Failed to generate QR code data URL:', err);
      });
  }, []);

  const handleUrlChange = (newUrl: string) => {
    setQrUrl(newUrl);
    if (newUrl.trim()) {
      QRCode.toDataURL(newUrl, {
        width: 400,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
        .then(setQrDataUrl)
        .catch((err) => {
          console.error('Failed to generate QR code data URL:', err);
        });
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');

    try {
      const res = await fetch('/api/cashier/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.token) {
        sessionStorage.setItem('cashier_token', data.token);
        setIsAuthenticated(true);
        setPinInput('');
      } else {
        setPinError('Incorrect PIN. Default PIN is 1234.');
      }
    } catch (err) {
      setPinError('Authentication error');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-[88vh] flex items-center justify-center p-4 bg-[#F9FAFB] text-gray-900 font-sans">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl p-8 shadow-sm text-center">
          <div className="w-12 h-12 bg-black text-white rounded-xl flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6" />
          </div>

          <h2 className="text-xl font-bold text-gray-900 mb-1 tracking-tight">ADMIN ACCESS</h2>
          <p className="text-xs text-gray-500 mb-6">
            Enter PIN code to access Counter Stand Generator
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            {pinError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 p-2.5 rounded-lg">
                {pinError}
              </p>
            )}

            <div>
              <input
                type="password"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="PIN Code (Default 1234)"
                autoFocus
                className="w-full text-center tracking-[0.5em] text-2xl font-mono py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-black hover:bg-gray-800 text-white font-bold rounded-lg shadow-sm transition active:scale-[0.99] text-xs uppercase tracking-wider"
            >
              UNLOCK ADMIN
            </button>
          </form>
        </div>
      </div>
    );
  }

  const handlePrint = () => {
    window.print();
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(qrUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-[88vh] bg-[#F9FAFB] text-gray-900 p-6 flex flex-col items-center font-sans">
      
      {/* Controls Header (Hidden during printing) */}
      <div className="w-full max-w-2xl bg-white p-6 rounded-2xl shadow-sm border border-gray-200 mb-8 print:hidden space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2 uppercase tracking-wide">
              <Store className="w-5 h-5 text-black" />
              <span>Counter QR Stand Generator</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Print and place this stand at your checkout counter for tourists and customers.
            </p>
          </div>

          <button
            onClick={handlePrint}
            className="py-2.5 px-4 bg-black hover:bg-gray-800 text-white font-bold rounded-lg shadow-sm transition flex items-center gap-2 text-xs uppercase tracking-wider"
          >
            <Printer className="w-4 h-4" />
            <span>PRINT COUNTER STAND</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-1">
              Store Header Name
            </label>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold text-gray-900 focus:ring-2 focus:ring-black"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-1">
              Subtitle / Instructions
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-black"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-gray-100 space-y-1.5">
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
            Target Single Application URL (QR Code points here)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={qrUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="flex-1 p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono text-gray-900 focus:ring-2 focus:ring-black"
              placeholder="https://..."
            />
            <button
              onClick={handleCopyUrl}
              type="button"
              className="py-2 px-3 bg-gray-100 hover:bg-gray-200 text-black font-bold rounded-lg border border-gray-200 flex items-center gap-1 uppercase text-[10px] tracking-wider shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy URL'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* PRINTABLE STAND CARD (Formatted for standard paper or counter acrylic stand) */}
      <div className="w-full max-w-md bg-white border-2 border-black rounded-3xl p-8 shadow-sm text-center space-y-6 print:border-0 print:shadow-none print:w-full print:max-w-none print:p-0">
        
        {/* Top Header Banner */}
        <div className="space-y-1">
          <span className="inline-block px-3 py-1 bg-black text-white text-[10px] font-bold rounded-full uppercase tracking-widest">
            {storeName}
          </span>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight uppercase pt-2">
            SCONTRINO DIGITALE
          </h1>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Digital Receipt Service
          </p>
        </div>

        {/* QR Code Canvas */}
        <div className="bg-gray-50 border-2 border-black p-6 rounded-2xl inline-block shadow-xs mx-auto my-2">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR Code pointing to ${qrUrl}`}
              className="w-56 h-56 mx-auto object-contain rounded-lg"
            />
          ) : (
            <div className="w-56 h-56 bg-gray-200 animate-pulse rounded-xl flex items-center justify-center">
              <QrCode className="w-12 h-12 text-gray-400" />
            </div>
          )}
        </div>

        {/* Instructions for Tourist/Customer */}
        <div className="space-y-2 max-w-xs mx-auto">
          <div className="flex items-center justify-center gap-2 text-xs font-bold text-gray-900 uppercase tracking-wide">
            <Sparkles className="w-4 h-4 text-black" />
            <span>Inquadra con il tuo smartphone</span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Scan the QR code with your phone camera. No app download required.
          </p>
        </div>

        <div className="pt-4 border-t border-gray-100 text-[11px] text-gray-400 font-mono">
          {subtitle}
        </div>

      </div>

    </div>
  );
};
