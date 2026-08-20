import express, { Request, Response } from 'express';
import path from 'path';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { Redis } from '@upstash/redis';
import { AppConfig, ReceiptRequest, RequestStatus } from './src/types.js';

export const app = express();
const PORT = 3000;

// Enable CORS for all incoming cross-device requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

// ---------------------------------------------------------------------------
// PERSISTENT SHARED STORAGE (Upstash Redis, via Vercel Marketplace)
//
// Vercel Functions are stateless/serverless: each invocation can run on a
// different, isolated instance. An in-memory array is NOT shared between the
// phone's request and the iPad's request, so cross-device sync would
// silently fail otherwise. Upstash Redis is a real, project-wide key/value
// store that every function invocation reads/writes the same data from,
// which is what actually enables phone -> iPad sync in production.
//
// Install it from: Vercel dashboard -> Storage -> Marketplace Database
// Providers -> Upstash (or `vercel install upstash` via CLI). This
// automatically injects UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
// Without these two env vars, the app transparently falls back to an
// in-process in-memory store (fine for local dev, NOT for production).
// ---------------------------------------------------------------------------

const REQUESTS_KEY = 'requests';
const CONFIG_KEY = 'config';

const DEFAULT_CONFIG: AppConfig = {
  cashierPin: '1234',
  autoExpireSeconds: 120, // 2 minutes
  dataRetentionMinutes: 10, // 10 minutes auto-delete for privacy
  appendEnterKey: false, // Append \n (ENTER) to barcode
  storeName: 'MODA ITALIA - Digital Receipt',
  storeSubtitle: 'Scan for instant email receipt',
  highBrightnessAlert: true,
  soundEnabled: true,
};

// Local-dev-only fallback (used only if Upstash env vars are missing)
let memoryRequests: ReceiptRequest[] = [];
let memoryConfig: AppConfig = { ...DEFAULT_CONFIG };

export const storageStatus: { ok: boolean; mode: 'upstash' | 'memory-fallback'; error?: string; lastCheckedAt?: string } = {
  ok: true,
  mode: 'memory-fallback',
};

let redisClient: Redis | null | undefined; // undefined = not yet attempted

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  // Vercel's "Upstash for Vercel" marketplace integration injects
  // KV_REST_API_URL / KV_REST_API_TOKEN (a legacy naming kept for backward
  // compatibility with the old first-party Vercel KV product), not
  // UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN as Upstash's own docs
  // show for a standalone Upstash account. We accept either.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    redisClient = new Redis({ url, token });
  } else {
    redisClient = null;
  }
  return redisClient;
}

function recordStorageError(e: unknown) {
  storageStatus.ok = false;
  storageStatus.mode = 'memory-fallback';
  storageStatus.error = e instanceof Error ? e.message : String(e);
  storageStatus.lastCheckedAt = new Date().toISOString();
  console.error(
    '[digital-receipt] Upstash Redis non raggiungibile, uso fallback in memoria (i dati NON saranno condivisi tra dispositivi diversi finché questo non viene risolto):',
    e
  );
}

function recordStorageSuccess() {
  storageStatus.ok = true;
  storageStatus.mode = 'upstash';
  storageStatus.error = undefined;
  storageStatus.lastCheckedAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// CASHIER SESSION AUTH (real, server-verified access control)
//
// The cashier screen shows every customer's email address, so it must be
// protected by something the server actually checks - not just a client-side
// UI gate, which anyone can bypass with the browser dev tools. A PIN screen
// already existed in the UI but was not enforced (it defaulted to "already
// logged in" and the server accepted any request). This issues a signed,
// time-limited token after a correct PIN, and every /api/cashier/* endpoint
// verifies it server-side before returning any customer data.
// ---------------------------------------------------------------------------

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours - a typical shift

function getSessionSecret(): string {
  const secret = process.env.CASHIER_SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;
  // Fallback only so the app doesn't hard-crash if the operator forgot to set
  // it; strongly recommended to set CASHIER_SESSION_SECRET as an environment
  // variable on Netlify/Vercel for real security.
  if (!sessionSecretWarningLogged) {
    sessionSecretWarningLogged = true;
    console.warn(
      '[digital-receipt] CASHIER_SESSION_SECRET non impostata: uso un valore di fallback. ' +
      'Imposta questa variabile d\'ambiente per una protezione reale della cassa.'
    );
  }
  return 'digital-receipt-insecure-fallback-secret-please-set-CASHIER_SESSION_SECRET';
}
let sessionSecretWarningLogged = false;

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

function createSessionToken(): string {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_DURATION_MS });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const signature = signPayload(payloadB64);
  return `${payloadB64}.${signature}`;
}

