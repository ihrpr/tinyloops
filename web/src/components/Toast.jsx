import { createContext, useContext, useCallback, useRef, useState } from 'react';

// Confirmation / undo / error toast, exposed as a context so any view can
// call showToast(msg, { undo, error }).
const ToastContext = createContext(null);

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { msg, undo, error }
  const timer = useRef(null);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const showToast = useCallback((msg, { undo = null, error = false } = {}) => {
    clearTimeout(timer.current);
    setToast({ msg, undo, error });
    timer.current = setTimeout(() => setToast(null), error ? 6000 : 5000);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && (
        <div className={'toast' + (toast.error ? ' error' : '')}>
          <span>{toast.msg}</span>
          {toast.undo && (
            <button onClick={() => { hide(); toast.undo(); }}>Undo</button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}
