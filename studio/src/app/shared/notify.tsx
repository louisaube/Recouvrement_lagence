import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Alert, Snackbar } from '@mui/material'

type Notify = (message: string, severity?: 'success' | 'error') => void

const NotifyContext = createContext<Notify>(() => undefined)

/** Notifications ("Utilisateur créé." …), success unless stated otherwise. */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ message: string; severity: 'success' | 'error' } | null>(null)
  const notify = useCallback<Notify>((message, severity = 'success') => setCurrent({ message, severity }), [])
  const value = useMemo(() => notify, [notify])
  return (
    <NotifyContext.Provider value={value}>
      {children}
      <Snackbar
        open={current !== null}
        autoHideDuration={5000}
        onClose={(_, reason) => reason !== 'clickaway' && setCurrent(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={current?.severity ?? 'success'} variant="filled" onClose={() => setCurrent(null)} closeText="Fermer">
          {current?.message}
        </Alert>
      </Snackbar>
    </NotifyContext.Provider>
  )
}

export function useNotify() {
  return useContext(NotifyContext)
}