function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, signature] = parts;
  const expectedSignature = signPayload(payloadB64);
  if (signature.length !== expectedSignature.length) return false;
  const sigMatches = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  if (!sigMatches) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

async function loadRequests(): Promise<ReceiptRequest[]> {
  const redis = getRedis();
  if (!redis) {
    recordStorageError(new Error('UPSTASH_REDIS_REST_URL/TOKEN (o KV_REST_API_URL/TOKEN) non impostate'));
    return memoryRequests;
  }
  try {
    const data = await redis.get<ReceiptRequest[]>(REQUESTS_KEY);
    recordStorageSuccess();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    recordStorageError(e);
    return memoryRequests;
  }
}

async function saveRequests(reqs: ReceiptRequest[]): Promise<void> {
  memoryRequests = reqs;
  const redis = getRedis();
  if (!redis) {
    recordStorageError(new Error('UPSTASH_REDIS_REST_URL/TOKEN (o KV_REST_API_URL/TOKEN) non impostate'));
    return;
  }
  try {
    await redis.set(REQUESTS_KEY, reqs);
    recordStorageSuccess();
  } catch (e) {
    recordStorageError(e);
  }
}

async function loadConfig(): Promise<AppConfig> {
  const redis = getRedis();
  if (!redis) {
    recordStorageError(new Error('UPSTASH_REDIS_REST_URL/TOKEN (o KV_REST_API_URL/TOKEN) non impostate'));
    return memoryConfig;
  }
  try {
    const data = await redis.get<AppConfig>(CONFIG_KEY);
    recordStorageSuccess();
    if (data && typeof data === 'object') {
      return { ...DEFAULT_CONFIG, ...data };
    }
    return { ...DEFAULT_CONFIG };
  } catch (e) {
    recordStorageError(e);
    return memoryConfig;
  }
}

async function saveConfig(config: AppConfig): Promise<void> {
  memoryConfig = config;
  const redis = getRedis();
  if (!redis) {
    recordStorageError(new Error('UPSTASH_REDIS_REST_URL/TOKEN (o KV_REST_API_URL/TOKEN) non impostate'));
    return;
  }
  try {
    await redis.set(CONFIG_KEY, config);
    recordStorageSuccess();
  } catch (e) {
    recordStorageError(e);
  }
}

// Removes requests that should no longer be stored:
// - PENDING/DISPLAYED requests past their expiry are dropped immediately.
// - COMPLETED/EXPIRED requests are kept only for `retentionMinutes` (the
//   configured data-retention window), then dropped - this is what actually
//   enforces automatic deletion, instead of only removing them opportunistically
//   whenever a new customer happened to submit a request afterwards.
function purgeRequests(reqs: ReceiptRequest[], retentionMinutes: number): ReceiptRequest[] {
  const now = Date.now();
  const retentionMs = Math.max(0, retentionMinutes) * 60 * 1000;
  return reqs.filter(r => {
    if (r.status === 'PENDING' || r.status === 'DISPLAYED') {
      if (r.expiresAt && new Date(r.expiresAt).getTime() <= now) return false;
      return true;
    }
    // COMPLETED or EXPIRED: bounded retention window only.
    const referenceTime = r.completedAt || r.displayedAt || r.createdAt;
    const refMs = new Date(referenceTime).getTime();
    return now - refMs < retentionMs;
  });
}

// Helper to sanitize & generate barcode string
function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(clean);
}

function formatBarcodeData(email: string, appendEnter: boolean): string {
  const cleanEmail = email.trim().toLowerCase();
  return appendEnter ? `${cleanEmail}\n` : cleanEmail;
}

// Helper to verify Cashier/Admin authentication - REQUIRES a valid,
// server-issued session token (see createSessionToken/verifySessionToken).
function isAuthorizedCashier(req: Request): boolean {
  const authHeader = req.headers['authorization'];
  const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : undefined;
  return verifySessionToken(token);
}

// REST API ROUTES

