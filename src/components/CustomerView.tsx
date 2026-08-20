import React, { useState, useEffect } from 'react';
import { Mail, CheckCircle2, QrCode, RefreshCw, AlertCircle, ShieldCheck, ArrowRight } from 'lucide-react';
import { BarcodeRenderer } from './BarcodeRenderer';
import { ReceiptRequest } from '../types';
import { publishReceiptRequest, subscribeToOwnSession } from '../lib/syncService';

interface CustomerViewProps {
  onSessionCreated?: (req: ReceiptRequest) => void;
}

const COMMON_DOMAINS = ['@gmail.com', '@icloud.com', '@yahoo.com', '@outlook.com', '@hotmail.com'];

export const CustomerView: React.FC<CustomerViewProps> = ({ onSessionCreated }) => {
  const [emailInput, setEmailInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeSession, setActiveSession] = useState<ReceiptRequest | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(120);
  const [cashierStatus, setCashierStatus] = useState<'DISPLAYED' | 'COMPLETED' | null>(null);

  // Poll ONLY this customer's own request status - never the shared queue.
  // This is a privacy requirement: a customer's browser must never receive
  // other customers' emails, which the old shared-queue "monitor" used to do.
  useEffect(() => {
    if (!activeSession) {
      setCashierStatus(null);
      return;
    }
    const unsubscribe = subscribeToOwnSession(activeSession.id, (request) => {
      if (request) {
        if (request.status === 'DISPLAYED' || request.status === 'COMPLETED') {
          setCashierStatus(request.status);
        }
      }
    });
    return unsubscribe;
  }, [activeSession?.id]);

  // Detect basic device info
  const getDeviceInfo = (): string => {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return 'Apple iOS Safari';
    if (/Android/i.test(ua)) return 'Android Chrome';
    return 'Mobile Browser';
  };

  // Countdown timer for active session
  useEffect(() => {
    if (!activeSession) return;

    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const expiresAt = new Date(activeSession.expiresAt).getTime();
      const diff = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setTimeLeft(diff);

      if (diff === 0 && activeSession.status === 'PENDING') {
        setActiveSession(prev => prev ? { ...prev, status: 'EXPIRED' } : null);
      }
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [activeSession]);

  const handleDomainAppend = (domain: string) => {
    let current = emailInput.trim();
    if (current.includes('@')) {
      current = current.split('@')[0];
    }
    setEmailInput(`${current}${domain}`);
  };

  const isValidEmail = (email: string): boolean => {
    const clean = email.trim();
    if (!clean) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(clean);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanEmail = emailInput.trim();
    if (!isValidEmail(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    const newSession: ReceiptRequest = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `session_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      email: cleanEmail.toLowerCase(),
      barcodeData: cleanEmail.toLowerCase(),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      displayedAt: null,
      completedAt: null,
      expiresAt: new Date(Date.now() + 120 * 1000).toISOString(),
      deviceInfo: getDeviceInfo(),
    };

    setIsSubmitting(true);

    // Instantly publish to LocalStorage, BroadcastChannel, Express, and Cloud Relay
    publishReceiptRequest(newSession);

    // Update local UI immediately without waiting for any network response
    setActiveSession(newSession);
    if (onSessionCreated) {
      onSessionCreated(newSession);
    }
    setIsSubmitting(false);
  };

  const handleNewReceipt = () => {
    setActiveSession(null);
    setEmailInput('');
    setErrorMessage('');
  };

  const formatSeconds = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4 md:p-8 bg-[#F9FAFB] text-gray-900 font-sans">
      <div className="w-full max-w-sm mx-auto bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden relative">
        
        {/* Header */}
        <div className="p-6 pb-4 border-b border-gray-100 text-left">
          <div className="w-8 h-8 bg-black text-white rounded-lg flex items-center justify-center mb-3">
            <QrCode className="w-4 h-4" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">
            DIGITAL RECEIPT
          </h1>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
            Enter or select your email to receive your digital receipt.
          </p>
        </div>

        <div className="p-6 pt-5">
          {!activeSession ? (
            /* FORM STATE */
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>

              {errorMessage && (
                <div className="p-3 bg-red-50 border border-red-100 text-red-700 text-xs rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div>
                <label htmlFor="customer-email" className="block text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="customer-email"
                    type="email"
                    name="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="luca.rossi@gmail.com"
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    required
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 font-medium placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black focus:border-black transition text-sm"
                  />
                </div>
              </div>

              {/* Quick Domain Suggestion Chips */}
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                  Quick domain selector
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_DOMAINS.map((domain) => (
                    <button
                      key={domain}
                      type="button"
                      onClick={() => handleDomainAppend(domain)}
                      className="px-2.5 py-1 text-xs font-medium bg-gray-100 hover:bg-black hover:text-white text-gray-600 rounded-md border border-gray-200 transition active:scale-95"
                    >
                      {domain}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-[11px] leading-relaxed text-gray-500">
                <p>
                  <span className="font-semibold text-gray-700">IT:</span> La tua email viene usata esclusivamente per generare questo scontrino digitale e viene cancellata automaticamente dopo un breve periodo. Non verrà utilizzata per marketing o altri scopi, né condivisa con terzi.
                </p>
                <p className="mt-1.5">
                  <span className="font-semibold text-gray-700">EN:</span> Your email is used solely to generate this digital receipt and is automatically deleted after a short period. It will not be used for marketing or any other purpose, nor shared with third parties.
                </p>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !emailInput.trim()}
                className="w-full py-3.5 px-4 bg-black hover:bg-gray-800 text-white font-bold rounded-lg shadow-sm active:scale-[0.99] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm uppercase tracking-wider"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <span>CONTINUE</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="pt-2 flex items-center justify-center gap-1.5 text-[11px] text-gray-400 uppercase tracking-wider font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-gray-500" />
                <span>Secured & Auto-Deleted</span>
              </div>
            </form>
          ) : (
            /* SUCCESS BARCODE STATE */
            <div className="text-center space-y-5">
              <div className="inline-flex items-center justify-center p-2 bg-gray-100 text-gray-900 rounded-full mb-1">
                <CheckCircle2 className="w-6 h-6 text-black" />
              </div>

              <div>
                <span className="inline-block px-2.5 py-1 bg-black text-white text-[10px] font-bold rounded-full uppercase tracking-widest mb-1.5">
                  READY TO SCAN
                </span>
                <h2 className="text-base font-bold text-gray-900 break-all font-mono">
                  {activeSession.email}
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Show this barcode to the cashier at checkout
                </p>
              </div>

              {/* Code 128 Barcode Display */}
              <div className="py-2">
                <BarcodeRenderer
                  value={activeSession.barcodeData}
                  width={2.2}
                  height={110}
                  fontSize={14}
                />
              </div>

              {/* Status Banner */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 flex items-center justify-between">
                <span className="font-medium text-gray-500 uppercase text-[10px] tracking-wider">Cashier Status:</span>
                {cashierStatus === 'COMPLETED' ? (
                  <span className="font-bold text-green-600 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Completed
                  </span>
                ) : cashierStatus === 'DISPLAYED' ? (
                  <span className="font-bold text-green-600 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    Being scanned at register
                  </span>
                ) : (
                  <span className="font-bold text-gray-500 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                    Waiting for cashier
                  </span>
                )}
              </div>

              {/* Expiry Timer */}
              <div className="text-xs text-gray-400 font-mono">
                SESSION EXPIRES IN:{' '}
                <span className="font-bold text-gray-900">
                  {formatSeconds(timeLeft)}
                </span>
              </div>

              <button
                type="button"
                onClick={handleNewReceipt}
                className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-lg transition text-xs uppercase tracking-wider flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>ENTER ANOTHER EMAIL</span>
              </button>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

