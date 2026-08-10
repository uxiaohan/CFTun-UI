<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { apiClient } from "../api";
import { messageFor, useAppState } from "../state";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import FormDialog from "../components/FormDialog.vue";
import SelectMenu from "../components/SelectMenu.vue";
import StatusBadge from "../components/StatusBadge.vue";
import type { ConnectorSettingsInput } from "../types";

const { state, logout, notify, refresh, setConnector } = useAppState();
const setup = computed(() => state.setup);
const apiToken = ref("");
const accountId = ref("");
const tokenBusy = ref(false);
const confirmAccountChange = ref(false);
const connectorBusy = ref(false);
const passwordDialogOpen = ref(false);
const credentialBusy = ref(false);
const passwordForm = ref<HTMLDivElement | null>(null);
const credentials = reactive({ username: "", currentPassword: "", password: "", confirmPassword: "" });
const credentialErrors = reactive({ username: "", currentPassword: "", password: "", confirmPassword: "", general: "" });
const connectorSettings = reactive<ConnectorSettingsInput>({ autoStart: true, protocol: "auto", edgeIpVersion: "auto" });

watch(() => setup.value?.accountId, (value) => { accountId.value = value || ""; }, { immediate: true });
watch(() => setup.value, (value) => {
  if (!value) return;
  connectorSettings.autoStart = value.connectorAutoStart;
  connectorSettings.protocol = value.connectorProtocol;
  connectorSettings.edgeIpVersion = value.connectorEdgeIpVersion;
}, { immediate: true });

function clearCredentialForm(): void {
  credentials.username = state.username;
  credentials.currentPassword = "";
  credentials.password = "";
  credentials.confirmPassword = "";
  Object.keys(credentialErrors).forEach((key) => { credentialErrors[key as keyof typeof credentialErrors] = ""; });
}

function openPasswordDialog(): void {
  clearCredentialForm();
  passwordDialogOpen.value = true;
}

function closePasswordDialog(): void {
  if (!credentialBusy.value) passwordDialogOpen.value = false;
}

function validateCredentials(): boolean {
  Object.keys(credentialErrors).forEach((key) => { credentialErrors[key as keyof typeof credentialErrors] = ""; });
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(credentials.username)) credentialErrors.username = "用户名需为 1 至 64 位，仅支持字母、数字、下划线、点和短横线。";
  if (!credentials.currentPassword) credentialErrors.currentPassword = "请输入当前密码。";
  if (credentials.password.length < 6) credentialErrors.password = "新密码至少需要 6 个字符。";
  if (!credentials.confirmPassword) credentialErrors.confirmPassword = "请再次输入新密码。";
  else if (credentials.password !== credentials.confirmPassword) credentialErrors.confirmPassword = "两次输入的新密码不一致。";
  return !Object.values(credentialErrors).some(Boolean);
}

async function saveCredentials(): Promise<void> {
  if (!validateCredentials()) {
    await nextTick();
    passwordForm.value?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
    return;
  }
  credentialBusy.value = true;
  try {
    await apiClient.updateCredentials({ username: credentials.username, currentPassword: credentials.currentPassword, password: credentials.password });
    passwordDialogOpen.value = false;
    await logout();
  } catch (error: unknown) {
    credentialErrors.general = messageFor(error, "无法更新密码，请稍后重试");
  } finally {
    credentialBusy.value = false;
  }
}

function requestCloudflareSave(): void {
  if (setup.value?.accountId && accountId.value.trim() !== setup.value.accountId) confirmAccountChange.value = true;
  else void saveCloudflare();
}

async function saveCloudflare(): Promise<void> {
  confirmAccountChange.value = false;
  tokenBusy.value = true;
  try {
    const result = await apiClient.updateCloudflare({ accountId: accountId.value.trim(), token: apiToken.value });
    apiToken.value = "";
    const message = result.accountChanged ? "Account 已切换，本地绑定和映射已清空，请重新完成设置"
      : result.tunnelInvalidated ? "Cloudflare 凭据已更新，但原 Tunnel 已不存在，请重新选择 Tunnel"
      : "Cloudflare 凭据和 Tunnel Token 已更新";
    notify(message, result.tunnelInvalidated ? "info" : "success", 7000);
    await refresh();
  } catch (error: unknown) {
    notify(messageFor(error, "无法更新 Cloudflare 凭据，请稍后重试"), "error");
  } finally {
    tokenBusy.value = false;
  }
}

