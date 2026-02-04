/**
 * Zustand store exports.
 *
 * Usage (industry standard):
 * - Use selectors in components to avoid unnecessary re-renders:
 *   const isDark = useUIStore((s) => s.isDarkMode);
 * - For multiple values, use shallow compare:
 *   import { useShallow } from 'zustand/react/shallow';
 *   const { isDarkMode, currentView } = useUIStore(useShallow((s) => ({ isDarkMode: s.isDarkMode, currentView: s.currentView })));
 * - Call actions from event handlers or effects:
 *   useUIStore.getState().setIsDarkMode(true);
 *   or in component: const setIsDarkMode = useUIStore((s) => s.setIsDarkMode);
 */
export { useUIStore } from './useUIStore';
export { useNotesStore } from './useNotesStore';
export { useWorkspaceStore } from './useWorkspaceStore';
export { useAuthStore } from './useAuthStore';
export { useSubscriptionStore } from './useSubscriptionStore';
export * from './types';
