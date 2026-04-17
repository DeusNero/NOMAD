import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

let toastIdCounter = 0

export function ToastContainer() {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = ++toastIdCounter
    setToasts(prev => [...prev, { id, message, type, duration, removing: false }])

    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, removing: true } : t))
        setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== id))
        }, 300)
      }, duration)
    }

    return id
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, removing: true } : t))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 300)
  }, [])

  // Make addToast globally accessible
  useEffect(() => {
    window.__addToast = addToast
    return () => { delete window.__addToast }
  }, [addToast])

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />,
    error: <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />,
    warning: <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />,
    info: <Info className="w-5 h-5 text-blue-500 flex-shrink-0" />,
  }

  const bgColors = {
    success: 'bg-white border-l-4 border-emerald-500',
    error: 'bg-white border-l-4 border-red-500',
    warning: 'bg-white border-l-4 border-amber-500',
    info: 'bg-white border-l-4 border-blue-500',
  }

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`
            ${bgColors[toast.type] || bgColors.info}
            ${toast.removing ? 'toast-exit' : 'toast-enter'}
            flex items-start gap-3 p-4 rounded-lg shadow-lg pointer-events-auto
            min-w-0
          `}
        >
          {icons[toast.type] || icons.info}
          <p className="text-sm text-slate-700 flex-1 leading-relaxed">{toast.message}</p>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

export const useToast = () => {
  const show = useCallback((message, type, duration) => {
    if (window.__addToast) {
      window.__addToast(message, type, duration)
    }
  }, [])

  return useMemo(() => ({
    success: (message, duration) => show(message, 'success', duration),
    error: (message, duration) => show(message, 'error', duration),
    warning: (message, duration) => show(message, 'warning', duration),
    info: (message, duration) => show(message, 'info', duration),
  }), [show])
}

export default useToast
