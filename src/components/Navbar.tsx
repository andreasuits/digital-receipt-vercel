import React from 'react';
import { Tablet, QrCode, Play, User } from 'lucide-react';

export type ActiveTab = 'customer' | 'cashier' | 'admin-qr' | 'demo';

interface NavbarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, onTabChange }) => {
  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-8 shrink-0 print:hidden sticky top-0 z-40">
      {/* Staff Brand */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-black rounded flex items-center justify-center text-white">
          <Tablet className="w-4 h-4" />
        </div>
        <h1 className="text-sm md:text-base font-bold tracking-tight text-gray-900 flex items-center gap-2">
          <span>STAFF CONSOLE</span>
        </h1>
      </div>

      {/* Navigation Tabs for Staff */}
      <div className="flex items-center bg-gray-100 p-1 rounded-lg border border-gray-200 text-xs font-semibold">
        <button
          onClick={() => onTabChange('customer')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
            activeTab === 'customer'
              ? 'bg-black text-white shadow-sm font-bold'
              : 'text-gray-500 hover:text-gray-900 font-medium'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Vista Unificata</span>
          <span className="sm:hidden">App</span>
        </button>

        <button
          onClick={() => onTabChange('cashier')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
            activeTab === 'cashier'
              ? 'bg-black text-white shadow-sm font-bold'
              : 'text-gray-500 hover:text-gray-900 font-medium'
          }`}
        >
          <Tablet className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Cashier iPad</span>
          <span className="sm:hidden">iPad</span>
        </button>

        <button
          onClick={() => onTabChange('admin-qr')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
            activeTab === 'admin-qr'
              ? 'bg-black text-white shadow-sm font-bold'
              : 'text-gray-500 hover:text-gray-900 font-medium'
          }`}
        >
          <QrCode className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Counter Stand</span>
          <span className="sm:hidden">QR</span>
        </button>

        <button
          onClick={() => onTabChange('demo')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
            activeTab === 'demo'
              ? 'bg-black text-white shadow-sm font-bold'
              : 'text-gray-500 hover:text-gray-900 font-medium'
          }`}
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span className="hidden sm:inline">Demo Sandbox</span>
          <span className="sm:hidden">Demo</span>
        </button>
      </div>

      <button
        onClick={() => onTabChange('customer')}
        className="flex items-center gap-1.5 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg border border-gray-200 transition uppercase tracking-wider"
      >
        <span>Exit Staff</span>
      </button>
    </header>
  );
};

