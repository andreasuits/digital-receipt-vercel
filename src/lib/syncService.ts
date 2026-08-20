import { ReceiptRequest } from '../types';

// NOTE: cross-device sync (phone -> iPad) no longer relies on any public
// third-party relay (previously ntfy.sh). It relies exclusively on the
// app's own backend (Vercel Function + Upstash Redis persistent storage),
// which is the only channel that is actually shared across different
// devices/networks. localStorage + BroadcastChannel are kept ONLY as an
// instant-feedback optimization for multiple tabs on the SAME device/browser
// - they never work across two different physical devices.
const BROADCAST_CHANNEL_NAME = 'moda_receipts_channel';

// In-memory fallback cache on client (same-tab speed optimization only)
let memoryQueue: ReceiptRequest[] = [];

export interface StorageHealth {
  ok: boolean;
  mode?: string;
  error?: string;
  checked: boolean;
}

let lastStorageHealth: StorageHealth = { ok: true, checked: false };

/** Returns the storage health reported by the backend on the last poll. */
export function getStorageHealth(): StorageHealth {
  return lastStorageHealth;
}

// Reads the cashier session token (set after a successful PIN login) and
// builds the Authorization header for cashier-only backend endpoints. The
// customer-facing pages never call these endpoints, so they never need this.
function getCashierAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('cashier_token') || '' : '';
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// If the backend rejects the cashier token (expired/invalid), notify the UI
// so it can show the PIN screen again instead of failing silently forever.
function notifyAuthExpired() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cashier-auth-expired'));
  }
}

/**
 * Publishes a receipt request across:
 * 1. Memory Cache (this tab, instant)
 * 2. LocalStorage + BroadcastChannel (other tabs on the SAME device, instant)
 * 3. Backend API -> Upstash Redis (the real cross-device channel: phone -> iPad)
 *
 * NOTE: This function is non-blocking to ensure instant UI responsiveness!
 */
export function publishReceiptRequest(request: ReceiptRequest): void {
  // 1. Immediate memory cache update
  memoryQueue = memoryQueue.filter(r => r.id !== request.id);
  memoryQueue.unshift(request);

  // 2. Immediate LocalStorage & BroadcastChannel sync (same device/browser only)
  try {
    const existingStr = localStorage.getItem('digital_receipt_queue') || '[]';
    let existing: ReceiptRequest[] = [];
    try {
      existing = JSON.parse(existingStr);
    } catch (e) {
      existing = [];
    }
    const updated = [request, ...existing.filter(r => r.id !== request.id)];
    localStorage.setItem('digital_receipt_queue', JSON.stringify(updated.slice(0, 50)));

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.postMessage({ type: 'NEW_REQUEST', request });
      bc.close();
    }
  } catch (e) {
    // ignore storage error
  }

  // 3. Push to the app backend (Vercel Function -> Upstash Redis).
  //    This is the ONLY channel that actually reaches other devices
  //    (e.g. the cashier's iPad), so failures here matter and are logged.
  try {
    fetch('/api/customer/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }).catch(err => {
      console.error('[digital-receipt] Impossibile inviare la richiesta al backend:', err);
    });
  } catch (e) {
    console.error('[digital-receipt] Errore imprevisto durante la pubblicazione della richiesta:', e);
  }
}

/**
 * Fetches active requests from all sync sources with a short timeout to
 * prevent hanging. The backend call is the source of truth for cross-device
 * data; localStorage/memory only speed up same-device updates.
 */
export async function fetchQueueFromAllSources(): Promise<ReceiptRequest[]> {
  const combinedMap = new Map<string, ReceiptRequest>();
  const now = Date.now();

  // 1. Memory items (this tab, highest priority for speed)
  memoryQueue.forEach(r => combinedMap.set(r.id, r));

  // 2. Read from LocalStorage (other tabs, same device)
  try {
    const storedStr = localStorage.getItem('digital_receipt_queue') || '[]';
    const stored: ReceiptRequest[] = JSON.parse(storedStr);
    if (Array.isArray(stored)) {
      stored.forEach(r => {
        if (r && r.id) combinedMap.set(r.id, r);
      });
    }
  } catch (e) {
    // ignore
  }

  // 3. Read from backend API (Vercel Function -> Upstash Redis) with a
  //    generous timeout: this is the real cross-device channel and must be
  //    given a fair chance to respond, especially on mobile networks.
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('/api/cashier/queue', { signal: controller.signal, headers: getCashierAuthHeaders() });
    clearTimeout(timeoutId);

    if (res.status === 401) {
      notifyAuthExpired();
    } else if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        const serverItems = data.activeRequests || data.requests || [];
        if (Array.isArray(serverItems)) {
          serverItems.forEach((r: ReceiptRequest) => {
            if (r && r.id) combinedMap.set(r.id, r);
          });
        }
        if (data.storage) {
          lastStorageHealth = { ok: !!data.storage.ok, mode: data.storage.mode, error: data.storage.error, checked: true };
          if (!data.storage.ok) {
            console.error('[digital-receipt] Storage condiviso non funzionante:', data.storage.error);
          }
        }
      }
    } else {
      console.error('[digital-receipt] /api/cashier/queue ha risposto con errore:', res.status);
    }
  } catch (e) {
    console.error('[digital-receipt] Impossibile contattare il backend per la coda:', e);
  }

  // Filter out expired (> autoExpireSeconds) or completed requests
  const validRequests = Array.from(combinedMap.values()).filter(r => {
    if (!r || !r.id || !r.email) return false;
    if (r.status === 'EXPIRED' || r.status === 'COMPLETED') return false;
    if (r.expiresAt && new Date(r.expiresAt).getTime() <= now) return false;
    return true;
  });

  // Sort newest first
  validRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Update memory cache
  memoryQueue = validRequests;
  return validRequests;
}