async function saveConnector(): Promise<void> {
  connectorBusy.value = true;
  try {
    const result = await apiClient.updateConnector(connectorSettings);
    if (result.connector) setConnector(result.connector);
    notify("Connector 设置已保存，将在下次启动或重启后生效", "success", 6000);
  } catch (error) {
    notify(messageFor(error, "无法保存 Connector 设置"), "error");
  } finally {
    connectorBusy.value = false;
  }
}
</script>

<template>
  <section class="mx-auto max-w-4xl">
    <header>
      <p class="eyebrow">实例配置</p>
      <h1 class="mt-2 text-2xl font-semibold tracking-[-.035em]">设置</h1>
      <p class="mt-2 text-[13px] text-muted">管理 Cloudflare 绑定、Connector 行为与账户安全。</p>
    </header>

    <div class="mt-6 space-y-4">
      <section class="card overflow-hidden">
        <header class="border-b border-black/[.07] px-5 py-4">
          <h2 class="text-[14px] font-semibold">Cloudflare 配置</h2>
          <p class="mt-1 text-[11px] leading-5 text-muted">替换当前实例使用的 Account 与 API Token。</p>
        </header>
        <form class="p-5" @submit.prevent="requestCloudflareSave">
          <div class="grid gap-4 sm:grid-cols-2">
            <div><label class="label" for="settings-account-id">Account ID</label><input id="settings-account-id" v-model.trim="accountId" class="field font-mono" autocomplete="off" minlength="16" maxlength="64" required></div>
            <div><label class="label" for="settings-api-token">新 API Token</label><input id="settings-api-token" v-model.trim="apiToken" class="field font-mono" type="password" autocomplete="off" required></div>
          </div>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/[.06] pt-4">
            <div class="flex min-w-0 items-center gap-3"><StatusBadge :status="setup?.tokenConfigured ? 'running' : 'stopped'" :label="setup?.tokenConfigured ? 'Token 已配置' : 'Token 未配置'" /><span class="truncate text-[11px] text-muted" :title="setup?.tunnelId || undefined">Tunnel · {{ setup?.tunnelName || setup?.tunnelId || "未设置" }}</span></div>
            <button class="btn-primary" type="submit" :disabled="tokenBusy"><span v-if="tokenBusy" class="spinner" aria-hidden="true" />{{ tokenBusy ? "正在更新" : "保存 Cloudflare 配置" }}</button>
          </div>
        </form>
      </section>

      <section class="card relative z-10">
        <header class="border-b border-black/[.07] px-5 py-4">
          <h2 class="text-[14px] font-semibold">Connector 配置</h2>
          <p class="mt-1 text-[11px] leading-5 text-muted">配置 cloudflared 的启动行为与网络连接偏好。</p>
        </header>
        <form class="p-5" @submit.prevent="saveConnector">
          <label class="flex items-center gap-2 text-xs"><input v-model="connectorSettings.autoStart" type="checkbox">系统启动时自动连接上次使用的 Tunnel</label>
          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <div><label class="label">传输协议</label><SelectMenu v-model="connectorSettings.protocol" :options="[{value:'auto',label:'自动'},{value:'quic',label:'QUIC'},{value:'http2',label:'HTTP/2'}]" /></div>
            <div><label class="label">Edge IP</label><SelectMenu v-model="connectorSettings.edgeIpVersion" :options="[{value:'auto',label:'自动'},{value:'4',label:'IPv4'},{value:'6',label:'IPv6'}]" /></div>
          </div>
          <div class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-black/[.06] pt-4">
            <p class="text-[11px] text-muted">配置将在 cloudflared 下次启动或重启后生效。</p>
            <button class="btn-primary" type="submit" :disabled="connectorBusy"><span v-if="connectorBusy" class="spinner" aria-hidden="true" />{{ connectorBusy ? "正在保存" : "保存 Connector" }}</button>
          </div>
        </form>
      </section>

      <section class="card overflow-hidden">
        <header class="border-b border-black/[.07] px-5 py-4">
          <h2 class="text-[14px] font-semibold">账户安全</h2>
          <p class="mt-1 text-[11px] leading-5 text-muted">修改登录信息后，所有已登录的控制台会话都将退出。</p>
        </header>
        <div class="flex flex-wrap items-center justify-between gap-4 p-5">
          <div class="min-w-0"><p class="text-[11px] text-muted">当前用户名</p><p class="mt-1 truncate font-mono text-[13px] font-medium">{{ state.username }}</p></div>
          <button class="btn-secondary" type="button" @click="openPasswordDialog">修改登录信息</button>
        </div>
      </section>

      <section class="card overflow-hidden">
        <header class="border-b border-black/[.07] px-5 py-4">
          <h2 class="text-[14px] font-semibold">实例信息</h2>
          <p class="mt-1 text-[11px] leading-5 text-muted">当前本地控制台与连接器状态。</p>
        </header>
        <dl class="grid px-5 py-2 text-xs sm:grid-cols-3">
          <div class="border-b border-black/[.055] py-3 sm:border-b-0 sm:border-r sm:pr-5"><dt class="text-muted">当前用户</dt><dd class="mt-1.5 truncate font-mono font-medium">{{ state.username }}</dd></div>
          <div class="border-b border-black/[.055] py-3 sm:border-b-0 sm:border-r sm:px-5"><dt class="text-muted">连接器</dt><dd class="mt-1.5"><StatusBadge :status="state.connector?.state || 'stopped'" /></dd></div>
          <div class="py-3 sm:pl-5"><dt class="text-muted">存储方式</dt><dd class="mt-1.5 font-mono font-medium">SQLite · WAL</dd></div>
        </dl>
      </section>
    </div>
  </section>

  <FormDialog :open="passwordDialogOpen" title="修改登录信息" description="保存用户名或密码后，需要使用新的登录信息重新登录。" submit-label="保存登录信息" :busy="credentialBusy" @close="closePasswordDialog" @submit="saveCredentials">
    <div ref="passwordForm">
      <label class="label" for="credential-username">用户名</label>
      <input id="credential-username" v-model.trim="credentials.username" class="field" autocomplete="username" minlength="1" maxlength="64" pattern="[A-Za-z0-9_.-]+" :aria-invalid="!!credentialErrors.username" :aria-describedby="credentialErrors.username ? 'username-error' : 'username-hint'" required>
      <p v-if="credentialErrors.username" id="username-error" class="mt-1.5 text-[11px] text-red-600">{{ credentialErrors.username }}</p><p v-else id="username-hint" class="mt-1.5 text-[10px] text-muted">1 至 64 位，支持字母、数字、下划线、点和短横线。</p>
      <label class="label mt-4" for="credential-current-password">当前密码</label>
      <input id="credential-current-password" v-model="credentials.currentPassword" class="field" type="password" autocomplete="current-password" :aria-invalid="!!credentialErrors.currentPassword" :aria-describedby="credentialErrors.currentPassword ? 'current-password-error' : undefined" required>
      <p v-if="credentialErrors.currentPassword" id="current-password-error" class="mt-1.5 text-[11px] text-red-600">{{ credentialErrors.currentPassword }}</p>
      <label class="label mt-4" for="credential-new-password">新密码</label>
      <input id="credential-new-password" v-model="credentials.password" class="field" type="password" autocomplete="new-password" minlength="6" :aria-invalid="!!credentialErrors.password" :aria-describedby="credentialErrors.password ? 'new-password-error' : 'new-password-hint'" required>
      <p v-if="credentialErrors.password" id="new-password-error" class="mt-1.5 text-[11px] text-red-600">{{ credentialErrors.password }}</p><p v-else id="new-password-hint" class="mt-1.5 text-[10px] text-muted">请使用至少 6 个字符。</p>
      <label class="label mt-4" for="credential-confirm-password">确认新密码</label>
      <input id="credential-confirm-password" v-model="credentials.confirmPassword" class="field" type="password" autocomplete="new-password" minlength="6" :aria-invalid="!!credentialErrors.confirmPassword" :aria-describedby="credentialErrors.confirmPassword ? 'confirm-password-error' : undefined" required>
      <p v-if="credentialErrors.confirmPassword" id="confirm-password-error" class="mt-1.5 text-[11px] text-red-600">{{ credentialErrors.confirmPassword }}</p>
      <p v-if="credentialErrors.general" class="alert-error mt-4" role="alert">{{ credentialErrors.general }}</p>
    </div>
  </FormDialog>
  <ConfirmDialog :open="confirmAccountChange" title="切换 Cloudflare Account？" description="确认后会清空当前实例的本地 Tunnel 绑定和映射，并返回初始化流程。Cloudflare 上的 Tunnel、Ingress 和 DNS 等远端资源不会被删除。" confirm-label="确认切换" :busy="tokenBusy" @cancel="confirmAccountChange=false" @confirm="saveCloudflare" />
</template>
