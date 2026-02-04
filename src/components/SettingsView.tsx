import { useCallback, useEffect, useRef, useState } from 'react'
import { useUIStore, useWorkspaceStore, useNotesStore } from '../store'
import { useAuthStore } from '../store/useAuthStore'
import { useSubscriptionStore } from '../store/useSubscriptionStore'
import { db } from '../db'
import { getPipWindow } from '../pip/documentPip'
/** Icon paths: files in public (copy of extension assets), not inline SVG. */
const NOTION_ICON_URL = '/notion.svg'
const OBSIDIAN_ICON_URL = '/obsidian.svg'
import { ArrowLeft } from 'lucide-react'
import {
  getNotionAuthorizeUrl,
  getNotionStatus,
  setNotionSyncRoot,
  syncToNotion,
  getObsidianExport,
  openBillingPage,
  type NotionStatus,
} from '../api/backend'
import {
  exportWorkspaceAsZip,
  downloadExportBlob,
  obsidianFilesToZipBlob,
} from '../utils/exportZip'
import { importFromZip } from '../utils/importZip'
import { trackEvent } from '../analytics'

const NOTE_THEME_KEY = 'notic_noteTheme'
const NOTE_THEME_VALUES = ['default', 'sepia', 'dark', 'high-contrast'] as const
type NoteThemeId = (typeof NOTE_THEME_VALUES)[number]

const NOTE_THEME_OPTIONS: Array<{ value: NoteThemeId; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Dark' },
  { value: 'high-contrast', label: 'High contrast' },
]

function getStoredNoteTheme(): NoteThemeId {
  if (typeof window === 'undefined') return 'default'
  try {
    const stored = localStorage.getItem(NOTE_THEME_KEY)
    if (stored && NOTE_THEME_VALUES.includes(stored as NoteThemeId)) return stored as NoteThemeId
  } catch (_) {}
  return 'default'
}

function setStoredNoteTheme(theme: NoteThemeId): void {
  try {
    localStorage.setItem(NOTE_THEME_KEY, theme)
  } catch (_) {}
}

/** Notify PiP window to apply new note theme (so open PiP updates without reload). */
function notifyPiPNoteTheme(theme: NoteThemeId): void {
  const pipWin = getPipWindow()
  if (pipWin && !pipWin.closed) {
    pipWin.postMessage({ type: 'notic-note-theme-changed', theme }, '*')
  }
}

