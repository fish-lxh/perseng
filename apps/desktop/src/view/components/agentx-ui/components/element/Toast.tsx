/**
 * Toast - Notification component
 *
 * Displays temporary notifications to users.
 * Supports different severity levels and auto-dismiss.
 */

import * as React from "react";
import { AlertCircleIcon, AlertTriangleIcon, InfoIcon, XIcon } from "@/components/icons";

export type ToastSeverity = "info" | "warn" | "error" | "fatal";

export interface ToastProps {
  /**
   * Unique identifier for the toast
   */
  id: string;

  /**
   * Toast message
   */
  message: string;

  /**
   * Severity level
   * @default "info"
   */
  severity?: ToastSeverity;

  /**
   * Auto dismiss duration in milliseconds
   * Set to 0 to disable auto dismiss
   * @default 5000
   */
  duration?: number;

  /**
   * Callback when toast is dismissed
   */
  onDismiss?: (id: string) => void;
}

/**
 * Toast component - Single toast notification
 */
export const Toast: React.FC<ToastProps> = ({
  id,
  message,
  severity = "info",
  duration = 5000,
  onDismiss,
}) => {
  React.useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onDismiss?.(id);
      }, duration);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [id, duration, onDismiss]);

  const getSeverityStyles = () => {
    switch (severity) {
      case "fatal":
        return "bg-red-600 text-white border-red-700";
      case "error":
        return "bg-red-50 text-red-900 border-red-200";
      case "warn":
        return "bg-yellow-50 text-yellow-900 border-yellow-200";
      case "info":
      default:
        return "bg-blue-50 text-blue-900 border-blue-200";
    }
  };

  const getSeverityIcon = () => {
    switch (severity) {
      case "fatal":
      case "error":
        return <AlertCircleIcon className="w-5 h-5" />;
      case "warn":
        return <AlertTriangleIcon className="w-5 h-5" />;
      case "info":
      default:
        return <InfoIcon className="w-5 h-5" />;
    }
  };

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-lg border shadow-lg
        min-w-[300px] max-w-[500px]
        animate-slide-in
        ${getSeverityStyles()}
      `}
      role="alert"
    >
      <div className="flex-shrink-0">{getSeverityIcon()}</div>

      <div className="flex-1 pt-0.5">
        <p className="text-sm font-medium">{message}</p>
      </div>

      <button
        onClick={() => onDismiss?.(id)}
        className="flex-shrink-0 text-current hover:opacity-70 transition-opacity"
        aria-label="Close"
      >
        <XIcon className="w-4 h-4" />
      </button>
    </div>
  );
};

/**
 * ToastContainer - Container for managing multiple toasts
 */
export interface ToastContainerProps {
  /**
   * Array of toasts to display
   */
  toasts: ToastProps[];

  /**
   * Position of the toast container
   * @default "top-right"
   */
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center";

  /**
   * Maximum number of toasts to display
   * @default 3
   */
  maxToasts?: number;

  /**
   * Callback when toast is dismissed
   */
  onDismiss?: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  position = "top-right",
  maxToasts = 3,
  onDismiss,
}) => {
  const getPositionStyles = () => {
    switch (position) {
      case "top-left":
        return "top-4 left-4";
      case "bottom-right":
        return "bottom-4 right-4";
      case "bottom-left":
        return "bottom-4 left-4";
      case "top-center":
        return "top-4 left-1/2 -translate-x-1/2";
      case "top-right":
      default:
        return "top-4 right-4";
    }
  };

  // Limit toasts to maxToasts
  const visibleToasts = toasts.slice(0, maxToasts);

  return (
    <div className={`fixed ${getPositionStyles()} z-50 flex flex-col gap-2`}>
      {visibleToasts.map((toast) => (
        <Toast key={toast.id} {...toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

/**
 * useToast hook - Manage toasts state
 */
export interface UseToastReturn {
  toasts: ToastProps[];
  showToast: (message: string, severity?: ToastSeverity, duration?: number) => void;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

export const useToast = (): UseToastReturn => {
  const [toasts, setToasts] = React.useState<ToastProps[]>([]);

  const showToast = React.useCallback(
    (message: string, severity: ToastSeverity = "info", duration = 5000) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newToast: ToastProps = {
        id,
        message,
        severity,
        duration,
      };
      setToasts((prev) => [...prev, newToast]);
    },
    []
  );

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const clearToasts = React.useCallback(() => {
    setToasts([]);
  }, []);

  return {
    toasts,
    showToast,
    dismissToast,
    clearToasts,
  };
};
