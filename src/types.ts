export type RequestStatus = 'PENDING' | 'DISPLAYED' | 'COMPLETED' | 'EXPIRED';

export interface ReceiptRequest {
  id: string;
  email: string;
  barcodeData: string;
  status: RequestStatus;
  createdAt: string;
  displayedAt?: string | null;
  completedAt?: string | null;
  expiresAt: string;
  deviceInfo?: string;
}

export interface AppConfig {
  cashierPin: string;
  autoExpireSeconds: number; // e.g. 120
  dataRetentionMinutes: number; // e.g. 10
  appendEnterKey: boolean; // append \n to barcode data
  storeName: string;
  storeSubtitle: string;
  highBrightnessAlert: boolean;
  soundEnabled: boolean;
}

export interface TestResult {
  id: string;
  title: string;
  description: string;
  passed: boolean;
  details: string;
  timestamp: string;
}
