<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { apiClient } from "../api";
import { messageFor, useAppState } from "../state";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import FormDialog from "../components/FormDialog.vue";
import SelectMenu from "../components/SelectMenu.vue";
import StatusBadge from "../components/StatusBadge.vue";
import type { CloudflareChoice, ConnectorSettingsInput } from "../types";

const { state, logout, notify, refresh, setConnector } = useAppState();
const setup = computed(() => state.setup);
const apiToken = ref("");
const apiTokenVisible = ref(false);
const accountId = ref("");
const tokenBusy = ref(false);
const confirmAccountChange = ref(false);
const connectorBusy = ref(false);
const tunnelDialogOpen = ref(false);
const tunnels = ref<CloudflareChoice[]>([]);
const selectedTunnelId = ref("");
const tunnelsLoading = ref(false);
const tunnelSwitchBusy = ref(false);
const createTunnelOpen = ref(false);
const createTunnelName = ref("");
const createTunnelBusy = ref(false);
const deleteTunnelTarget = ref<CloudflareChoice | null>(null);
const deleteTunnelBusy = ref(false);
const passwordDialogOpen = ref(false);
const credentialBusy = ref(false);
const passwordForm = ref<HTMLDivElement | null>(null);
const credentials = reactive({ username: "", currentPassword: "", password: "", confirmPassword: "" });
const credentialErrors = reactive({ username: "", currentPassword: "", password: "", confirmPassword: "", general: "" });
const connectorSettings = reactive<ConnectorSettingsInput>({ autoStart: true, protocol: "auto", edgeIpVersion: "auto" });
const sortedTunnels = computed(() => tunnels.value
  .map((tunnel, index) => ({ tunnel, index }))
  .sort((a, b) => {
    const aCurrent = a.tunnel.id === setup.value?.tunnelId;
    const bCurrent = b.tunnel.id === setup.value?.tunnelId;
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    const aTime = Date.parse(a.tunnel.created_at || "");
    const bTime = Date.parse(b.tunnel.created_at || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    return a.index - b.index;
  })
  .map(({ tunnel }) => tunnel));
const tunnelOptions = computed(() => sortedTunnels.value.map((tunnel) => ({ value: tunnel.id, label: `${tunnel.name}${tunnel.id === setup.value?.tunnelId ? "（当前）" : ""}` })));
const tunnelSwitchDisabled = computed(() => tunnelsLoading.value || !selectedTunnelId.value || selectedTunnelId.value === setup.value?.tunnelId);
let tunnelRefreshTimer: number | undefined;

watch(() => setup.value?.accountId, (value) => { accountId.value = value || ""; }, { immediate: true });
watch(() => setup.value?.apiToken, (value) => { apiToken.value = value || ""; }, { immediate: true });
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
    apiTokenVisible.value = false;
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

async function loadTunnels(silent = false): Promise<void> {
  if (!setup.value?.accountId || (!silent && tunnelsLoading.value)) return;
  if (!silent) tunnelsLoading.value = true;
  try { tunnels.value = (await apiClient.tunnels(setup.value.accountId)).filter((tunnel) => tunnel.config_src === "cloudflare"); }
  catch (error) { if (!silent) notify(messageFor(error, "无法加载 Tunnel 列表"), "error"); }
  finally { if (!silent) tunnelsLoading.value = false; }
}

function tunnelStatus(tunnel: CloudflareChoice): { label: string; dot: string } {
  const current = tunnel.id === setup.value?.tunnelId;
  if (current) {
    if (state.connector?.state === "starting") return { label: "连接中", dot: "bg-blue-500" };
    if (state.connector?.state === "backoff") return { label: "等待重连", dot: "bg-amber-500" };
    if (state.connector?.state === "failed") return { label: "连接异常", dot: "bg-red-500" };
    if (state.connector?.state === "stopped") return { label: "已停止", dot: "bg-slate-400" };
    if (tunnel.status === "healthy") return { label: "连接正常", dot: "bg-emerald-500" };
    if (tunnel.status === "degraded") return { label: "连接不稳", dot: "bg-amber-500" };
    if (tunnel.status === "down") return { label: "连接异常", dot: "bg-red-500" };
    return { label: "连接中", dot: "bg-blue-500" };
  }
  if (tunnel.status === "healthy") return { label: "已连接", dot: "bg-emerald-500" };
  if (tunnel.status === "degraded") return { label: "连接不稳", dot: "bg-amber-500" };
  if (tunnel.status === "down" || tunnel.status === "inactive") return { label: "闲置", dot: "bg-blue-500" };
  return { label: "未知", dot: "bg-slate-400" };
}

async function createTunnel(): Promise<void> {
  const name = createTunnelName.value.trim(); if (!name) return;
  createTunnelBusy.value = true;
  try { await apiClient.createTunnel(name); createTunnelOpen.value = false; createTunnelName.value = ""; await loadTunnels(); notify(`Tunnel「${name}」已创建`, "success"); }
  catch (error) { notify(messageFor(error, "创建 Tunnel 失败"), "error"); }
  finally { createTunnelBusy.value = false; }
}

async function deleteTunnel(): Promise<void> {
  if (!deleteTunnelTarget.value) return;
  deleteTunnelBusy.value = true;
  try { const name = deleteTunnelTarget.value.name; await apiClient.deleteTunnel(deleteTunnelTarget.value.id); deleteTunnelTarget.value = null; await loadTunnels(); notify(`Tunnel「${name}」已删除`, "success"); }
  catch (error) { notify(messageFor(error, "删除 Tunnel 失败"), "error"); }
  finally { deleteTunnelBusy.value = false; }
}

async function switchTunnel(): Promise<void> {
  if (!selectedTunnelId.value || selectedTunnelId.value === setup.value?.tunnelId) return;
  tunnelSwitchBusy.value = true;
  try {
    const result = await apiClient.switchTunnel(selectedTunnelId.value);
    setConnector(result.connector); tunnelDialogOpen.value = false;
    await refresh();
    await loadTunnels(true);
    if (result.connectorError) notify(`已切换到 ${result.tunnel.name}，但 Connector 启动失败：${result.connectorError}`, "error", 9000);
    else notify(`已切换到 ${result.tunnel.name}，同步 ${result.sync.imported} 条映射`, "success", 7000);
  } catch (error) { notify(messageFor(error, "切换 Tunnel 失败"), "error"); }
  finally { tunnelSwitchBusy.value = false; }
}

onMounted(() => { void loadTunnels(); tunnelRefreshTimer = window.setInterval(() => void loadTunnels(true), 10_000); });
onBeforeUnmount(() => { if (tunnelRefreshTimer) clearInterval(tunnelRefreshTimer); });
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
            <div><label class="label" for="settings-api-token">API Token</label><div class="relative"><input id="settings-api-token" v-model.trim="apiToken" class="field pr-16 font-mono" :type="apiTokenVisible ? 'text' : 'password'" autocomplete="off" autocapitalize="none" spellcheck="false" required><button class="absolute inset-y-0 right-0 px-3 text-xs font-medium text-primary hover:text-primary-hover" type="button" :aria-label="apiTokenVisible ? '隐藏 API Token' : '显示 API Token'" :aria-pressed="apiTokenVisible" @click="apiTokenVisible = !apiTokenVisible">{{ apiTokenVisible ? "隐藏" : "显示" }}</button></div></div>
          </div>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/[.06] pt-4">
            <div class="flex min-w-0 items-center gap-3"><StatusBadge :status="setup?.tokenConfigured ? 'running' : 'stopped'" :label="setup?.tokenConfigured ? 'Token 已配置' : 'Token 未配置'" /><span class="truncate text-[11px] text-muted" :title="setup?.tunnelId || undefined">Tunnel · {{ setup?.tunnelName || setup?.tunnelId || "未设置" }}</span></div>
            <button class="btn-primary" type="submit" :disabled="tokenBusy"><span v-if="tokenBusy" class="spinner" aria-hidden="true" />{{ tokenBusy ? "正在更新" : "保存 Cloudflare 配置" }}</button>
          </div>
        </form>
      </section>

      <section class="card overflow-hidden">
        <header class="flex flex-wrap items-center justify-between gap-3 border-b border-black/[.07] px-5 py-4">
          <div><h2 class="text-[14px] font-semibold">Tunnel 管理</h2><p class="mt-1 text-[11px] leading-5 text-muted">创建、切换和删除当前 Account 下的 remotely-managed Tunnel。</p></div>
          <div class="flex gap-2"><button class="btn-secondary" type="button" :disabled="tunnelsLoading || tunnelSwitchBusy || deleteTunnelBusy" @click="loadTunnels()"><span v-if="tunnelsLoading" class="spinner" />刷新</button><button class="btn-primary" type="button" :disabled="tunnelSwitchBusy || deleteTunnelBusy" @click="createTunnelName=''; createTunnelOpen=true">新增 Tunnel</button></div>
        </header>
        <div v-if="tunnelsLoading && !tunnels.length" class="grid h-28 place-items-center text-xs text-muted"><span class="flex items-center gap-2"><span class="spinner" />正在加载 Tunnel</span></div>
        <div v-else-if="!tunnels.length" class="px-5 py-8 text-center text-xs text-muted">当前 Account 下没有 remotely-managed Tunnel。</div>
        <ul v-else class="divide-y divide-black/[.06]">
          <li v-for="tunnel in sortedTunnels" :key="tunnel.id" class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><span class="truncate text-[13px] font-medium">{{ tunnel.name }}</span><span v-if="tunnel.id === setup?.tunnelId" class="rounded-full bg-primary/[.1] px-2 py-0.5 text-[10px] font-medium text-primary">当前使用</span><span v-else class="rounded-full bg-black/[.05] px-2 py-0.5 text-[10px] text-muted">未使用</span></div><p class="mt-1 truncate font-mono text-[10px] text-muted" :title="tunnel.id">{{ tunnel.id }}</p></div>
            <div class="flex items-center gap-4"><span class="flex items-center gap-1.5 text-[11px] text-muted"><span class="h-2 w-2 rounded-full" :class="tunnelStatus(tunnel).dot" />{{ tunnelStatus(tunnel).label }}</span><div class="flex gap-2"><button class="btn-secondary" type="button" :disabled="tunnel.id === setup?.tunnelId || tunnelSwitchBusy || deleteTunnelBusy" @click="selectedTunnelId=tunnel.id; tunnelDialogOpen=true">切换</button><button class="h-9 rounded-md px-3 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40" type="button" :disabled="tunnel.id === setup?.tunnelId || tunnelSwitchBusy || deleteTunnelBusy" @click="deleteTunnelTarget=tunnel">删除</button></div></div>
          </li>
        </ul>
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
  <FormDialog :open="createTunnelOpen" title="新增 Tunnel" description="创建 remotely-managed Tunnel。创建后不会自动切换。" submit-label="创建 Tunnel" :busy="createTunnelBusy" :submit-disabled="!createTunnelName.trim()" @close="createTunnelOpen=false; createTunnelName=''" @submit="createTunnel">
    <label class="label" for="new-tunnel-name">Tunnel 名称</label><input id="new-tunnel-name" v-model.trim="createTunnelName" class="field" minlength="1" maxlength="100" pattern="[A-Za-z0-9_. -]+" autocomplete="off" required><p class="mt-2 text-[10px] text-muted">支持字母、数字、空格、点、下划线和短横线。</p>
  </FormDialog>
  <FormDialog :open="tunnelDialogOpen" title="切换 Tunnel" description="将停止当前 Connector，同步新 Tunnel 的远端 Ingress，并替换本地映射列表。旧 Tunnel、Ingress 和 DNS 不会被修改。" submit-label="确认切换" :busy="tunnelSwitchBusy" :submit-disabled="tunnelSwitchDisabled" @close="tunnelDialogOpen=false" @submit="switchTunnel">
    <label class="label">目标 Tunnel</label>
    <div v-if="tunnelsLoading" class="grid h-20 place-items-center text-xs text-muted"><span class="flex items-center gap-2"><span class="spinner" />正在加载 Tunnel</span></div>
    <SelectMenu v-else v-model="selectedTunnelId" :options="tunnelOptions" searchable search-placeholder="搜索 Tunnel" aria-label="目标 Tunnel" />
    <p v-if="selectedTunnelId === setup?.tunnelId" class="mt-2 text-xs text-amber-700">所选 Tunnel 已是当前 Tunnel，请选择其他 Tunnel。</p>
    <p v-else-if="!tunnelsLoading && !tunnelOptions.length" class="mt-2 text-xs text-muted">当前 Account 下没有可切换的 remotely-managed Tunnel。</p>
  </FormDialog>
  <ConfirmDialog :open="!!deleteTunnelTarget" title="删除 Tunnel？" :description="`确定删除 Tunnel「${deleteTunnelTarget?.name || ''}」吗？该操作会永久删除 Cloudflare 上的 Tunnel，并中断其所有连接。关联 DNS 记录不会自动删除。此操作不可撤销。`" confirm-label="确认删除" :busy="deleteTunnelBusy" @cancel="deleteTunnelTarget=null" @confirm="deleteTunnel" />
</template>