export function SettingsView() {
  const isDarkMode = useUIStore((s) => s.isDarkMode)
  const setIsDarkMode = useUIStore((s) => s.setIsDarkMode)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const notes = useNotesStore((s) => s.notes)
  const authUser = useAuthStore((s) => s.user)
  const isSubscribed = useSubscriptionStore((s) => s.isSubscribed)
  const addFolder = useNotesStore((s) => s.addFolder)
  const addNote = useNotesStore((s) => s.addNote)
  const updateNote = useNotesStore((s) => s.updateNote)

  const settingsSubView = useUIStore((s) => s.settingsSubView)
  const setSettingsSubView = useUIStore((s) => s.setSettingsSubView)
  const setToastMessage = useUIStore((s) => s.setToastMessage)
  const [noteTheme, setNoteThemeState] = useState<NoteThemeId>(getStoredNoteTheme)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importModal, setImportModal] = useState<{ title: string; message: string } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const [notionStatus, setNotionStatus] = useState<NotionStatus | null>(null)
  const [notionStatusLoading, setNotionStatusLoading] = useState(false)
  const [notionSyncRootInput, setNotionSyncRootInput] = useState('')
  const [notionSetRootLoading, setNotionSetRootLoading] = useState(false)
  const [notionSyncLoading, setNotionSyncLoading] = useState(false)
  const [obsidianExportLoading, setObsidianExportLoading] = useState(false)

  const handleExportZip = useCallback(async () => {
    setIsExporting(true)
    try {
      const state = useNotesStore.getState()
      const wsId = currentWorkspaceId ?? useWorkspaceStore.getState().currentWorkspaceId
      const blob = exportWorkspaceAsZip(state.notes, state.folders, wsId)
      const name = `notic-export-${new Date().toISOString().slice(0, 10)}.zip`
      downloadExportBlob(blob, name)
      trackEvent('export_completed', { format: 'zip' })
    } catch (e) {
      console.error('Export failed', e)
      setImportModal({ title: 'Export failed', message: 'Please try again.' })
    } finally {
      setIsExporting(false)
    }
  }, [currentWorkspaceId])

  const handleImportZipClick = useCallback(() => {
    importInputRef.current?.click()
  }, [])

  const handleImportZipChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      setIsImporting(true)
      setImportModal(null)
      try {
        const buf = await file.arrayBuffer()
        const bytes = new Uint8Array(buf)
        const result = importFromZip(bytes, {
          currentWorkspaceId,
          notes,
          addFolder,
          addNote,
          updateNote,
        })
        if (result.notesImported === 0 && result.foldersCreated === 0) {
          setImportModal({
            title: 'Import',
            message:
              result.skipped > 0
                ? 'No Markdown (.md) files found in this ZIP. Only .md files are imported.'
                : 'No notes were imported from this file.',
          })
        } else {
          const noteWord = result.notesImported === 1 ? 'note' : 'notes'
          const folderWord = result.foldersCreated === 1 ? 'folder' : 'folders'
          const parts = [`${result.notesImported} ${noteWord} imported.`]
          if (result.foldersCreated > 0) {
            parts.push(`${result.foldersCreated} ${folderWord} created.`)
          }
          if (result.skipped > 0) {
            parts.push(`${result.skipped} file(s) skipped.`)
          }
          setImportModal({ title: 'Import complete', message: parts.join(' ') })
        }
      } catch (err) {
        console.error('Import failed', err)
        setImportModal({
          title: 'Import failed',
          message: 'Something went wrong. Please try again.',
        })
      } finally {
        setIsImporting(false)
      }
    },
    [currentWorkspaceId, notes, addFolder, addNote, updateNote]
  )

  // Sync note theme from localStorage (e.g. if PiP changed it)
  useEffect(() => {
    const handler = () => setNoteThemeState(getStoredNoteTheme())
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  // Refresh subscription when opening Settings (signed in) so plan shows Pro/Free instead of — (match extension)
  useEffect(() => {
    if (authUser) void useSubscriptionStore.getState().refresh(db)
  }, [authUser])

  // Load Notion status when Integrations subview is shown and user is signed in
  useEffect(() => {
    if (settingsSubView !== 'integrations' || !authUser) {
      setNotionStatus(null)
      return
    }
    let cancelled = false
    setNotionStatusLoading(true)
    getNotionStatus(db)
      .then((status) => {
        if (!cancelled) setNotionStatus(status)
      })
      .finally(() => {
        if (!cancelled) setNotionStatusLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [settingsSubView, authUser])

  const setNoteTheme = useCallback((theme: NoteThemeId) => {
    setNoteThemeState(theme)
    setStoredNoteTheme(theme)
    notifyPiPNoteTheme(theme)
  }, [])

  const currentWorkspace = currentWorkspaceId ? workspaces[currentWorkspaceId] : null
  const updateWorkspaceMeta = useWorkspaceStore((s) => s.updateWorkspaceMeta)
  const workspaceIcon = (currentWorkspace as { icon?: string } | undefined)?.icon ?? ''
  const workspaceColor = (currentWorkspace as { color?: string } | undefined)?.color ?? ''

  const handleNotionConnect = useCallback(async () => {
    if (!authUser) {
      setToastMessage('Sign in to connect Notion.')
      return
    }
    const result = await getNotionAuthorizeUrl(db)
    if (!result?.url) {
      setToastMessage('Could not get Notion connect link. Try again.')
      return
    }
    window.open(result.url, '_blank', 'noopener,noreferrer')
    setToastMessage('Complete the connection in the opened tab, then return here.')
  }, [authUser])

  const handleNotionSetSyncRoot = useCallback(async () => {
    const value = notionSyncRootInput.trim()
    if (!value) {
      setToastMessage('Enter a Notion page URL or page ID.')
      return
    }
    setNotionSetRootLoading(true)
    try {
      const ok = await setNotionSyncRoot(db, value)
      if (ok) {
        setToastMessage('Sync page set.')
        const status = await getNotionStatus(db)
        setNotionStatus(status)
        if (status?.connected) trackEvent('notion_connected')
      } else {
        setToastMessage('Failed to set sync page. Check the URL or page ID.')
      }
    } finally {
      setNotionSetRootLoading(false)
    }
  }, [notionSyncRootInput])

  const handleSyncToNotion = useCallback(async () => {
    setNotionSyncLoading(true)
    try {
      const result = await syncToNotion(db)
      if (result.paymentRequired) {
        setToastMessage('Notion sync is a Pro feature. Upgrade at getnotic.io/billing.')
        return
      }
      if (result.ok) {
        setToastMessage('Synced to Notion.')
        trackEvent('notion_sync_run')
        const status = await getNotionStatus(db)
        setNotionStatus(status)
      } else {
        setToastMessage(result.message ?? 'Sync failed.')
      }
    } finally {
      setNotionSyncLoading(false)
    }
  }, [])

  const handleObsidianExport = useCallback(async () => {
    if (!authUser) {
      setToastMessage('Sign in to export to Obsidian.')
      return
    }
    setObsidianExportLoading(true)
    try {
      const data = await getObsidianExport(db)
      if (data && 'paymentRequired' in data && data.paymentRequired) {
        setToastMessage('Obsidian export is a Pro feature. Upgrade at getnotic.io/billing.')
        return
      }
      if (!data?.files?.length) {
        setToastMessage('No notes to export.')
        return
      }
      const blob = obsidianFilesToZipBlob(data.files)
      const name = `notic-obsidian-export-${new Date().toISOString().slice(0, 10)}.zip`
      downloadExportBlob(blob, name)
      trackEvent('export_completed', { format: 'obsidian' })
      setToastMessage(`Exported ${data.files.length} file(s). Extract the ZIP into your Obsidian vault.`)
    } catch (e) {
      console.error('Obsidian export failed', e)
      setToastMessage('Export failed. Please try again.')
    } finally {
      setObsidianExportLoading(false)
    }
  }, [authUser])

  if (settingsSubView === 'integrations') {
    const notionStatusText =
      notionStatusLoading
        ? 'Loading…'
        : !authUser
          ? 'Sign in to connect Notion.'
          : !notionStatus
            ? 'Unable to load status. Try again.'
            : !notionStatus.connected
              ? 'Not connected.'
              : (() => {
                  const parts: string[] = [`Connected to ${notionStatus.notionWorkspaceName ?? 'Notion'}.`]
                  if (notionStatus.lastSyncAt) {
                    try {
                      parts.push(`Last synced: ${new Date(notionStatus.lastSyncAt).toLocaleString()}.`)
                    } catch {
                      parts.push('Last synced: —')
                    }
                  } else {
                    parts.push('Not synced yet.')
                  }
                  return parts.join(' ')
                })()
    const notionSyncRootPlaceholder =
      notionStatus?.syncRootPageId
        ? `Sync root set (ID: …${notionStatus.syncRootPageId?.slice(-8) ?? ''})`
        : 'Paste page URL or page ID'
    const showNotionSteps2And3 = notionStatus?.connected === true

    return (
      <div className="settings-page settings-integrations-page">
        <div className="settings-page-content">
          <div className="settings-integrations-header">
            <button
              type="button"
              className="settings-btn settings-btn-icon-only settings-back-btn"
              onClick={() => setSettingsSubView('main')}
              aria-label="Back to Settings"
              title="Back to Settings"
            >
              <ArrowLeft size={18} aria-hidden />
            </button>
            <h2 className="settings-page-title">Integrations</h2>
            <p className="settings-integrations-intro">Sync to Notion or export your notes to Obsidian.</p>
          </div>
          <section className="settings-section settings-section-notion">
            <div className="settings-notion-header">
              <img src={NOTION_ICON_URL} alt="" className="settings-notion-section-icon" aria-hidden />
              <h4 className="settings-section-title">Notion</h4>
            </div>
            <ol className="settings-notion-steps">
              <li className="settings-notion-step">
                <span className="settings-notion-step-num" aria-hidden>1</span>
                <div className="settings-notion-step-body">
                  <strong className="settings-notion-step-title">Connect your account</strong>
                  <p className="settings-notion-step-desc">Opens Notion in a new tab so you can authorize. You only need to do this once.</p>
                  <div className="settings-notion-status">{notionStatusText}</div>
                  <div className="settings-notion-actions">
                    <button
                      type="button"
                      className={`modal-btn ${notionStatus?.connected ? 'modal-btn-secondary' : 'modal-btn-primary'} settings-notion-connect-btn`}
                      disabled={notionStatusLoading}
                      onClick={handleNotionConnect}
                    >
                      <img src={NOTION_ICON_URL} alt="" className="settings-notion-btn-icon" aria-hidden />
                      <span className="settings-notion-connect-label">
                        {notionStatus?.connected ? 'Reconnect' : 'Connect to Notion'}
                      </span>
                    </button>
                  </div>
                </div>
              </li>
              <li className={`settings-notion-step ${showNotionSteps2And3 ? '' : 'content-view-hidden'}`}>
                <span className="settings-notion-step-num" aria-hidden>2</span>
                <div className="settings-notion-step-body">
                  <strong className="settings-notion-step-title">Choose where to sync</strong>
                  <p className="settings-notion-step-desc">Paste the full Notion page URL (e.g. <code>https://notion.so/My-Page-abc123...</code>) or just the page ID. Notes will be pushed under this page.</p>
                  <div className="settings-notion-sync-row">
                    <input
                      type="text"
                      className="settings-input"
                      placeholder={notionSyncRootPlaceholder}
                      aria-label="Notion sync page URL or ID"
                      value={notionSyncRootInput}
                      onChange={(e) => setNotionSyncRootInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="modal-btn modal-btn-secondary"
                      disabled={!showNotionSteps2And3 || notionSetRootLoading}
                      onClick={handleNotionSetSyncRoot}
                    >
                      {notionSetRootLoading ? 'Setting…' : 'Set page'}
                    </button>
                  </div>
                </div>
              </li>
              <li className={`settings-notion-step settings-notion-step-sync ${showNotionSteps2And3 ? '' : 'content-view-hidden'}`}>
                <span className="settings-notion-step-num" aria-hidden>3</span>
                <div className="settings-notion-step-body">
                  <strong className="settings-notion-step-title">Push your notes</strong>
                  <p className="settings-notion-step-desc">Sends your current workspace notes to the page you set above. Run this whenever you want to update Notion.</p>
                  <button
                    type="button"
                    className="modal-btn modal-btn-primary"
                    disabled={!showNotionSteps2And3 || notionSyncLoading}
                    onClick={handleSyncToNotion}
                  >
                    {notionSyncLoading ? 'Syncing…' : 'Sync to Notion'}
                  </button>
                </div>
              </li>
            </ol>
          </section>
          <section className="settings-section settings-section-obsidian">
            <div className="settings-obsidian-header">
              <img src={OBSIDIAN_ICON_URL} alt="" className="settings-obsidian-section-icon" aria-hidden />
              <h4 className="settings-section-title">Obsidian</h4>
            </div>
            <p className="settings-section-desc">Export all your notes as Markdown files. Download a ZIP and extract it into your Obsidian vault.</p>
            <div className="settings-obsidian-how">
              <strong className="settings-obsidian-how-title">How to use with Obsidian</strong>
              <ol className="settings-obsidian-steps">
                <li>Click <strong>Export to Obsidian</strong> to download a ZIP of your notes.</li>
                <li>Extract the ZIP into your Obsidian vault folder (or a folder inside it).</li>
                <li>Notes are <code>.md</code> files with the same workspace and folder structure. Re-export anytime to update.</li>
              </ol>
            </div>
            <button
              type="button"
              className="modal-btn modal-btn-primary"
              disabled={obsidianExportLoading}
              onClick={handleObsidianExport}
            >
              {obsidianExportLoading ? 'Exporting…' : 'Export to Obsidian'}
            </button>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-page">
      <div className="settings-page-content">
        <h2 className="settings-page-title">Settings</h2>

        <section className="settings-section settings-section-appearance">
          <h4 className="settings-section-title">Appearance</h4>
          <p className="settings-section-desc">App theme and note editor look.</p>
          <div className="settings-field">
            <span className="settings-field-label">App theme</span>
            <div className="settings-app-theme" role="radiogroup" aria-label="App theme">
              <label className="settings-app-option">
                <input
                  type="radio"
                  name="appTheme"
                  value="light"
                  className="settings-radio"
                  checked={!isDarkMode}
                  onChange={() => setIsDarkMode(false)}
                />
                <span className="settings-app-preview settings-app-preview-light" aria-hidden />
                <span className="settings-app-name">Light</span>
              </label>
              <label className="settings-app-option">
                <input
                  type="radio"
                  name="appTheme"
                  value="dark"
                  className="settings-radio"
                  checked={isDarkMode}
                  onChange={() => setIsDarkMode(true)}
                />
                <span className="settings-app-preview settings-app-preview-dark" aria-hidden />
                <span className="settings-app-name">Dark</span>
              </label>
            </div>
          </div>
          <div className="settings-field">
            <span className="settings-field-label">Note theme</span>
            <div className="settings-note-theme-grid" role="radiogroup" aria-label="Note theme">
              {NOTE_THEME_OPTIONS.map((opt) => (
                <label key={opt.value} className="settings-note-option">
                  <input
                    type="radio"
                    name="noteTheme"
                    value={opt.value}
                    className="settings-radio"
                    checked={noteTheme === opt.value}
                    onChange={() => setNoteTheme(opt.value)}
                  />
                  <span
                    className={`settings-note-preview settings-note-preview-${opt.value === 'default' ? 'default' : opt.value === 'high-contrast' ? 'highcontrast' : opt.value}`}
                    aria-hidden
                  >
                    Aa
                  </span>
                  <span className="settings-note-name">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-section settings-section-workspace-appearance">
          <h4 className="settings-section-title">Workspace appearance</h4>
          <p className="settings-section-desc">Icon and color for the current workspace (shown in the sidebar).</p>
          {currentWorkspace ? (
            <>
              <div className="settings-field">
                <span className="settings-field-label">Workspace icon</span>
                <input
                  type="text"
                  className="settings-workspace-icon-input"
                  maxLength={1}
                  placeholder="Icon"
                  aria-label="Workspace icon (1 character)"
                  value={workspaceIcon}
                  onChange={(e) => {
                    const icon = e.target.value.trim().slice(0, 1)
                    updateWorkspaceMeta(currentWorkspaceId!, { icon: icon || undefined })
                  }}
                />
              </div>
              <div className="settings-field">
                <span className="settings-field-label">Workspace color</span>
                <div className="settings-workspace-colors" role="radiogroup" aria-label="Workspace color">
                  {[
                    { value: '', title: 'Default' },
                    { value: '#3b82f6', title: 'Blue' },
                    { value: '#22c55e', title: 'Green' },
                    { value: '#a855f7', title: 'Purple' },
                    { value: '#f97316', title: 'Orange' },
                  ].map(({ value, title }) => (
                    <button
                      key={value || 'default'}
                      type="button"
                      className={`settings-workspace-color-btn ${workspaceColor === value ? 'active' : ''}`}
                      data-color={value}
                      title={title}
                      aria-label={title}
                      aria-pressed={workspaceColor === value}
                      style={value ? { background: value } : undefined}
                      onClick={() => updateWorkspaceMeta(currentWorkspaceId!, { color: value || undefined })}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="settings-section-desc" style={{ marginBottom: 0 }}>No workspace selected.</p>
          )}
        </section>

        <section className="settings-section settings-section-plan">
          <h4 className="settings-section-title">Plan</h4>
          <p className="settings-section-desc">
            {authUser ? 'Manage your Notic plan and billing.' : 'Sign in to view and manage your Notic plan and billing.'}
          </p>
          <div className="settings-plan-row">
            <span className="settings-plan-label">Your plan</span>
            <span className="settings-plan-value">
              {!authUser
                ? 'Sign in to see your plan'
                : isSubscribed === null
                  ? '—'
                  : isSubscribed
                    ? 'Pro'
                    : 'Free'}
            </span>
          </div>
          <button
            type="button"
            className="settings-plan-link"
            onClick={() => void openBillingPage(db, setToastMessage)}
          >
            {!authUser ? 'Sign in to manage plan' : isSubscribed ? 'Manage plan' : 'Upgrade plan'}
          </button>
        </section>

        <section className="settings-section settings-section-integrations-link">
          <h4 className="settings-section-title">Integrations</h4>
          <p className="settings-section-desc">Sync to Notion or export your notes to Obsidian.</p>
          <button
            type="button"
            className="settings-integrations-link-btn modal-btn modal-btn-secondary"
            onClick={() => setSettingsSubView('integrations')}
          >
            Open Integrations
          </button>
        </section>

        <section className="settings-section settings-section-export">
          <h4 className="settings-section-title">Export</h4>
          <p className="settings-section-desc">Download all notes in this workspace as a ZIP of Markdown files, with folder structure preserved. Export your data anytime. Notes are stored locally and synced when you're signed in.</p>
          <button
            type="button"
            className="modal-btn modal-btn-secondary"
            disabled={isExporting}
            onClick={handleExportZip}
          >
            {isExporting ? 'Exporting…' : 'Export workspace as ZIP'}
          </button>
        </section>

        <section className="settings-section settings-section-import">
          <h4 className="settings-section-title">Import</h4>
          <p className="settings-section-desc">Import notes from a ZIP of Markdown files. Only .md files are imported; folder structure is recreated.</p>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip,application/zip"
            className="settings-import-input"
            aria-label="Choose ZIP file"
            onChange={handleImportZipChange}
          />
          <button
            type="button"
            className="modal-btn modal-btn-secondary"
            disabled={isImporting}
            onClick={handleImportZipClick}
          >
            {isImporting ? 'Importing…' : 'Import from ZIP'}
          </button>
        </section>

        {importModal && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-result-title"
            onClick={() => setImportModal(null)}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 id="import-result-title" className="modal-title">
                  {importModal.title}
                </h2>
                <p className="modal-message">{importModal.message}</p>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-btn modal-btn-primary"
                  onClick={() => setImportModal(null)}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="settings-section settings-section-help">
          <h4 className="settings-section-title">Help</h4>
          <p className="settings-section-desc">Need help? Email us and we'll get back to you.</p>
          <a href="mailto:hello@getnotic.io" className="settings-plan-link">
            hello@getnotic.io
          </a>
        </section>

        <section className="settings-section settings-section-about">
          <h4 className="settings-section-title">About</h4>
          <p className="settings-section-desc">Notic — minimalist notes with a floating editor.</p>
          <div className="settings-about-row">
            <span className="settings-about-version">Web app</span>
            <a href="https://getnotic.io" target="_blank" rel="noopener noreferrer" className="settings-about-link">
              getnotic.io
            </a>
          </div>
          <div className="settings-about-links">
            <a href="https://getnotic.io/privacy" target="_blank" rel="noopener noreferrer" className="settings-about-link">Privacy</a>
            <span className="settings-about-sep" aria-hidden>·</span>
            <a href="https://getnotic.io/terms" target="_blank" rel="noopener noreferrer" className="settings-about-link">Terms</a>
          </div>
        </section>
      </div>
    </div>
  )
}
