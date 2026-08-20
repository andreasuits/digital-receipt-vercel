import React, { useState, useEffect } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { CustomerView } from './components/CustomerView';
import { CashierView } from './components/CashierView';
import { AdminQrView } from './components/AdminQrView';
import { DemoAndTestView } from './components/DemoAndTestView';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('cashier');
  // True only when the URL explicitly marks this as a customer session
  // (i.e. it was opened by scanning the QR code). This page is rendered
  // completely on its own, with no staff navigation, no "Staff Console"
  // shortcut, and no way to reach the cashier queue - by design, so a
  // customer's browser never even has a path to other customers' data.
  const [isQrCustomerEntry, setIsQrCustomerEntry] = useState<boolean>(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get('view');
      const pathName = window.location.pathname.toLowerCase();

      if (viewParam === 'customer' || pathName.includes('/customer')) {
        setIsQrCustomerEntry(true);
        setActiveTab('customer');
        return;
      }

      if (viewParam === 'cashier' || pathName.includes('/cashier')) {
        setActiveTab('cashier');
      } else if (
        viewParam === 'qr' ||
        viewParam === 'admin' ||
        viewParam === 'counter' ||
        pathName.includes('/admin') ||
        pathName.includes('/counter') ||
        pathName.includes('/qr')
      ) {
        setActiveTab('admin-qr');
      } else if (
        viewParam === 'demo' ||
        viewParam === 'sandbox' ||
        pathName.includes('/demo') ||
        pathName.includes('/sandbox')
      ) {
        setActiveTab('demo');
      } else {
        // Bare root with no params: this is the staff device (e.g. the
        // iPad or PC in the shop), never a customer - customers only ever
        // arrive via the explicit ?view=customer link from the QR code.
        setActiveTab('cashier');
      }
    } catch (e) {
      console.warn('URL parsing skipped:', e);
    }
  }, []);

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    try {
      if (window.history && window.history.pushState) {
        let routePath = '/cashier';
        if (tab === 'customer') routePath = '/customer';
        else if (tab === 'admin-qr') routePath = '/counter';
        else if (tab === 'demo') routePath = '/sandbox';

        window.history.pushState({}, '', routePath);
      }
    } catch (e) {
      console.warn('pushState ignored:', e);
    }
  };

  // Isolated customer page: no Navbar, no staff shortcuts, nothing but the
  // email form and this customer's own barcode once submitted.
  if (isQrCustomerEntry) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] text-gray-900 flex flex-col font-sans selection:bg-black selection:text-white">
        <main className="flex-1">
          <CustomerView />
        </main>
        <footer className="bg-white text-gray-400 text-center py-4 text-[11px] border-t border-gray-200 print:hidden font-mono uppercase tracking-wider">
          <p>Digital Receipt System • Scontrino Digitale via Email</p>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-gray-900 flex flex-col font-sans selection:bg-black selection:text-white">
      <Navbar activeTab={activeTab} onTabChange={handleTabChange} />

      <main className="flex-1">
        {activeTab === 'customer' && <CustomerView />}
        {activeTab === 'cashier' && <CashierView />}
        {activeTab === 'admin-qr' && <AdminQrView />}
        {activeTab === 'demo' && <DemoAndTestView />}
      </main>

      <footer className="bg-white text-gray-400 text-center py-4 text-[11px] border-t border-gray-200 print:hidden font-mono uppercase tracking-wider">
        <p>Digital Receipt System • POS Barcode Reader Integration • Code 128 Engine</p>
      </footer>
    </div>
  );
}
