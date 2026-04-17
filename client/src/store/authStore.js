import { create } from 'zustand'
import { authApi } from '../api/client'
import { connect, disconnect } from '../api/websocket'

async function clearSensitiveCaches() {
  if (typeof window === 'undefined' || !('caches' in window)) return
  await Promise.all(['api-data', 'user-uploads'].map(name => caches.delete(name)))
}

export const useAuthStore = create((set, get) => ({
  user: null,
  token: localStorage.getItem('auth_token') || null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  demoMode: localStorage.getItem('demo_mode') === 'true',
  trustedMode: localStorage.getItem('trusted_mode') === 'true',
  hasMapsKey: false,
  appConfig: null,

  initialize: async () => {
    set({ isLoading: true, error: null })
    try {
      const config = await authApi.getAppConfig()
      const trustedMode = !!config?.trusted_mode
      const demoMode = !!config?.demo_mode
      const token = trustedMode ? null : (localStorage.getItem('auth_token') || null)

      if (trustedMode) {
        localStorage.removeItem('auth_token')
        localStorage.setItem('trusted_mode', 'true')
      } else {
        localStorage.removeItem('trusted_mode')
      }

      if (demoMode) localStorage.setItem('demo_mode', 'true')
      else localStorage.removeItem('demo_mode')

      set({
        appConfig: config,
        demoMode,
        hasMapsKey: !!config?.has_maps_key,
        token,
        trustedMode,
      })

      if (!trustedMode && !token) {
        disconnect()
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        })
        return
      }

      const data = await authApi.me()
      set({
        user: data.user,
        token,
        isAuthenticated: true,
        isLoading: false,
      })
      connect(token)
    } catch (err) {
      disconnect()
      localStorage.removeItem('auth_token')
      localStorage.removeItem('trusted_mode')
      set({
        user: null,
        token: null,
        trustedMode: false,
        isAuthenticated: false,
        isLoading: false,
        error: err.response?.data?.error || null,
      })
    } finally {
      clearSensitiveCaches().catch(() => {})
    }
  },

  login: async (email, password) => {
    if (get().trustedMode) {
      throw new Error('Login is disabled in trusted mode')
    }
    set({ isLoading: true, error: null })
    try {
      const data = await authApi.login({ email, password })
      localStorage.setItem('auth_token', data.token)
      set({
        user: data.user,
        token: data.token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      })
      connect(data.token)
      return data
    } catch (err) {
      const error = err.response?.data?.error || 'Login failed'
      set({ isLoading: false, error })
      throw new Error(error)
    }
  },

  register: async (username, email, password) => {
    if (get().trustedMode) {
      throw new Error('Registration is disabled in trusted mode')
    }
    set({ isLoading: true, error: null })
    try {
      const data = await authApi.register({ username, email, password })
      localStorage.setItem('auth_token', data.token)
      set({
        user: data.user,
        token: data.token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      })
      connect(data.token)
      return data
    } catch (err) {
      const error = err.response?.data?.error || 'Registration failed'
      set({ isLoading: false, error })
      throw new Error(error)
    }
  },

  logout: () => {
    disconnect()
    localStorage.removeItem('auth_token')
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      error: null,
    })
    clearSensitiveCaches().catch(() => {})
  },

  updateMapsKey: async (key) => {
    try {
      await authApi.updateMapsKey(key)
      set(state => ({
        user: { ...state.user, maps_api_key: key || null }
      }))
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error saving API key')
    }
  },

  updateApiKeys: async (keys) => {
    try {
      const data = await authApi.updateApiKeys(keys)
      set({ user: data.user })
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error saving API keys')
    }
  },

  updateProfile: async (profileData) => {
    try {
      const data = await authApi.updateSettings(profileData)
      set({ user: data.user })
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Error updating profile')
    }
  },

  uploadAvatar: async (file) => {
    const formData = new FormData()
    formData.append('avatar', file)
    const data = await authApi.uploadAvatar(formData)
    set(state => ({ user: { ...state.user, avatar_url: data.avatar_url } }))
    return data
  },

  deleteAvatar: async () => {
    await authApi.deleteAvatar()
    set(state => ({ user: { ...state.user, avatar_url: null } }))
  },

  setDemoMode: (val) => {
    if (val) localStorage.setItem('demo_mode', 'true')
    else localStorage.removeItem('demo_mode')
    set({ demoMode: val })
  },

  setHasMapsKey: (val) => set({ hasMapsKey: val }),

  demoLogin: async () => {
    if (get().trustedMode) {
      throw new Error('Demo login is disabled in trusted mode')
    }
    set({ isLoading: true, error: null })
    try {
      const data = await authApi.demoLogin()
      localStorage.setItem('auth_token', data.token)
      set({
        user: data.user,
        token: data.token,
        isAuthenticated: true,
        isLoading: false,
        demoMode: true,
        error: null,
      })
      connect(data.token)
      return data
    } catch (err) {
      const error = err.response?.data?.error || 'Demo login failed'
      set({ isLoading: false, error })
      throw new Error(error)
    }
  },
}))
