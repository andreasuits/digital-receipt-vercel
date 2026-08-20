import React, { useState, useEffect } from 'react';
import { Play, CheckCircle2, QrCode, Smartphone, Tablet, Keyboard, RefreshCw, AlertCircle, ShieldAlert, Sparkles, Copy, Check, Lock } from 'lucide-react';
import { BarcodeRenderer } from './BarcodeRenderer';
import { TestResult, ReceiptRequest } from '../types';
import { publishReceiptRequest, updateRequestStatus } from '../lib/syncService';

export const DemoAndTestView: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return !!sessionStorage.getItem('cashier_token');
  });
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');

  // Test Barcode Tool State
  const [testEmail, setTestEmail] = useState('mario.rossi@gmail.com');
  const [appendEnter, setAppendEnter] = useState(false);
  const [copied, setCopied] = useState(false);

  // E2E Interactive Simulation State
  const [simStep, setSimStep] = useState<number>(0);
  const [simEmail, setSimEmail] = useState('tourist.mario@gmail.com');
  const [simBarcodeData, setSimBarcodeData] = useState('');
  const [simPosInputValue, setSimPosInputValue] = useState('');
  const [simLogs, setSimLogs] = useState<string[]>([]);

  // Verification Suite Results
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isLoadingTests, setIsLoadingTests] = useState(false);

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
        setPinError(data.error || 'Incorrect PIN. Default PIN is 1234.');
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

          <h2 className="text-xl font-bold text-gray-900 mb-1 tracking-tight">DEMO ACCESS</h2>
          <p className="text-xs text-gray-500 mb-6">
            Enter PIN code to access Demo Sandbox & Testing Tools
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
              UNLOCK DEMO
            </button>
          </form>
        </div>
      </div>
    );
  }

  const addLog = (msg: string) => {
    setSimLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  const handleRunVerification = async () => {
    setIsLoadingTests(true);
    try {
      const res = await fetch('/api/test/verification');
      const data = await res.json();
      setTestResults(data.tests || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingTests(false);
    }
  };

  useEffect(() => {
    handleRunVerification();
  }, []);

  // E2E Simulation Logic
  const startSimulation = async () => {
    setSimStep(1);
    setSimPosInputValue('');
    setSimLogs([]);
    addLog('Step 1: Tourist customer approaches checkout counter & scans QR code on phone.');

    setTimeout(async () => {
      setSimStep(2);
      addLog(`Step 2: Customer selects email (${simEmail}) from mobile Safari autocomplete.`);
      
      let reqObj: ReceiptRequest = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sim_${Date.now()}`,
        email: simEmail.toLowerCase(),
        barcodeData: simEmail.toLowerCase(),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        displayedAt: null,
        completedAt: null,
        expiresAt: new Date(Date.now() + 120 * 1000).toISOString(),
        deviceInfo: 'iPhone 15 Safari Demo',
      };

      try {
        const res = await fetch('/api/customer/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: simEmail, deviceInfo: 'iPhone 15 Safari Demo' }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.request) reqObj = data.request;
        }
      } catch (e) {
        // ignore
      }

      await publishReceiptRequest(reqObj);
      setSimBarcodeData(reqObj.barcodeData);
      
      setSimStep(3);
      addLog('Step 3: Code 128 barcode generated & published globally to Cashier iPad.');

      setTimeout(() => {
        setSimStep(4);
        addLog('Step 4: Cashier points POS barcode laser scanner at iPad screen.');

        setTimeout(async () => {
          // Simulate HID scanner keystrokes typed into POS email field
          const scannedText = reqObj.barcodeData.trim();
          setSimPosInputValue(scannedText);
          addLog(`Step 5: HID Scanner transmits "${scannedText}" directly into POS email input box.`);

          await updateRequestStatus(reqObj.id, 'COMPLETED');

          setSimStep(5);
          addLog('Step 6: Digital Receipt completed! No manual email typing required.');
        }, 1500);
      }, 1500);
    }, 1500);
  };

  const handleCopyBarcodeText = () => {
    navigator.clipboard.writeText(appendEnter ? `${testEmail}\n` : testEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-[88vh] bg-[#F9FAFB] text-gray-900 p-6 space-y-8 font-sans">
      
      {/* SECTION 1: E2E FLOW SIMULATOR */}
      <section className="max-w-5xl mx-auto bg-white border border-gray-200 rounded-3xl p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-6 mb-6">
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] block mb-1">
              Interactive E2E Sandbox
            </span>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Play className="w-5 h-5 text-black fill-black" />
              <span>Full Flow Simulator: QR → Email → Barcode → iPad → Scanner POS</span>
            </h2>
          </div>

          <button
            onClick={startSimulation}
            disabled={simStep > 0 && simStep < 5}
            className="py-3 px-6 bg-black hover:bg-gray-800 disabled:opacity-40 text-white font-bold rounded-lg shadow-sm transition active:scale-[0.99] flex items-center gap-2 text-xs uppercase tracking-wider"
          >
            {simStep > 0 && simStep < 5 ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Simulating Flow...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>RUN SIMULATION</span>
              </>
            )}
          </button>
        </div>

        {/* 3 Device View Columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Device 1: Customer iPhone */}
          <div className={`p-5 rounded-2xl border transition ${simStep >= 1 ? 'bg-gray-50 border-black shadow-2xs' : 'bg-gray-50/50 border-gray-200'}`}>
            <div className="flex items-center gap-2 text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">
              <Smartphone className="w-4 h-4 text-black" />
              <span>1. Customer iPhone</span>
            </div>

            {simStep === 0 && <p className="text-xs text-gray-500">Ready to scan counter QR Code</p>}
            {simStep === 1 && <p className="text-xs text-amber-700 font-medium">Scanning QR code & opening web page...</p>}
            {simStep >= 2 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Entered Email:</p>
                <p className="text-xs font-mono font-bold text-gray-900 bg-white border border-gray-200 p-2 rounded-lg break-all">
                  {simEmail}
                </p>
                {simBarcodeData && (
                  <div className="pt-2">
                    <p className="text-[11px] text-gray-500 mb-1">Generated Barcode:</p>
                    <div className="bg-white p-1 rounded border border-gray-200">
                      <BarcodeRenderer value={simBarcodeData} width={1.8} height={60} fontSize={12} displayValue={false} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Device 2: Cashier iPad */}
          <div className={`p-5 rounded-2xl border transition ${simStep >= 3 ? 'bg-gray-50 border-black shadow-2xs' : 'bg-gray-50/50 border-gray-200'}`}>
            <div className="flex items-center gap-2 text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">
              <Tablet className="w-4 h-4 text-black" />
              <span>2. Cashier iPad Display</span>
            </div>

            {simStep < 3 && <p className="text-xs text-gray-500">Waiting for realtime SSE event...</p>}
            {simStep >= 3 && (
              <div className="space-y-2">
                <span className="inline-block px-2.5 py-0.5 bg-black text-white text-[10px] font-bold rounded-full uppercase tracking-wider">
                  RECEIVED REALTIME ⚡
                </span>
                <p className="text-xs font-mono font-bold text-gray-900 break-all">
                  {simEmail}
                </p>
                <div className="bg-white p-2 rounded-lg border border-gray-200">
                  <BarcodeRenderer value={simBarcodeData} width={2.0} height={70} fontSize={12} displayValue={false} />
                </div>
              </div>
            )}
          </div>

          {/* Device 3: POS Register */}
          <div className={`p-5 rounded-2xl border transition ${simStep >= 4 ? 'bg-gray-50 border-black shadow-2xs' : 'bg-gray-50/50 border-gray-200'}`}>
            <div className="flex items-center gap-2 text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">
              <Keyboard className="w-4 h-4 text-black" />
              <span>3. POS Till Email Input</span>
            </div>

            <p className="text-[11px] text-gray-500 mb-1">POS Active Input Field:</p>
            <div className="bg-white border border-gray-300 p-3 rounded-lg font-mono text-xs font-bold min-h-[48px] flex items-center text-gray-900 shadow-2xs">
              {simPosInputValue ? (
                <span className="flex items-center gap-1">
                  <span>{simPosInputValue}</span>
                  <span className="w-2 h-4 bg-black animate-pulse inline-block"></span>
                </span>
              ) : (
                <span className="text-gray-400 font-normal">Waiting for HID barcode scanner...</span>
              )}
            </div>

            {simStep === 5 && (
              <div className="mt-3 p-2 bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
                <span>Auto-filled into POS without typing!</span>
              </div>
            )}
          </div>

        </div>

        {/* Simulation Log Console */}
        {simLogs.length > 0 && (
          <div className="mt-6 bg-gray-900 border border-gray-800 rounded-2xl p-4 font-mono text-xs space-y-1 text-gray-200 max-h-40 overflow-y-auto">
            {simLogs.map((log, index) => (
              <div key={index} className="text-green-400">
                {log}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SECTION 2: TEST BARCODE SANDBOX TOOL */}
      <section className="max-w-5xl mx-auto bg-white border border-gray-200 rounded-3xl p-6 md:p-8 shadow-sm">
        <div className="border-b border-gray-100 pb-4 mb-6">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] block mb-1">
            Barcode Testing Studio
          </span>
          <h2 className="text-xl font-bold text-gray-900">
            Code 128 Custom Barcode Generator & Scanner Test
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Test any email format or string with your store's physical barcode reader to verify scanning reliability.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Test Email Address / String
              </label>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div className="flex items-center justify-between p-3.5 bg-gray-50 rounded-lg border border-gray-200">
              <div>
                <span className="block text-xs font-bold text-gray-900">Append ENTER/RETURN Suffix</span>
                <span className="text-[11px] text-gray-500">Simulates auto-submit key code for POS scanner</span>
              </div>
              <input
                type="checkbox"
                checked={appendEnter}
                onChange={(e) => setAppendEnter(e.target.checked)}
                className="w-5 h-5 accent-black cursor-pointer"
              />
            </div>

            <button
              onClick={handleCopyBarcodeText}
              className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-900 text-xs font-bold rounded-lg transition uppercase tracking-wider flex items-center justify-center gap-2"
            >
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied Barcode Payload!' : 'Copy Barcode Payload Text'}</span>
            </button>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 text-center space-y-3">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] block">
              Live Code 128 Render
            </span>

            <BarcodeRenderer
              value={appendEnter ? `${testEmail}\n` : testEmail}
              width={2.2}
              height={110}
              fontSize={14}
            />

            <p className="text-[11px] font-mono text-gray-600">
              Payload: {JSON.stringify(appendEnter ? `${testEmail}\n` : testEmail)}
            </p>
          </div>

        </div>
      </section>

      {/* SECTION 3: EXPLICIT TECHNICAL VERIFICATION CHECKLIST */}
      <section className="max-w-5xl mx-auto bg-white border border-gray-200 rounded-3xl p-6 md:p-8 shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-6">
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] block mb-1">
              Store Compliance Checklist
            </span>
            <h2 className="text-xl font-bold text-gray-900">
              Technical Verification & Compatibility Rules
            </h2>
          </div>

          <button
            onClick={handleRunVerification}
            className="p-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-xs font-bold uppercase transition flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTests ? 'animate-spin' : ''}`} />
            <span>Re-run Diagnostics</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {testResults.map((test) => (
            <div key={test.id} className="bg-gray-50 border border-gray-200 rounded-2xl p-4 flex items-start gap-3">
              <div className="mt-0.5 text-black shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>

              <div>
                <h4 className="text-sm font-bold text-gray-900 mb-0.5">{test.title}</h4>
                <p className="text-xs text-gray-500 mb-2 leading-relaxed">{test.description}</p>
                <span className="text-[11px] font-mono text-gray-700 bg-white border border-gray-200 px-2.5 py-1 rounded-md block">
                  {test.details}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
};
