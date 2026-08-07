import { reactive } from "vue";
import { apiClient, ApiError, onUnauthorized } from "./api";
import type { ConnectorSnapshot, LoginCredentials, PublicStatus, SetupStatus, Toast, ToastKind } from "./types";

interface AppState {
  initialized: boolean;
  bootstrapping: boolean;
  authConfigured: boolean;
  authenticated: boolean;
  username: string;
  setupCompleted: boolean;
  bootstrapError: string | null;
  publicStatus: PublicStatus | null;
  setup: SetupStatus | null;
  connector: ConnectorSnapshot | null;
  toasts: Toast[];
}

const state = reactive<AppState>({ initialized: false, bootstrapping: false, authConfigured: true, authenticated: false, username: "", setupCompleted: false, bootstrapError: null, publicStatus: null, setup: null, connector: null, toasts: [] });
let toastId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function clearSession(): void { state.authenticated = false; state.username = ""; state.setup = null; }
onUnauthorized(clearSession);
export function messageFor(error: unknown, fallback = "操作失败，请稍后重试"): string { return error instanceof Error ? error.message : fallback; }

async function loadSession(): Promise<void> {
  const status = await apiClient.status();
  state.publicStatus = status; state.authConfigured = status.authConfigured; state.setupCompleted = status.setupCompleted; state.connector = status.connector;
  if (!status.authConfigured) { clearSession(); return; }
  try {
    const user = await apiClient.me();
    state.authenticated = true; state.username = user.username;
    const setup = await apiClient.setup();
    state.setup = setup; state.setupCompleted = setup.completed; state.publicStatus = { ...status, setupCompleted: setup.completed };
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error;
  }
}

async function bootstrap(): Promise<void> {
  state.bootstrapping = true; state.bootstrapError = null;
  try { await loadSession(); } catch (error) { state.bootstrapError = messageFor(error); }
  finally { state.bootstrapping = false; state.initialized = true; }
}
async function login(credentials: LoginCredentials): Promise<void> { await apiClient.login(credentials); await loadSession(); }
async function initializeAuth(credentials: LoginCredentials): Promise<void> { await apiClient.initializeAuth(credentials); state.authConfigured = true; await login(credentials); }
async function logout(): Promise<void> { try { await apiClient.logout(); } catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; } finally { clearSession(); } }
function setConnector(snapshot: ConnectorSnapshot): void { state.connector = snapshot; }
function dismissToast(id: number): void { const timer = timers.get(id); if (timer) clearTimeout(timer); timers.delete(id); const index = state.toasts.findIndex((item: Toast) => item.id === id); if (index >= 0) state.toasts.splice(index, 1); }
function notify(message: string, kind: ToastKind = "info", duration = 4500): void { const id = ++toastId; state.toasts.push({ id, message, kind }); if (duration > 0) timers.set(id, setTimeout(() => dismissToast(id), duration)); }

export const appState = { state, bootstrap, refresh: loadSession, login, initializeAuth, logout, setConnector, notify, dismissToast };
export function useAppState() { return appState; }
