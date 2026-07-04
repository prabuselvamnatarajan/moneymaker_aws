/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { X, CheckCircle, AlertCircle } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'error') => {
    const id = `toast-${++counterRef.current}`;
    setToasts(prev => [...prev, { id, type, message }]);
    // Auto-dismiss after 5 s
    setTimeout(() => removeToast(id), 5000);
  }, [removeToast]);

  const showError = useCallback((msg: string) => showToast(msg, 'error'), [showToast]);
  const showSuccess = useCallback((msg: string) => showToast(msg, 'success'), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, showError, showSuccess }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

// ─── Container (fixed overlay) ────────────────────────────────────────────────

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      id="toast-container"
      style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 99999 }}
      className="flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  );
}

// ─── Single Toast Item ────────────────────────────────────────────────────────

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const isError = toast.type === 'error';

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    minWidth: '280px',
    maxWidth: '420px',
    padding: '12px 14px',
    borderRadius: '10px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
    border: `1px solid ${isError ? 'rgba(239,68,68,0.35)' : 'rgba(16,185,129,0.35)'}`,
    background: isError
      ? 'linear-gradient(135deg, rgba(30,10,10,0.97) 0%, rgba(50,10,10,0.97) 100%)'
      : 'linear-gradient(135deg, rgba(5,30,20,0.97) 0%, rgba(5,45,30,0.97) 100%)',
    backdropFilter: 'blur(12px)',
    pointerEvents: 'all',
    animation: 'toastSlideIn 0.25s ease-out',
  };

  return (
    <>
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      <div id={`toast-${toast.id}`} style={baseStyle} role="alert">
        <span style={{ marginTop: '1px', flexShrink: 0 }}>
          {isError
            ? <AlertCircle size={16} color="#f87171" />
            : <CheckCircle size={16} color="#34d399" />
          }
        </span>
        <p style={{
          flex: 1,
          fontSize: '12px',
          fontFamily: 'sans-serif',
          color: isError ? '#fca5a5' : '#6ee7b7',
          lineHeight: '1.5',
          margin: 0,
        }}>
          {toast.message}
        </p>
        <button
          onClick={() => onRemove(toast.id)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0',
            color: isError ? '#f87171' : '#34d399',
            opacity: 0.7,
            flexShrink: 0,
            marginTop: '1px',
          }}
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </div>
    </>
  );
}
