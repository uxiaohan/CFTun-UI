# CFTun-UI

> A compact Cloudflare Tunnel console for NAS & homelab. 🚇

基于 **Bun + Vue 3** 的 Cloudflare Tunnel 管理面板：同步远端 Ingress、维护 DNS，并独立控制 `cloudflared` 生命周期。

`Bun` · `Vue 3` · `TypeScript` · `SQLite` · `Distroless` · `AMD64 / ARM64`

```bash
docker run -d \
  --name cftun-ui \
  --network host \
  --restart always \
  --stop-timeout 20 \
  -v cftun-data:/data \
  uxiaohan/cftun-ui:latest
```

```bash
docker pull uxiaohan/cftun-ui:latest
docker compose up -d
```

控制台：<http://127.0.0.1:6611>

## ⚡ Features

| 能力                | 状态     |
| ----------------- | ------ |
| 远程托管 Tunnel       | ✅      |
| HTTP / HTTPS 映射   | ✅      |
| 多 Zone 管理         | ✅      |
| DNS CNAME         | 自动维护   |
| 远端 Ingress 同步     | ✅      |
| 根域名 / 左侧通配符       | ✅      |
| HTTPS 自签名 Origin  | ✅      |
| Connector 启停 / 重启 | ✅      |
| QUIC / HTTP/2     | ✅      |
| IPv4 / IPv6 Edge  | ✅      |
| 实时日志              | SSE    |
| 本地认证与持久化          | SQLite |

## 🧬 Architecture

```text
Docker Host Network
└── cloudflare/cloudflared:2026.7.3 (Distroless)
    └── Bun (PID 1)
        ├── Vue SPA
        ├── Cloudflare API
        ├── SQLite
        └── cloudflared subprocess
            ├── 127.0.0.1:PORT
            └── LAN_IP:PORT
```

<br />

## 🔑 API Token

在 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 创建自定义 Token：

| 资源 | 权限                | 级别 |
| -- | ----------------- | -- |
| 账户 | Cloudflare Tunnel | 编辑 |
| 账户 | Cloudflare Tunnel | 读取 |
| 区域 | DNS               | 编辑 |
| 区域 | DNS               | 读取 |
| 区域 | 区域                | 读取 |

## 🐳 Deploy

```bash
docker compose up -d --build
docker compose logs -f cftun-ui
```

项目固定使用 `network_mode: host`，不映射端口：

- Linux：原生支持。
- macOS / Windows：Docker Desktop 4.34+，启用 `Resources → Network → Host networking`。

数据卷与数据库：

```text
cftun-data
└── /data/cftun-ui.sqlite
```

<br />

## 🧭 Mapping

```text
nas.example.com  →  https://192.168.1.20:5001
app.example.com  →  http://127.0.0.1:3000
```

子域名语法：

| 输入       | 结果                   |
| -------- | -------------------- |
| `nas`    | `nas.example.com`    |
| `@`      | `example.com`        |
| `*`      | `*.example.com`      |
| `*.home` | `*.home.example.com` |

选择已有 Tunnel 后，CFTun-UI 会同步全部可管理的 HTTP/HTTPS 规则并关联对应 Zone 的 DNS。

## 🛠 Development

无缓存构建：

```bash
docker buildx build --no-cache --pull --load -t cftun-ui:latest .
```

## 📚 Docs

- [`TUN-API.md`](./TUN-API.md) — Cloudflare Tunnel / DNS / API
- [`开发方案.md`](./开发方案.md) — 架构与实现约束


## ☕ 捐赠支持

如果这个项目对你有帮助，欢迎请我喝杯咖啡～

![打赏](better.png)

> 感谢每一位 Sponsor，你的支持是我持续维护的动力 💪

---