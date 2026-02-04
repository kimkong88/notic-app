/** Prefs key names for IndexedDB prefs table (aligned with notic storage-keys where relevant). */
export const PREFS_KEYS = {
  currentWorkspaceId: 'currentWorkspaceId',
  sidebarCollapsed: 'sidebarCollapsed',
  isDarkMode: 'isDarkMode',
  sidebarWidth: 'sidebarWidth',
  /** Last signed-in Google user (name, email, picture, sub) for offline "who was I". */
  authLastUser: 'authLastUser',
  /** Backend JWT access token (set after POST /auth/authenticate). */
  authAccessToken: 'notic_authAccessToken',
  /** Backend refresh token. */
  authRefreshToken: 'notic_authRefreshToken',
  /** Backend user id (partition). Cleared on sign-out. */
  authUserId: 'notic_authUserId',
  /** Last signed-in user id; set on sign-in, not cleared on sign-out. Used for offline restore (extension: AUTH_LAST_USER_ID_KEY). */
  authLastUserId: 'notic_authLastUserId',
  /** Subscription: true = Pro, false = Free (from GET /billing/status). */
  subscriptionIsPro: 'notic_subscriptionIsPro',
  /** Debug: when true, sync is paused (no pull/push). Match extension SYNC_PAUSED_KEY. */
  syncPaused: 'notic_syncPaused',
} as const
