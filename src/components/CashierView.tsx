import React, { useState, useEffect, useRef } from 'react';
import {
  Lock,
  Copy,
  Check,
  Volume2,
  VolumeX,
  Sun,
  Settings as SettingsIcon,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  LogOut,
  ChevronRight,
  Send,
  SlidersHorizontal,
  Wifi,
  WifiOff,
  UserCheck,
  HelpCircle,
  Keyboard,
  AlertCircle
} from 'lucide-react';
import { BarcodeRenderer } from './BarcodeRenderer';
import { AppConfig, ReceiptRequest, RequestStatus } from '../types';
import { subscribeToQueue, updateRequestStatus, getStorageHealth, StorageHealth } from '../lib/syncService';

interface CashierViewProps {
  initialConfig?: AppConfig;
}

export const CashierView: React.FC<CashierViewProps> = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    // Real access control: only start authenticated if a session token from a
    // previous successful PIN entry is still present. Never default to true.
    if (typeof window === 'undefined') return false;
    return !!sessionStorage.getItem('cashier_token');
  });
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');

  const [requests, setRequests] = useState<ReceiptRequest[]>([]);
  const [config, setConfig] = useState<AppConfig>({
    cashierPin: '1234',
    autoExpireSeconds: 120,
    dataRetentionMinutes: 10,
    appendEnterKey: false,
    storeName: 'MODA ITALIA - Digital Receipt',
    storeSubtitle: 'Scan for instant email receipt',
    highBrightnessAlert: true,
    soundEnabled: true,
  });

  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [storageHealth, setStorageHealth] = useState<StorageHealth>({ ok: true, checked: false });
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [soundOn, setSoundOn] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showItalianFixModal, setShowItalianFixModal] = useState<boolean>(false);

  // Form states for settings
  const [editPin, setEditPin] = useState(config.cashierPin);
  const [editTimeout, setEditTimeout] = useState(config.autoExpireSeconds);
  const [editEnterKey, setEditEnterKey] = useState(config.appendEnterKey);
  const [editRetention, setEditRetention] = useState(config.dataRetentionMinutes);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const getAuthHeaders = () => {
    const token = sessionStorage.getItem('cashier_token') || '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  };

  // Handle Cashier PIN Auth
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

  const handleLogout = () => {
    sessionStorage.removeItem('cashier_token');
    setIsAuthenticated(false);
  };

  // Sound chime helper using Web Audio API synth
  const playAlertSound = () => {
    if (!soundOn) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.log('Audio playback prevented');
    }
  };

  // Merge queue items without duplicates
  const mergeQueue = (newItems: ReceiptRequest[]) => {
    setRequests(prev => {
      const map = new Map<string, ReceiptRequest>();
      const now = Date.now();

      // Put existing items if not expired
      prev.forEach(item => {
        if (item.expiresAt && new Date(item.expiresAt).getTime() <= now) return;
        if (item.status === 'EXPIRED' || item.status === 'COMPLETED') return;
        map.set(item.id, item);
      });

      // Put new items if not expired
      newItems.forEach(item => {
        if (item.expiresAt && new Date(item.expiresAt).getTime() <= now) return;
        if (item.status === 'EXPIRED' || item.status === 'COMPLETED') return;
        map.set(item.id, item);
      });

      const merged = Array.from(map.values()).sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      if (merged.length > prev.length) {
        playAlertSound();
      }

      return merged;
    });
  };

  // 1-second interval to automatically delete/purge expired items (> 2 minutes) from the Cashier screen
  useEffect(() => {
    const purgeInterval = setInterval(() => {
      const now = Date.now();
      setRequests(prev => {
        const unexpired = prev.filter(item => {
          if (item.status === 'EXPIRED' || item.status === 'COMPLETED') return false;
          if (item.expiresAt && new Date(item.expiresAt).getTime() <= now) return false;
          return true;
        });
        if (unexpired.length !== prev.length) {
          return unexpired;
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(purgeInterval);
  }, []);

  // If the backend rejects our session token (expired/invalid), fall back
  // to the PIN screen instead of silently showing a stuck/empty queue.
  useEffect(() => {
    const handleExpired = () => {
      sessionStorage.removeItem('cashier_token');
      setIsAuthenticated(false);
    };
    window.addEventListener('cashier-auth-expired', handleExpired);
    return () => window.removeEventListener('cashier-auth-expired', handleExpired);
  }, []);

  // Universal Sync Subscription across devices (Vercel + Upstash Redis backend)
  useEffect(() => {
    if (!isAuthenticated) return;

    setSseConnected(true);
    const unsubscribe = subscribeToQueue((queue) => {
      mergeQueue(queue);
      setStorageHealth(getStorageHealth());
    });

    return () => {
      unsubscribe();
    };
  }, [isAuthenticated]);

  // Active items
  const pendingRequests = requests.filter(r => r.status === 'PENDING' || r.status === 'DISPLAYED');
  const currentRequest = selectedRequestId
    ? requests.find(r => r.id === selectedRequestId) || pendingRequests[0]
    : pendingRequests[0];

  // Auto update request status to DISPLAYED when viewed on iPad
  useEffect(() => {
    if (currentRequest && currentRequest.status === 'PENDING') {
      fetch('/api/cashier/update-status', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ id: currentRequest.id, status: 'DISPLAYED' }),
      }).catch(console.error);
    }
  }, [currentRequest?.id]);

  const handleUpdateStatus = async (id: string, status: RequestStatus) => {
    try {
      await fetch('/api/cashier/update-status', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ id, status }),
      });
      setSelectedRequestId(null);
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  const handleCopyEmail = (email: string) => {
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/cashier/config', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          cashierPin: editPin,
          autoExpireSeconds: Number(editTimeout),
          appendEnterKey: editEnterKey,
          dataRetentionMinutes: Number(editRetention),
        }),
      });
      if (res.ok) {
        setShowSettings(false);
      }
    } catch (err) {
      console.error('Failed to update settings', err);
    }
  };

  // PIN AUTH SCREEN
  if (!isAuthenticated) {
    return (
      <div className="min-h-[88vh] flex items-center justify-center p-4 bg-[#F9FAFB] text-gray-900">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl p-8 shadow-sm text-center">
          <div className="w-12 h-12 bg-black text-white rounded-xl flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6" />
          </div>

          <h2 className="text-xl font-bold text-gray-900 mb-1 tracking-tight">CASHIER IPAD LOGIN</h2>
          <p className="text-xs text-gray-500 mb-6">
            Enter Cashier PIN to unlock the scanning screen
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
              UNLOCK CASHIER IPAD
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-gray-900 flex flex-col font-sans">
      
      {/* CASHIER HEADER */}
      <header className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between sticky top-16 z-30 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-black text-white rounded-lg">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base text-gray-900 tracking-wide uppercase flex items-center gap-2">
              <span>CASHIER DISPLAY</span>
              <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-600 font-bold">
                iPad Station
              </span>
            </h1>
            <p className="text-xs text-gray-500">
              {config.storeName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* SSE Status */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono border ${
            sseConnected 
              ? 'bg-green-50 border-green-200/80 text-green-700 font-semibold' 
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            {sseConnected ? <Wifi className="w-3.5 h-3.5 text-green-600" /> : <WifiOff className="w-3.5 h-3.5 text-amber-600 animate-pulse" />}
            <span>{sseConnected ? 'Realtime Connected' : 'Connecting...'}</span>
          </div>

          {/* Sound Toggle */}
          <button
            onClick={() => setSoundOn(!soundOn)}
            className="p-2 bg-white hover:bg-gray-50 text-gray-700 rounded-lg border border-gray-200 transition"
            title="Toggle Sound Alerts"
          >
            {soundOn ? <Volume2 className="w-4 h-4 text-black" /> : <VolumeX className="w-4 h-4 text-gray-400" />}
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 bg-white hover:bg-gray-50 text-gray-700 rounded-lg border border-gray-200 transition"
            title="Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>

          {/* Lock */}
          <button
            onClick={() => setIsAuthenticated(false)}
            className="p-2 bg-white hover:bg-red-50 text-gray-500 hover:text-red-600 rounded-lg border border-gray-200 transition"
            title="Lock Display"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* SHARED STORAGE WARNING - shown when phone -> iPad sync is broken */}
      {storageHealth.checked && !storageHealth.ok && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">
            <p className="font-semibold">Sincronizzazione tra dispositivi non funzionante.</p>
            <p className="mt-0.5">
              Le email inviate dal telefono potrebbero non arrivare qui. Vai su{' '}
              <code className="bg-red-100 px-1 py-0.5 rounded font-mono text-xs">/api/diag/storage</code>{' '}
              per la diagnosi, e verifica di aver installato l'integrazione <code className="bg-red-100 px-1 py-0.5 rounded font-mono text-xs">Upstash</code> da Vercel Marketplace (variabili{' '}
              <code className="bg-red-100 px-1 py-0.5 rounded font-mono text-xs">UPSTASH_REDIS_REST_URL</code>/<code className="bg-red-100 px-1 py-0.5 rounded font-mono text-xs">TOKEN</code>{' '}
              oppure <code className="bg-red-100 px-1 py-0.5 rounded font-mono text-xs">KV_REST_API_URL</code>/<code className="bg-red-100 px-1 py-0.5 rounded font-mono text-xs">TOKEN</code>).
              {storageHealth.error ? ` (${storageHealth.error})` : ''}
            </p>
          </div>
        </div>
      )}

      {/* MAIN TWO-COLUMN DASHBOARD (iPad Layout) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 max-w-7xl w-full mx-auto">
        
        {/* LEFT COLUMN: ACTIVE BARCODE SCANNER DISPLAY (2 Cols on lg) */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          
          {currentRequest ? (
            <div className="bg-white border border-gray-200 rounded-3xl p-6 md:p-8 flex flex-col items-center justify-between shadow-sm relative overflow-hidden">
              
              {/* Highlight Bar */}
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-black"></div>

              {/* Status Header */}
              <div className="w-full flex items-center justify-between mb-4">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 text-xs font-bold uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-ping"></span>
                  READY TO SCAN
                </span>

                <div className="text-xs text-gray-400 flex items-center gap-1 font-mono">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  <span>{new Date(currentRequest.createdAt).toLocaleTimeString()}</span>
                </div>
              </div>

              {/* Email Display */}
              <div className="text-center my-2 max-w-full">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1">
                  Customer Email Address
                </p>
                <div className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight break-all font-mono">
                  {currentRequest.email}
                </div>
              </div>

              {/* Code 128 Barcode Display Area (Optimized for Scanner) */}
              <div className="my-6 w-full flex flex-col items-center">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 max-w-full overflow-x-auto text-center">
                  <BarcodeRenderer
                    value={currentRequest.barcodeData}
                    width={3.0}
                    height={160}
                    fontSize={22}
                    className="border-none shadow-none p-0"
                  />
                  <div className="mt-2 text-gray-900 font-mono font-bold text-sm tracking-widest border-t border-gray-100 pt-2">
                    {currentRequest.barcodeData.replace('\n', ' [ENTER]')}
                  </div>
                </div>

                {config.appendEnterKey && (
                  <span className="mt-2 text-[11px] text-gray-600 font-mono bg-gray-100 px-3 py-1 rounded-full border border-gray-200">
                    ⏎ ENTER/RETURN key suffix enabled
                  </span>
                )}
              </div>

              {/* iPad Scanner Tip */}
              <div className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-gray-600 text-xs flex items-center gap-2 mb-3">
                <Sun className="w-4 h-4 shrink-0 text-gray-900" />
                <span>
                  <strong>iPad Screen Scan Tip:</strong> Point POS barcode reader directly at the white box above. Ensure iPad screen brightness is set to max.
                </span>
              </div>

              {/* Italian POS Scanner Helper Box */}
              <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-900 text-xs flex items-center justify-between gap-2 mb-6">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>
                    <strong>Cassa Italiana:</strong> Il tuo lettore spara <strong>"</strong> al posto di <strong>@</strong>?
                  </span>
                </div>
                <button
                  onClick={() => setShowItalianFixModal(true)}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] rounded-lg transition shrink-0 uppercase tracking-wider flex items-center gap-1 shadow-xs"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Come Risolvere</span>
                </button>
              </div>

              {/* Actions Footer */}
              <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  onClick={() => handleCopyEmail(currentRequest.email)}
                  className="py-3.5 px-4 bg-white hover:bg-gray-50 text-gray-900 font-bold rounded-xl border-2 border-gray-900 transition flex items-center justify-center gap-2 text-xs uppercase tracking-wider"
                >
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copied Email!' : 'Copy Email Address'}</span>
                </button>

                <button
                  onClick={() => handleUpdateStatus(currentRequest.id, 'COMPLETED')}
                  className="py-3.5 px-4 bg-black hover:bg-gray-800 text-white font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2 text-xs uppercase tracking-wider active:scale-[0.99]"
                >
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  <span>MARK AS SCANNED / DONE</span>
                </button>
              </div>

            </div>
          ) : (
            /* EMPTY WAITING STATE */
            <div className="bg-white border border-gray-200 rounded-3xl p-12 text-center flex flex-col items-center justify-center min-h-[400px] shadow-sm">
              <div className="w-14 h-14 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mb-4">
                <RefreshCw className="w-7 h-7 animate-spin" />
              </div>
              <h3 className="text-base font-bold text-gray-900 mb-1 uppercase tracking-wide">WAITING FOR NEXT CUSTOMER</h3>
              <p className="text-xs text-gray-500 max-w-sm">
                When a customer inputs their email on their phone, the barcode will appear here automatically in real time.
              </p>
            </div>
          )}

        </div>

        {/* RIGHT COLUMN: QUEUE & RECENT HISTORY */}
        <div className="bg-white border border-gray-200 rounded-3xl p-5 flex flex-col h-[600px] overflow-hidden shadow-sm">
          
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
            <h2 className="font-bold text-xs text-gray-900 flex items-center gap-2 uppercase tracking-wider">
              <span>ACTIVE QUEUE</span>
              <span className="px-2 py-0.5 bg-black text-white text-[10px] rounded-full font-mono font-bold">
                {pendingRequests.length}
              </span>
            </h2>

            <span className="text-[11px] text-gray-400 font-mono">
              Auto-expires in {config.autoExpireSeconds}s
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
            {requests.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-xs">
                No active requests in queue
              </div>
            ) : (
              requests.map((req) => {
                const isSelected = currentRequest?.id === req.id;
                const isPending = req.status === 'PENDING' || req.status === 'DISPLAYED';

                return (
                  <div
                    key={req.id}
                    onClick={() => setSelectedRequestId(req.id)}
                    className={`p-3.5 rounded-2xl border transition cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-gray-50 border-black shadow-xs'
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`w-2 h-2 rounded-full ${
                          req.status === 'COMPLETED' ? 'bg-black' :
                          req.status === 'EXPIRED' ? 'bg-gray-300' : 'bg-green-500 animate-pulse'
                        }`} />
                        <span className="text-xs font-bold text-gray-900 truncate font-mono">
                          {req.email}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400 block font-mono">
                        {new Date(req.createdAt).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        req.status === 'COMPLETED' ? 'bg-gray-100 text-gray-800' :
                        req.status === 'EXPIRED' ? 'bg-gray-100 text-gray-400' :
                        'bg-green-50 text-green-700 border border-green-200'
                      }`}>
                        {req.status}
                      </span>
                      {isPending && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUpdateStatus(req.id, 'COMPLETED');
                          }}
                          className="p-1.5 bg-black hover:bg-gray-800 text-white rounded-md transition text-xs"
                          title="Complete"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

        </div>

      </div>

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-gray-200 rounded-3xl p-6 max-w-md w-full shadow-xl text-gray-900">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-black" />
                <span>Cashier System Settings</span>
              </h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-gray-400 hover:text-black font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Cashier PIN Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={editPin}
                  onChange={(e) => setEditPin(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 font-mono text-sm focus:ring-2 focus:ring-black"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Auto-Expiration Timeout (seconds)
                </label>
                <input
                  type="number"
                  min={30}
                  max={600}
                  value={editTimeout}
                  onChange={(e) => setEditTimeout(Number(e.target.value))}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 font-mono text-sm focus:ring-2 focus:ring-black"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div>
                  <span className="block text-xs font-bold text-gray-900">
                    Append ENTER/RETURN Key
                  </span>
                  <span className="text-[10px] text-gray-500">
                    Appends \n so HID barcode reader auto-submits input field
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={editEnterKey}
                  onChange={(e) => setEditEnterKey(e.target.checked)}
                  className="w-5 h-5 accent-black rounded cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Privacy Retention (minutes before auto-deletion)
                </label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={editRetention}
                  onChange={(e) => setEditRetention(Number(e.target.value))}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 font-mono text-sm focus:ring-2 focus:ring-black"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-bold text-xs uppercase"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-black hover:bg-gray-800 text-white font-bold rounded-lg text-xs uppercase"
                >
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ITALIAN POS KEYBOARD FIX MODAL */}
      {showItalianFixModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-gray-200 rounded-3xl p-6 max-w-lg w-full shadow-2xl text-gray-900">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-amber-600" />
                <span>Soluzione Cassa: Lettore spara " al posto di @</span>
              </h3>
              <button
                onClick={() => setShowItalianFixModal(false)}
                className="text-gray-400 hover:text-black font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs text-gray-700 leading-relaxed">
              <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-2xl text-amber-900">
                <p className="font-bold mb-1 text-sm">Perché succede questo?</p>
                <p>
                  I lettori di codici a barre USB simulano una tastiera americana (US Standard).
                  Sulla tastiera americana il tasto per la chiocciola è <code className="bg-amber-100 px-1 rounded font-mono font-bold">Shift + 2</code>.
                  Quando il lettore spara il codice sul PC della cassa con tastiera <strong>Italiana</strong>, Windows/POS traduce <code className="bg-amber-100 px-1 rounded font-mono font-bold">Shift + 2</code> nel carattere <strong>"</strong> (virgolette).
                </p>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-xs mb-2 uppercase tracking-wide">3 Soluzioni veloci ed efficaci:</h4>
                
                <div className="space-y-2.5">
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <p className="font-bold text-gray-900 text-xs mb-0.5">1. Cambia lingua tastiera su Windows / Cassa (Più veloce)</p>
                    <p className="text-gray-600">
                      Premi <kbd className="px-1.5 py-0.5 bg-gray-200 rounded font-mono text-[11px] font-bold">Alt + Shift</kbd> sulla tastiera del PC cassa per passare alla lingua <strong>ENG (Inglese US)</strong> prima di sparare il codice a barre.
                    </p>
                  </div>

                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <p className="font-bold text-gray-900 text-xs mb-0.5">2. Configura il Lettore Barcode su Tastiera Italiana (Definitivo)</p>
                    <p className="text-gray-600">
                      Prendi il manuale del tuo lettore di codici a barre (Datalogic, Honeywell, Zebra, Eyoyo, Inateck, Netum) e scansiona una sola volta il codice di configurazione <strong>"Italian Keyboard Layout"</strong> oppure <strong>"ALT Mode / ASCII Mode"</strong>.
                    </p>
                  </div>

                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <p className="font-bold text-gray-900 text-xs mb-0.5">3. Copia e Incolla Rapido (Senza Lettore)</p>
                    <p className="text-gray-600">
                      Clicca sul pulsante nero <strong>"Copia Email Address"</strong> qui sotto sullo schermo dell'iPad per copiare l'email pulita con la <strong>@</strong> e incollarla (<kbd className="px-1.5 py-0.5 bg-gray-200 rounded font-mono text-[11px] font-bold">Ctrl + V</kbd>) nel tuo software di cassa.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowItalianFixModal(false)}
                className="w-full py-3 bg-black hover:bg-gray-800 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition active:scale-[0.99]"
              >
                HO CAPITO / CHIUDI
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
