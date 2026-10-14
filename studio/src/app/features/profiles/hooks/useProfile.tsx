import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Box, Button, Typography } from '@mui/material'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'
import { FullScreenLoading } from '../../../shared/FullScreenLoading'
import { MESSAGE_GENERIC, useCall } from '../../../shared/useCall'
import { useSession } from '../../auth/hooks/useSession'

export type Profile = components['schemas']['ProfileDto']
export type Channel = components['schemas']['ChannelDto']

interface ProfileValue {
  profile: Profile | null
  channel: Channel | null
}

const ProfileContext = createContext<ProfileValue | null>(null)

/**
 * rule-recouvrement-session-profile: the profile is read once, with the session, before any protected render
 * (rule-foundation-no-protected-flash). A failure other than 401 is a full-screen error with « Réessayer ».
 */
export function RequireProfileLoaded() {
  const call = useCall()
  const { state } = useSession()
  const [load, setLoad] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; value: ProfileValue }>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const userId = state.status === 'authenticated' ? state.user.id : null

  useEffect(() => {
    if (userId === null) return
    let current = true
    setLoad({ status: 'loading' })
    void call(() => api.GET('/profiles/me')).then((outcome) => {
      if (!current) return
      setLoad(outcome.ok ? { status: 'ready', value: { profile: outcome.data.profile, channel: outcome.data.channel } } : { status: 'error' })
    })
    return () => {
      current = false
    }
  }, [call, userId, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const value = useMemo(() => (load.status === 'ready' ? load.value : null), [load])

  if (state.status !== 'authenticated') return null
  if (load.status === 'loading' || value === null) {
    if (load.status !== 'error') return <FullScreenLoading />
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, textAlign: 'center', p: 2 }}>
        <Typography role="alert">{MESSAGE_GENERIC}</Typography>
        <Button variant="contained" onClick={retry}>
          Réessayer
        </Button>
      </Box>
    )
  }
  return (
    <ProfileContext.Provider value={value}>
      <Outlet />
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('Profil non chargé')
  return ctx
}