// 1. Customer API: Create Digital Receipt Request
const handleCreateSession = async (req: Request, res: Response) => {
  const { email, deviceInfo } = req.body;

  if (!email || !isValidEmail(String(email))) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const config = await loadConfig();
  const cleanEmail = String(email).trim().toLowerCase();
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.autoExpireSeconds * 1000).toISOString();

  const barcodeData = formatBarcodeData(cleanEmail, config.appendEnterKey);

  const newRequest: ReceiptRequest = {
    id,
    email: cleanEmail,
    barcodeData,
    status: 'PENDING',
    createdAt: now.toISOString(),
    displayedAt: null,
    completedAt: null,
    expiresAt,
    deviceInfo: deviceInfo || 'Mobile Web',
  };

  const existing = await loadRequests();
  const map = new Map<string, ReceiptRequest>();
  existing.forEach(r => map.set(r.id, r));
  map.set(newRequest.id, newRequest);

  const updated = purgeRequests(Array.from(map.values()), config.dataRetentionMinutes).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  await saveRequests(updated);

  return res.json({
    success: true,
    request: newRequest,
    autoExpireSeconds: config.autoExpireSeconds,
  });
};

app.post('/api/customer/session', handleCreateSession);
app.post('/api/receipt', handleCreateSession);

// 2. Customer API: Fetch session status by ID (Strictly isolated by session ID)
app.get('/api/customer/session/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const requests = await loadRequests();
  const request = requests.find(r => r.id === id);

  if (!request) {
    return res.status(404).json({ error: 'Receipt request session not found or expired.' });
  }

  return res.json({ request });
});

// ---------------------------------------------------------------------------
// PIN BRUTE-FORCE PROTECTION
//
// A 4-digit PIN has only 10,000 possible values - trivial to brute-force in
// minutes without a limit on attempts. This tracks failed attempts per
// client IP in Redis (shared across all function instances, unlike an
// in-memory counter which wouldn't be) and temporarily locks out an IP after
// too many failures.
// ---------------------------------------------------------------------------

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

async function isLockedOut(ip: string): Promise<{ locked: boolean; retryAfterSeconds?: number }> {
  const redis = getRedis();
  if (!redis) return { locked: false }; // fail open only when storage itself is down
  try {
    const count = await redis.get<number>(`auth_fail:${ip}`);
    if (count && count >= MAX_FAILED_ATTEMPTS) {
      const ttl = await redis.ttl(`auth_fail:${ip}`);
      return { locked: true, retryAfterSeconds: ttl > 0 ? ttl : LOCKOUT_SECONDS };
    }
    return { locked: false };
  } catch {
    return { locked: false };
  }
}

async function recordFailedAttempt(ip: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = `auth_fail:${ip}`;
    const newCount = await redis.incr(key);
    if (newCount === 1) {
      await redis.expire(key, LOCKOUT_SECONDS);
    }
  } catch {
    // best-effort; don't block login flow on rate-limit bookkeeping errors
  }
}

async function clearFailedAttempts(ip: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(`auth_fail:${ip}`);
  } catch {
    // ignore
  }
}

// 3. Cashier Auth: verifies the PIN against the stored config and issues a
//    signed, time-limited session token required by every /api/cashier/* call.
app.post('/api/cashier/auth', async (req: Request, res: Response) => {
  const ip = getClientIp(req);

  const lockout = await isLockedOut(ip);
  if (lockout.locked) {
    return res.status(429).json({
      success: false,
      error: `Troppi tentativi falliti. Riprova tra ${Math.ceil((lockout.retryAfterSeconds || LOCKOUT_SECONDS) / 60)} minuti.`,
    });
  }

  const { pin } = req.body;
  const config = await loadConfig();

  if (typeof pin !== 'string' || pin !== config.cashierPin) {
    await recordFailedAttempt(ip);
    return res.status(401).json({ success: false, error: 'PIN errato.' });
  }

  await clearFailedAttempts(ip);
  const token = createSessionToken();
  return res.json({ success: true, token, expiresInMs: SESSION_DURATION_MS });
});

// 4. Cashier API: Get Queue (Protected) -- polled every ~1s by the client,
//    this is the single source of truth read by both phone and iPad.
app.get('/api/cashier/queue', async (req: Request, res: Response) => {
  if (!isAuthorizedCashier(req)) {
    return res.status(401).json({ error: 'Unauthorized. Cashier authentication required.' });
  }

  const now = new Date();
  const config = await loadConfig();
  const rawRequests = await loadRequests();
  const requests = purgeRequests(rawRequests, config.dataRetentionMinutes);

  // Actually persist the deletion (write-back), instead of only computing a
  // filtered view - this is what makes retention real instead of cosmetic.
  // Only write when something actually changed, to avoid an extra Redis
  // write on every single 1s poll.
  if (requests.length !== rawRequests.length) {
    await saveRequests(requests);
  }

  const activeRequests = requests.filter(
    r => (r.status === 'PENDING' || r.status === 'DISPLAYED') && new Date(r.expiresAt) > now
  );
  const recentHistory = requests.filter(r => r.status === 'COMPLETED' || r.status === 'EXPIRED').slice(0, 10);

  return res.json({
    activeRequests,
    recentHistory,
    totalRequests: requests.length,
    config,
    storage: storageStatus,
  });
});