/**
 * Subscribes to queue updates. Cross-device updates arrive via polling the
 * backend every second; same-device tabs also get an instant nudge via
 * BroadcastChannel/localStorage events.
 */
export function subscribeToQueue(callback: (queue: ReceiptRequest[]) => void): () => void {
  let isMounted = true;

  const sync = async () => {
    if (!isMounted) return;
    try {
      const queue = await fetchQueueFromAllSources();
      if (isMounted) {
        callback(queue);
      }
    } catch (e) {
      // already logged in fetchQueueFromAllSources
    }
  };

  // Run initial sync immediately
  sync();

  // Polling every 1 second - this is what actually delivers phone -> iPad
  // updates, since it hits the shared backend (Upstash Redis) each time.
  const pollInterval = setInterval(sync, 1000);

  // BroadcastChannel listener for instant same-device tab sync
  let bc: BroadcastChannel | null = null;
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.onmessage = () => {
        sync();
      };
    } catch (e) {
      // ignore
    }
  }

  // Storage listener for same-device cross-window sync
  const handleStorage = (e: StorageEvent) => {
    if (e.key === 'digital_receipt_queue') {
      sync();
    }
  };
  window.addEventListener('storage', handleStorage);

  return () => {
    isMounted = false;
    clearInterval(pollInterval);
    window.removeEventListener('storage', handleStorage);
    if (bc) bc.close();
  };
}

/**
 * Polls ONLY this customer's own request by its (unguessable) ID. Used by
 * CustomerView so a customer's browser never downloads other customers'
 * emails - unlike the shared queue, which is cashier-only and authenticated.
 */
export function subscribeToOwnSession(id: string, callback: (request: ReceiptRequest | null) => void): () => void {
  let isMounted = true;

  const poll = async () => {
    if (!isMounted) return;
    try {
      const res = await fetch(`/api/customer/session/${encodeURIComponent(id)}`);
      if (!isMounted) return;
      if (res.ok) {
        const data = await res.json();
        callback(data.request || null);
      } else if (res.status === 404) {
        callback(null);
      }
    } catch (e) {
      // network hiccup, keep polling
    }
  };

  poll();
  const interval = setInterval(poll, 1500);

  return () => {
    isMounted = false;
    clearInterval(interval);
  };
}

/**
 * Marks a request as COMPLETED or EXPIRED.
 */
export async function updateRequestStatus(id: string, status: 'COMPLETED' | 'EXPIRED'): Promise<void> {
  memoryQueue = memoryQueue.filter(r => r.id !== id);

  try {
    const storedStr = localStorage.getItem('digital_receipt_queue') || '[]';
    const stored: ReceiptRequest[] = JSON.parse(storedStr);
    const updated = stored.map(r => r.id === id ? { ...r, status } : r);
    localStorage.setItem('digital_receipt_queue', JSON.stringify(updated));

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.postMessage({ type: 'STATUS_UPDATE', id, status });
      bc.close();
    }
  } catch (e) {
    // ignore
  }

  try {
    const res = await fetch(`/api/cashier/requests/${id}/status`, {
      method: 'PATCH',
      headers: getCashierAuthHeaders(),
      body: JSON.stringify({ status }),
    });
    if (res.status === 401) {
      notifyAuthExpired();
    } else if (!res.ok) {
      console.error('[digital-receipt] Aggiornamento stato fallito sul backend:', res.status);
    }
  } catch (e) {
    console.error('[digital-receipt] Errore di rete durante aggiornamento stato:', e);
  }
}
