import { create } from 'zustand'

/**
 * Auth state: last signed-in Google user (for offline "who was I").
 * Persist to IndexedDB prefs (authLastUser) from components so store stays UI-only.
 */

export interface GoogleUserProfile {
  sub: string
  email?: string
  name: string
  picture: string
}

interface AuthState {
  user: GoogleUserProfile | null
}

interface AuthActions {
  setUser: (user: GoogleUserProfile | null) => void
  signOut: () => void
}

export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  user: null,

  setUser: (user) => set({ user }),

  signOut: () => set({ user: null }),
}))