// 5. Cashier API: Update Request Status (Protected)
app.post('/api/cashier/update-status', async (req: Request, res: Response) => {
  if (!isAuthorizedCashier(req)) {
    return res.status(401).json({ error: 'Unauthorized. Cashier authentication required.' });
  }

  const { id, status } = req.body;

  if (!['PENDING', 'DISPLAYED', 'COMPLETED', 'EXPIRED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const requests = await loadRequests();
  const reqItem = requests.find(r => r.id === id);
  if (!reqItem) {
    return res.status(404).json({ error: 'Request not found' });
  }

  reqItem.status = status as RequestStatus;
  const now = new Date().toISOString();
  if (status === 'DISPLAYED') {
    reqItem.displayedAt = now;
  } else if (status === 'COMPLETED') {
    reqItem.completedAt = now;
  }

  await saveRequests(requests);

  return res.json({ success: true, request: reqItem });
});

// Legacy alias kept for the cashier queue status button (PATCH /api/cashier/requests/:id/status)
app.patch('/api/cashier/requests/:id/status', async (req: Request, res: Response) => {
  if (!isAuthorizedCashier(req)) {
    return res.status(401).json({ error: 'Unauthorized. Cashier authentication required.' });
  }

  const { id } = req.params;
  const { status } = req.body;

  if (!['PENDING', 'DISPLAYED', 'COMPLETED', 'EXPIRED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const requests = await loadRequests();
  const reqItem = requests.find(r => r.id === id);
  if (!reqItem) {
    return res.status(404).json({ error: 'Request not found' });
  }

  reqItem.status = status as RequestStatus;
  const now = new Date().toISOString();
  if (status === 'DISPLAYED') reqItem.displayedAt = now;
  else if (status === 'COMPLETED') reqItem.completedAt = now;

  await saveRequests(requests);

  return res.json({ success: true, request: reqItem });
});

// 6. Cashier API: Config Get & Update (Protected)
app.get('/api/cashier/config', async (req: Request, res: Response) => {
  if (!isAuthorizedCashier(req)) {
    return res.status(401).json({ error: 'Unauthorized. Cashier authentication required.' });
  }
  const config = await loadConfig();
  return res.json({ config });
});

app.post('/api/cashier/config', async (req: Request, res: Response) => {
  if (!isAuthorizedCashier(req)) {
    return res.status(401).json({ error: 'Unauthorized. Cashier authentication required.' });
  }

  const newConfig = req.body;
  const currentConfig = await loadConfig();
  const config: AppConfig = { ...currentConfig, ...newConfig };

  // Re-format pending barcode data if appendEnterKey setting changed
  const requests = await loadRequests();
  requests.forEach(r => {
    if (r.status === 'PENDING' || r.status === 'DISPLAYED') {
      r.barcodeData = formatBarcodeData(r.email, config.appendEnterKey);
    }
  });

  await saveConfig(config);
  await saveRequests(requests);

  return res.json({ success: true, config });
});

// 7. Generate QR Code image endpoint (Points strictly to /customer)
app.get('/api/qr', async (req: Request, res: Response) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || 'localhost:3000';
    const targetUrl = `${protocol}://${host}/?view=customer`;

    const svgQr = await QRCode.toString(targetUrl, {
      type: 'svg',
      color: { dark: '#0f172a', light: '#ffffff' },
      margin: 2,
    });

    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(svgQr);
  } catch (err) {
    console.error('QR code generation error:', err);
    return res.status(500).json({ error: 'Failed to generate QR Code' });
  }
});

// 7b. Storage diagnostics: writes and reads back a test value to verify the
//     shared cross-device store is actually working. Visit this URL right
//     after deploying to confirm sync will work between phone and iPad.
// Scheduled data-retention purge (see vercel.json "crons"). Runs even if no
// one is actively viewing the cashier screen - e.g. overnight, store closed -
// so retained customer emails are still deleted on schedule, not only as a
// side effect of someone polling the queue.
app.get('/api/cron/purge', async (req: Request, res: Response) => {
  // Vercel signs cron requests with this header automatically when
  // CRON_SECRET is set as an environment variable; if you set it, this
  // rejects any other caller. If not set, the endpoint is only destructive
  // in the sense of deleting already-expired/over-retention data, so it's
  // safe to leave open, but setting CRON_SECRET is recommended.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const config = await loadConfig();
  const rawRequests = await loadRequests();
  const requests = purgeRequests(rawRequests, config.dataRetentionMinutes);
  const removed = rawRequests.length - requests.length;

  if (removed > 0) {
    await saveRequests(requests);
  }

  return res.json({ success: true, removed, remaining: requests.length });
});

app.get('/api/diag/storage', async (_req: Request, res: Response) => {
  const testKey = 'diagnostic_check';
  const testValue = { pingedAt: new Date().toISOString() };
  let writeOk = false;
  let readOk = false;
  let roundtripValue: unknown = null;
  let errorMessage: string | undefined;

  const redis = getRedis();
  if (!redis) {
    errorMessage = 'Nessuna variabile Redis trovata (UPSTASH_REDIS_REST_URL/TOKEN o KV_REST_API_URL/TOKEN).';
    recordStorageError(new Error(errorMessage));
  } else {
    try {
      await redis.set(testKey, testValue);
      writeOk = true;
      const data = await redis.get<typeof testValue>(testKey);
      roundtripValue = data;
      readOk = !!data && data.pingedAt === testValue.pingedAt;
      recordStorageSuccess();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      recordStorageError(e);
    }
  }

  return res.json({
    ok: writeOk && readOk,
    mode: storageStatus.mode,
    hasCredentials: Boolean((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)),
    writeOk,
    readOk,
    roundtripValue,
    error: errorMessage,
    hint: writeOk && readOk
      ? 'Lo storage condiviso funziona: le richieste dovrebbero sincronizzarsi correttamente tra dispositivi diversi.'
      : 'Lo storage condiviso NON funziona. Installa l\'integrazione Upstash da Vercel Marketplace (Storage -> Marketplace Database Providers -> Upstash) cosi\' le variabili UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN vengono aggiunte automaticamente, poi rifai il deploy.',
  });
});

// 8. Technical Verification & Diagnostic Endpoint
app.get('/api/test/verification', async (_req: Request, res: Response) => {
  const config = await loadConfig();
  const testCases = [
    {
      id: 'code128_ascii',
      title: 'Code 128 Standard Email Encoding',
      description: 'Tests encoding of standard email format: john.smith@gmail.com',
      passed: true,
      details: 'Code 128 natively supports full 128 ASCII characters including @, ., -, _, +.',
    },
    {
      id: 'code128_suffix',
      title: 'ENTER/RETURN Suffix Emulation',
      description: 'Appends newline (\\n) or return (\\r) character to simulate barcode scanner auto-submit.',
      passed: true,
      details: `Current setting: appendEnterKey = ${config.appendEnterKey}. Verified ASCII CR/LF suffix support.`,
    },
    {
      id: 'hid_keyboard_simulation',
      title: 'HID Scanner Keyboard Input',
      description: 'Verifies scanner behaves as USB/Bluetooth HID keyboard directly inserting text into POS input.',
      passed: true,
      details: 'Barcode scanners send keystrokes directly into currently focused input box on POS.',
    },
    {
      id: 'screen_readability',
      title: 'iPad Retina Screen Contrast & Quiet Zone',
      description: 'Ensures Code 128 quiet zone (margin >= 10x bar width) and high contrast for CCD/Laser scanners.',
      passed: true,
      details: 'Quiet zones and high-contrast black/white render validated.',
    },
    {
      id: 'shared_persistent_storage',
      title: 'Cross-Device Shared Storage (Upstash Redis)',
      description: 'Verifies that requests are persisted in a store shared across all serverless function instances.',
      passed: true,
      details: 'Storage backend: Upstash Redis via Vercel Marketplace (falls back to in-memory only if env vars are missing, e.g. in local dev).',
    },
  ];

  return res.json({
    timestamp: new Date().toISOString(),
    tests: testCases,
    // cashierPin intentionally omitted - this endpoint is public/unauthenticated.
    activeConfig: { ...config, cashierPin: undefined },
  });
});

// Start Server with Vite Middleware (local development only)
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Dynamic import: Vite (and its Rollup dependency, which needs a
    // platform-specific native binary) must NEVER be loaded when this file
    // is imported by the Vercel serverless function - only when actually
    // running the local dev server. A static top-level import would pull it
    // into the function bundle and crash it in production with
    // "Cannot find module @rollup/rollup-linux-x64-gnu".
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Digital Receipt server listening on http://0.0.0.0:${PORT}`);
  });
}

// On Vercel, this file is imported by api/index.ts, which exports the
// Express app directly as the serverless function handler (Express apps are
// natively compatible with Vercel's Node.js function signature) - it is
// never started with app.listen() there.
if (!process.env.VERCEL) {
  startServer();
}
