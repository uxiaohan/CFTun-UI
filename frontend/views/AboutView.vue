<script setup lang="ts">
const features = [
  { mark: "01", title: "映射管理", description: "统一创建和维护 Tunnel Ingress 与 Cloudflare DNS 记录。" },
  { mark: "02", title: "连接控制", description: "查看 Connector 状态、日志，并按需控制 cloudflared 生命周期。" },
  { mark: "03", title: "远端同步", description: "以 Cloudflare Tunnel 配置为来源，同步 HTTP/HTTPS 规则并保留其他协议。" },
  { mark: "04", title: "轻量部署", description: "以 Bun 驱动前后端，提供紧凑、清晰的自托管体验。" },
];
const links = [
  { label: "作者博客", href: "https://vvhan.com" },
  { label: "作者 GitHub", href: "https://github.com/uxiaohan" },
  { label: "项目仓库", href: "https://github.com/uxiaohan/CFTun-UI" },
  { label: "Issues", href: "https://github.com/uxiaohan/CFTun-UI/issues" },
];
</script>

<template>
  <section class="mx-auto max-w-5xl">
    <div class="about-hero relative overflow-hidden rounded-2xl border border-primary/15 bg-white px-5 py-9 shadow-[0_18px_55px_rgba(44,49,92,.09)] sm:px-9 sm:py-12">
      <div class="relative z-10 max-w-2xl">
        <p class="eyebrow text-primary">About the project</p>
        <div class="mt-4 flex items-center gap-4"><span class="grid h-12 w-12 place-items-center rounded-xl bg-primary text-sm font-semibold text-white shadow-[0_10px_26px_rgba(94,106,210,.28)]">CF</span><h1 class="text-3xl font-semibold tracking-[-.045em] sm:text-4xl">CFTun-UI</h1></div>
        <p class="mt-5 max-w-xl text-[14px] leading-7 text-muted">一个专注于 Cloudflare Tunnel 的自托管管理界面，让服务映射、Connector 运行状态与实例配置保持简单、清晰且可控。</p>
        <div class="mt-6 flex flex-wrap gap-2"><span v-for="item in ['Vue 3', 'TypeScript', 'Bun', 'Cloudflare API', 'SQLite']" :key="item" class="badge bg-primary/[.045] text-primary">{{ item }}</span></div>
      </div>
    </div>

    <section class="mt-5 grid gap-3 sm:grid-cols-2" aria-labelledby="features-title">
      <h2 id="features-title" class="sr-only">项目特性</h2>
      <article v-for="feature in features" :key="feature.title" class="card group p-5 transition duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-[0_10px_30px_rgba(44,49,92,.08)]">
        <div class="flex items-start gap-4"><span class="font-mono text-[10px] font-semibold tracking-wider text-primary/70">{{ feature.mark }}</span><div><h3 class="text-[14px] font-semibold">{{ feature.title }}</h3><p class="mt-2 text-xs leading-5 text-muted">{{ feature.description }}</p></div></div>
      </article>
    </section>

    <section class="mt-5 grid gap-4 lg:grid-cols-2">
      <article class="card p-5 sm:p-6"><p class="eyebrow">Author</p><h2 class="mt-3 text-lg font-semibold tracking-[-.025em]">Vvhan</h2><p class="mt-3 text-xs leading-6 text-muted">持续创作实用工具、自动化服务与开源项目，希望用克制的设计和可靠的实现，让复杂能力更容易被每个人使用。</p><div class="mt-5 flex flex-wrap gap-2"><a class="btn-primary" href="https://vvhan.com" target="_blank" rel="noreferrer">访问作者博客 ↗</a><a class="btn-secondary" href="https://github.com/uxiaohan" target="_blank" rel="noreferrer">作者 GitHub ↗</a></div></article>
      <article class="card p-5 sm:p-6"><p class="eyebrow">Open source</p><h2 class="mt-3 text-lg font-semibold tracking-[-.025em]">一起完善 CFTun-UI</h2><p class="mt-3 text-xs leading-6 text-muted">CFTun-UI 是一个持续演进的开源项目。欢迎查看源码、提交 Issue、分享使用反馈，或通过 Pull Request 让项目变得更好。</p><div class="mt-5 flex flex-wrap gap-2"><a class="btn-primary" href="https://github.com/uxiaohan/CFTun-UI" target="_blank" rel="noreferrer">查看项目仓库 ↗</a><a class="btn-secondary" href="https://github.com/uxiaohan/CFTun-UI/issues" target="_blank" rel="noreferrer">提交 Issue ↗</a></div></article>
    </section>
    <section class="card mt-5 overflow-hidden"><header class="border-b border-black/[.07] px-5 py-4"><h2 class="text-[14px] font-semibold">相关链接</h2><p class="mt-1 text-[11px] text-muted">项目、作者与反馈入口。</p></header><div class="grid sm:grid-cols-2"><a v-for="(link, index) in links" :key="link.href" :href="link.href" target="_blank" rel="noreferrer" class="group flex items-center justify-between border-black/[.06] px-5 py-4 text-[13px] font-medium transition hover:bg-primary/[.035] hover:text-primary" :class="[index < 3 ? 'border-b' : '', index % 2 === 0 ? 'sm:border-r' : '', index === 2 ? 'sm:border-b-0' : '']">{{ link.label }}<span class="text-muted transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true">↗</span></a></div></section>
    <p class="mt-6 text-center text-[10px] uppercase tracking-[.16em] text-muted">Built for focused tunnel operations</p>
  </section>
</template>

<style scoped>
.about-hero::after { content:"";position:absolute;right:-8%;top:-55%;width:420px;height:420px;border-radius:999px;background:radial-gradient(circle,rgba(94,106,210,.15),rgba(94,106,210,0) 68%);pointer-events:none; }
.about-hero::before { content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(94,106,210,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(94,106,210,.035) 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(to right,transparent,black);pointer-events:none; }
</style>
