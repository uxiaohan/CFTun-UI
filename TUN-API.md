# Cloudflare Tunnel 与 Access 命令/API 手册

> 核对日期：2026-08-06。本文以 Cloudflare 官方文档和 API v4 为准，示例中的 ID、域名、Token、邮箱均为占位符。

## 1. 目标与概念

Cloudflare Tunnel 通过本机运行的 `cloudflared` 主动向 Cloudflare 边缘建立出站连接，把公网 hostname 转发到本机或内网服务。无需公网 IP，也无需在路由器或防火墙开放入站端口。

```text
https://app.example.com
        |
        v
Cloudflare DNS / Edge / Access
        |
        v
<TUNNEL_ID>.cfargotunnel.com
        |
        v
cloudflared -> http://localhost:3000
```

关键对象：

| 对象 | 作用 |
| --- | --- |
| Zone | Cloudflare 托管的根域名，例如 `example.com` |
| Tunnel | Cloudflare 边缘与 origin 之间的出站隧道，每个 Tunnel 有 UUID |
| Connector | 运行 Tunnel 的 `cloudflared` 进程 |
| Ingress | `hostname/path -> 本地 service` 的映射规则 |
| DNS record | 将公网 hostname CNAME 到 `<TUNNEL_ID>.cfargotunnel.com` |
| Access application | 保护一个已经发布的 hostname/path |
| Access policy | 决定哪些身份、邮箱、组、IP 或 Service Token 可以访问 |

一个可访问的公网映射通常需要同时具备：

1. Tunnel ingress：`app.example.com -> http://localhost:3000`
2. DNS CNAME：`app.example.com -> <TUNNEL_ID>.cfargotunnel.com`
3. 可选的 Access application + policy：访问前进行身份验证和授权

重要：Cloudflare Access **不负责获取域名列表，也不负责建立端口映射**。域名来自 Zones API；映射由 Tunnel Configuration API 和 DNS Records API 完成；Access 是其上的访问保护层。

## 2. 管理模式

### 2.1 远程托管 Tunnel（推荐用于 UI/API）

- `config_src` 为 `cloudflare`。
- ingress 配置保存在 Cloudflare。
- 可通过 Dashboard 或 API 管理。
- Connector 使用 Tunnel token 启动。
- 适合本项目这类图形化管理工具。

### 2.2 本地托管 Tunnel

- `config_src` 为 `local`。
- ingress 配置保存在 origin 的 `config.yml`。
- 使用 `cert.pem` 创建/路由 Tunnel，使用 `<TUNNEL_ID>.json` 运行 Tunnel。
- 远程 Configuration API 不能代替本地 YAML 配置。

### 2.3 Quick Tunnel

- 无需 Cloudflare 账户和自有域名。
- 自动生成随机 `trycloudflare.com` 地址。
- 仅适合开发测试，无 SLA，不应作为生产方案。

## 3. 安装与升级 `cloudflared`

官方发布页：<https://github.com/cloudflare/cloudflared/releases/latest>

### macOS

```bash
brew install cloudflared
brew upgrade cloudflared
```

### Windows

```powershell
winget install --id Cloudflare.cloudflared
winget upgrade --id Cloudflare.cloudflared
```

也可从官方 Releases 下载 `.exe` 或 `.msi`。

### Debian/Ubuntu

按官方 Package Repository 配置软件源后：

```bash
sudo apt-get update
sudo apt-get install cloudflared
```

### Docker

```bash
docker pull cloudflare/cloudflared:latest
```

### 检查与更新

```bash
cloudflared --version
cloudflared update
cloudflared tunnel help
```

Cloudflare 官方说明仅支持距最新版本一年以内的 `cloudflared` 版本，生产环境应定期升级。

## 4. Quick Tunnel 命令

将本机 `8080` 暂时发布到随机公网地址：

```bash
cloudflared tunnel --url http://localhost:8080
```

也可指定其他服务：

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

进程启动后终端会输出类似：

```text
https://random-words.trycloudflare.com
```

限制：随机域名、无 SLA、只适合测试；达到 Quick Tunnel 限制时可能返回 HTTP `429`。

## 5. 本地托管 Named Tunnel

### 5.1 登录并创建 Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create my-tunnel
cloudflared tunnel list
```

`login` 会打开浏览器授权并生成 `cert.pem`。`create` 会生成 Tunnel UUID、`<TUNNEL_ID>.cfargotunnel.com` 子域名和 `<TUNNEL_ID>.json` 凭据文件。

### 5.2 `config.yml` 示例

```yaml
tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef
credentials-file: /Users/me/.cloudflared/6ff42ae2-765d-4adf-8112-31c55c1551ef.json

ingress:
  - hostname: app.example.com
    service: http://localhost:3000

  - hostname: api.example.com
    path: ^/v1/.*
    service: http://localhost:8080

  - hostname: ssh.example.com
    service: ssh://localhost:22

  - service: http_status:404
```

规则从上到下匹配，最后必须有不带 `hostname` 的 catch-all 规则。常用 service：

```text
http://localhost:3000
https://localhost:8443
tcp://localhost:5432
ssh://localhost:22
rdp://localhost:3389
unix:/path/to/socket
unix+tls:/path/to/socket
smb://localhost:445
http_status:404
hello_world
```

通配符只支持 hostname 左侧，例如 `*.example.com`；不支持 `test.*.example.com`。path 使用 Go 正则语法。

### 5.3 验证、创建 DNS 并运行

```bash
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://app.example.com
cloudflared tunnel route dns my-tunnel app.example.com
cloudflared tunnel --config /path/to/config.yml run my-tunnel
cloudflared tunnel info my-tunnel
```

`route dns` 创建指向 `<TUNNEL_ID>.cfargotunnel.com` 的 CNAME，但不会自动启动 Tunnel。Tunnel 停止后 DNS 不会删除，访问者通常看到错误 `1016`。

### 5.4 常用维护命令

```bash
cloudflared tunnel list
cloudflared tunnel info <NAME_OR_UUID>
cloudflared tunnel cleanup <NAME_OR_UUID>
cloudflared tunnel cleanup --connector-id <CONNECTOR_ID> <NAME_OR_UUID>
cloudflared tunnel delete <NAME_OR_UUID>
cloudflared tunnel delete -f <NAME_OR_UUID>
cloudflared tail <TUNNEL_UUID>
```

删除 Tunnel 前不能存在活动连接。`-f` 是强制删除，应谨慎使用。

## 6. 远程托管 Tunnel 的运行命令

从 Dashboard 或 API 获得 Tunnel token 后：

```bash
cloudflared tunnel run --token "$TUNNEL_TOKEN"
```

Docker：

```bash
docker run --rm cloudflare/cloudflared:latest \
  tunnel --no-autoupdate run --token "$TUNNEL_TOKEN"
```

安装成系统服务：

```bash
sudo cloudflared service install "$TUNNEL_TOKEN"
sudo systemctl status cloudflared
```

Windows 需在管理员终端运行官方 Dashboard 提供的 service install 命令。Tunnel token 是运行凭据，应按 Secret 管理，不应写入仓库、日志或返回给浏览器前端。

## 7. Cloudflare API 通用约定

API Base URL：

```text
https://api.cloudflare.com/client/v4
```

推荐使用 API Token：

```bash
export CLOUDFLARE_API_TOKEN='<API_TOKEN>'
export ACCOUNT_ID='<ACCOUNT_ID>'
export ZONE_ID='<ZONE_ID>'
export TUNNEL_ID='<TUNNEL_UUID>'
export HOSTNAME='app.example.com'
```

统一请求头：

```bash
-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
-H "Content-Type: application/json"
```

典型响应包装：

```json
{
  "success": true,
  "errors": [],
  "messages": [],
  "result": {},
  "result_info": {
    "page": 1,
    "per_page": 20,
    "count": 1,
    "total_count": 1,
    "total_pages": 1
  }
}
```

调用方必须同时检查 HTTP 状态码和 JSON 的 `success`；列表接口应读取 `result_info` 并处理分页，不能假设第一页包含全部结果。

### 7.1 建议的最小权限

按实际功能和资源范围授予：

| 功能 | API Token 权限 |
| --- | --- |
| 列出账户 | Account 相关读取权限；用户 Token 还需具备对应账户成员资格 |
| 列出 Zones | `Zone:Zone:Read` |
| 读 DNS | `Zone:DNS:Read` |
| 创建/更新/删除 DNS | `Zone:DNS:Edit` |
| 读 Tunnel | `Account:Cloudflare Tunnel:Read` |
| 创建/配置/删除 Tunnel、获取 token | `Account:Cloudflare Tunnel:Edit` |
| 读 Access 应用和策略 | `Account:Access: Apps and Policies:Read` |
| 创建/修改 Access 应用和策略 | `Account:Access: Apps and Policies:Edit` |

Cloudflare Dashboard 中权限显示名称可能随 UI 调整。应以官方“API token permissions”页面或 `GET /user/tokens/permission_groups` 返回的当前名称/ID 为准，并把 Zone 权限限制到需要管理的 Zone、Account 权限限制到目标账户。

验证 Token：

```bash
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

## 8. 获取账户和域名列表

### 8.1 获取账户列表

```http
GET /accounts
```

```bash
curl "https://api.cloudflare.com/client/v4/accounts?page=1&per_page=50" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

从 `result[].id` 取得 `ACCOUNT_ID`。

### 8.2 获取根域名（Zones）列表

```http
GET /zones
```

```bash
curl "https://api.cloudflare.com/client/v4/zones?account.id=$ACCOUNT_ID&status=active&page=1&per_page=50" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

常用结果字段：

```json
{
  "id": "<ZONE_ID>",
  "name": "example.com",
  "status": "active",
  "account": {
    "id": "<ACCOUNT_ID>",
    "name": "Example Account"
  }
}
```

这里得到的是 Cloudflare Zone 列表，不是所有可用子域名。子域名由 DNS Records API 查询或由用户在某个 Zone 下输入后创建。

### 8.3 获取某个 Zone 的现有 hostname/DNS 记录

```http
GET /zones/{zone_id}/dns_records
```

列出全部记录：

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?page=1&per_page=100" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

精确查询某个 CNAME：

```bash
curl --get "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data-urlencode "type=CNAME" \
  --data-urlencode "name.exact=$HOSTNAME" \
  --data-urlencode "match=all"
```

自动化应使用 `name.exact` 等结构化过滤参数，不应使用行为可能变化的 `search` 参数。

## 9. Tunnel API

### 9.1 列出 Tunnel

推荐的统一列表接口：

```http
GET /accounts/{account_id}/tunnels
```

```bash
curl --get "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/tunnels" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data-urlencode "is_deleted=false" \
  --data-urlencode "tun_types=cfd_tunnel"
```

结果包含 `id`、`name`、`status`、`config_src`、`connections` 等。状态可能为 `inactive`、`degraded`、`healthy` 或 `down`。

### 9.2 创建远程托管 Tunnel

```http
POST /accounts/{account_id}/cfd_tunnel
```

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel" \
  -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "desktop-services",
    "config_src": "cloudflare"
  }'
```

API Schema 也支持 `tunnel_secret`。一般 UI 管理流程可由 Cloudflare 生成/管理运行 token；若自行提供 secret，必须是至少 32 字节随机值的 Base64 表示，并作为 Secret 保存。

### 9.3 获取 Tunnel token

```http
GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/token
```

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/token" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

响应的 `result` 字符串用于：

```bash
cloudflared tunnel run --token '<result>'
```

不要把该接口直接暴露给不可信前端，也不要记录响应正文。

## 10. 获取与更新映射关系

### 10.1 获取远程 Tunnel 配置

```http
GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations
```

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

映射位于 `result.config.ingress`：

```json
[
  {
    "hostname": "app.example.com",
    "service": "http://localhost:3000"
  },
  {
    "hostname": "api.example.com",
    "path": "^/v1/.*",
    "service": "http://localhost:8080"
  },
  {
    "service": "http_status:404"
  }
]
```

### 10.2 新增或更新映射

```http
PUT /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations
```

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  -X PUT \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "config": {
      "ingress": [
        {
          "hostname": "app.example.com",
          "service": "http://localhost:3000"
        },
        {
          "hostname": "api.example.com",
          "service": "http://localhost:8080"
        },
        {
          "service": "http_status:404"
        }
      ]
    }
  }'
```

重要注意事项：

- 这是 `PUT`，按整份配置处理。新增一条映射前，应先 GET 当前配置、在内存中合并，再 PUT 完整 `config`。
- 保留未知字段和顶层 `originRequest`、`warp-routing`，否则可能意外删除已有设置。
- ingress 至少需要一条规则，并应以 catch-all 结束。
- 同 hostname 的更具体 path 规则放在更通用规则之前。
- 编辑前确认 `config_src` 为 `cloudflare`；本地托管 Tunnel 应编辑其 YAML 文件。
- 多人并发修改时，保存前重新 GET，并比较返回的 `version`；API 文档未提供通用 ETag 条件更新保证，UI 应提示冲突而非静默覆盖。

## 11. 创建 Tunnel DNS 绑定

Tunnel ingress 和 DNS 是相互独立的。配置 ingress 不会自动保证 DNS 存在；直接创建 DNS 也不会创建 ingress。

### 11.1 创建 CNAME

```http
POST /zones/{zone_id}/dns_records
```

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{
    \"type\": \"CNAME\",
    \"name\": \"$HOSTNAME\",
    \"content\": \"$TUNNEL_ID.cfargotunnel.com\",
    \"proxied\": true,
    \"ttl\": 1,
    \"comment\": \"Managed by CFTun-UI\"
  }"
```

`ttl: 1` 表示自动。Tunnel CNAME 应启用代理。`cfargotunnel.com` 目标只代理同一 Cloudflare 账户中的 DNS 记录。

### 11.2 更新已有记录

先使用精确过滤查询记录并取得 `DNS_RECORD_ID`，再完整替换：

```http
PUT /zones/{zone_id}/dns_records/{dns_record_id}
```

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$DNS_RECORD_ID" \
  -X PUT \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{
    \"type\": \"CNAME\",
    \"name\": \"$HOSTNAME\",
    \"content\": \"$TUNNEL_ID.cfargotunnel.com\",
    \"proxied\": true,
    \"ttl\": 1,
    \"comment\": \"Managed by CFTun-UI\"
  }"
```

也可使用 `PATCH` 进行局部更新。创建前必须检测同名 A/AAAA/CNAME；DNS 规则不允许 CNAME 与同名 A/AAAA 共存，不能直接覆盖用户已有的无关记录。

### 11.3 删除记录

```http
DELETE /zones/{zone_id}/dns_records/{dns_record_id}
```

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$DNS_RECORD_ID" \
  -X DELETE \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

删除映射时，应让用户明确选择是否同时删除 DNS 和 Access 应用，因为三者是独立资源。

## 12. 从 API 还原完整映射列表

仅查询 ingress 不能判断公网 DNS 是否正确，仅查询 CNAME 也不能知道本地端口。建议 UI 聚合：

1. `GET /accounts/{account_id}/tunnels` 获取 Tunnel。
2. 对远程托管 Tunnel 调用 configuration GET，展开 `config.ingress`。
3. `GET /zones/{zone_id}/dns_records?type=CNAME` 获取 Zone 内 CNAME。
4. 用 CNAME `content == <TUNNEL_ID>.cfargotunnel.com` 关联 Tunnel。
5. `GET /accounts/{account_id}/access/apps`，用 Access `domain` 或 `destinations[].uri` 关联 hostname/path。
6. 标记不完整状态：仅 ingress、仅 DNS、DNS 指向其他 Tunnel、缺少 catch-all、Access 无 Allow policy 等。

推荐的 UI 映射结构：

```json
{
  "accountId": "<ACCOUNT_ID>",
  "zoneId": "<ZONE_ID>",
  "tunnelId": "<TUNNEL_ID>",
  "tunnelName": "desktop-services",
  "hostname": "app.example.com",
  "path": null,
  "service": "http://localhost:3000",
  "dnsRecordId": "<DNS_RECORD_ID>",
  "dnsTarget": "<TUNNEL_ID>.cfargotunnel.com",
  "accessAppId": "<ACCESS_APP_ID>",
  "accessAud": "<ACCESS_AUD>"
}
```

## 13. Cloudflare Access API

Access 应用推荐使用 account-scoped 端点：

```text
/accounts/{account_id}/access/apps
```

API 也存在 zone-scoped 变体，但同一管理工具内不要混用两种 scope，否则列表和更新可能看起来“不一致”。

### 13.1 列出 Access 应用

```http
GET /accounts/{account_id}/access/apps
```

```bash
curl --get "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data-urlencode "domain=$HOSTNAME" \
  --data-urlencode "exact=true" \
  --data-urlencode "page=1" \
  --data-urlencode "per_page=50"
```

Self-hosted 应用的关键字段：`id`、`name`、`domain`、`type`、`aud`、`policies`。`aud` 是 Access audience tag，可用于 origin-side JWT 验证。

### 13.2 创建 self-hosted Access 应用

```http
POST /accounts/{account_id}/access/apps
```

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{
    \"name\": \"Protect $HOSTNAME\",
    \"type\": \"self_hosted\",
    \"domain\": \"$HOSTNAME\",
    \"session_duration\": \"24h\",
    \"app_launcher_visible\": true
  }"
```

新的 API Schema 还支持 `destinations`，例如：

```json
{
  "name": "Protect app.example.com",
  "type": "self_hosted",
  "domain": "app.example.com",
  "destinations": [
    {
      "type": "public",
      "uri": "app.example.com/admin/*"
    }
  ],
  "session_duration": "24h"
}
```

`destinations` 存在时会优先于旧式的 self-hosted domain 集合。简单单域名应用使用 `domain` 即可；需要多目标或复杂 path 时再使用 `destinations`。

### 13.3 创建应用级 Allow policy

```http
POST /accounts/{account_id}/access/apps/{app_id}/policies
```

允许指定邮箱：

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps/$ACCESS_APP_ID/policies" \
  -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Allow administrators",
    "decision": "allow",
    "precedence": 1,
    "include": [
      {
        "email": {
          "email": "admin@example.com"
        }
      }
    ],
    "exclude": [],
    "require": []
  }'
```

允许某个邮箱域：

```json
{
  "name": "Allow company",
  "decision": "allow",
  "precedence": 1,
  "include": [
    {
      "email_domain": {
        "domain": "example.com"
      }
    }
  ],
  "exclude": [],
  "require": []
}
```

自动化服务可使用 Access Service Token 规则：

```json
{
  "name": "Allow CI service token",
  "decision": "non_identity",
  "precedence": 1,
  "include": [
    {
      "service_token": {
        "token_id": "<SERVICE_TOKEN_ID>"
      }
    }
  ],
  "exclude": [],
  "require": []
}
```

Cloudflare 当前建议优先创建可复用 policy，再把 policy ID 关联到应用；应用级 exclusive policy 仍可用，适合仅保护单个映射的简单场景。不要默认创建 `everyone` Allow 规则，否则 Access 登录层可能失去预期的限制作用。

### 13.4 Access 应用更新和删除

```http
PUT    /accounts/{account_id}/access/apps/{app_id}
DELETE /accounts/{account_id}/access/apps/{app_id}
```

应用 policy：

```http
GET    /accounts/{account_id}/access/apps/{app_id}/policies
PUT    /accounts/{account_id}/access/apps/{app_id}/policies/{policy_id}
DELETE /accounts/{account_id}/access/apps/{app_id}/policies/{policy_id}
```

PUT 更新前先 GET 并保留不由当前 UI 管理的字段，例如 IdP、CORS、cookie 和 App Launcher 设置。

## 14. Access 与 Tunnel origin 校验

在边缘创建 Access application/policy 后，正常请求会由 Access 验证。为了防止绕过或误配置，还可让 `cloudflared` 对到达 origin 的 `Cf-Access-Jwt-Assertion` 做校验。

先从 Access application 的 `aud` 获取 audience tag，并确认 Zero Trust team name，然后将 ingress 配置为：

```json
{
  "hostname": "app.example.com",
  "service": "http://localhost:3000",
  "originRequest": {
    "access": {
      "required": true,
      "teamName": "my-team",
      "audTag": [
        "<ACCESS_AUD>"
      ]
    }
  }
}
```

说明：

- `required: true`：拒绝未通过 Access 授权的 L7 请求。
- `teamName`：Zero Trust organization/team 名，不是账户显示名称。
- `audTag`：允许到达该 ingress 的 Access application audience 列表。
- 该配置主要用于 HTTP/HTTPS L7 请求；非 HTTP 协议应按对应 Access/cloudflared 客户端流程设计。
- 启用前先创建好 Access app 和 Allow policy，否则可能把自己锁在应用之外。

## 15. 完整绑定流程（UI/API 推荐）

假设目标是：

```text
app.example.com -> Tunnel -> http://localhost:3000 -> Access 登录保护
```

建议流程：

1. 验证 API Token。
2. `GET /accounts` 选择账户。
3. `GET /zones?account.id=...` 选择 `example.com`。
4. `GET /accounts/{account_id}/tunnels` 选择远程托管 Tunnel，或 POST 创建。
5. GET Tunnel configuration，保留完整配置。
6. 校验 `app.example.com` 属于所选 Zone，校验 service URL 和允许的本地端口。
7. 在 catch-all 前合并 `{hostname, service}`，PUT 完整 Tunnel configuration。
8. 精确查询同名 DNS 记录。
9. 无冲突则创建 CNAME；已有本工具管理的 CNAME 则更新；存在用户的 A/AAAA/其他 CNAME 则停止并提示。
10. 创建 Access self-hosted application。
11. 创建明确的 Allow policy。
12. 重新 GET Access app，取得 `id` 和 `aud`。
13. 可选：再次 GET/PUT Tunnel config，写入 `originRequest.access`。
14. 获取 Tunnel token，并只在受信任的本机/服务端用于启动 `cloudflared`。
15. 检查 Tunnel 状态为 `healthy`，再验证公网响应。

### 15.1 失败回滚原则

这些 API 不构成跨资源事务。建议记录每一步是否创建了新资源：

- ingress PUT 成功、DNS 创建失败：恢复保存前的完整 Tunnel config，或保留并标记“缺少 DNS”等待重试。
- DNS 创建成功、Access 创建失败：不要默认删除用户已有 DNS；仅可删除本次新建且 ID 已记录的资源。
- Access app 创建成功、policy 创建失败：删除本次新建 app，或保留并明确标记“无策略，不可交付”。
- 删除映射时分别确认 ingress、DNS、Access 三类资源，不根据 hostname 猜测所有权。

### 15.2 推荐的幂等键和所有权标记

- Tunnel ingress：`tunnel_id + hostname + path`。
- DNS：`zone_id + type + name`，并用 `comment: Managed by CFTun-UI` 标记。
- Access：保存 Cloudflare 返回的 `app_id`，不要只靠名称查找。
- 本地数据库保存变更前快照或受管理字段，避免覆盖 Dashboard 中的外部修改。

## 16. 删除映射的安全顺序

推荐：

1. GET 最新 Tunnel config，删除目标 ingress，保留其他规则和 catch-all，然后 PUT。
2. 若用户确认且 DNS record ID 属于该映射，删除对应 CNAME。
3. 若用户确认且 Access app ID 属于该映射，删除 Access app/policy。
4. 若 Tunnel 已无业务 ingress，询问是否停止 Connector 或删除 Tunnel，不要自动删除。

只删除 DNS 不会停止 Tunnel；只删除 ingress 不会删除 DNS；只删除 Access 会让 hostname 失去登录保护但仍可能公开可访问。

## 17. 协议与安全注意事项

### HTTP/HTTPS

- 浏览器可直接访问，Cloudflare 边缘提供公网 HTTPS。
- origin 使用自签名 HTTPS 时，优先配置正确 CA 或 `originServerName`；不建议长期使用 `noTLSVerify: true`。
- WebSocket 可通过 HTTP/HTTPS Tunnel 使用。
- IPv6 literal 作为 service 地址时必须使用方括号，例如 `https://[2001:db8::1]:443`。

### SSH/TCP/RDP/数据库

- 非 HTTP 服务通常需要访问端也运行 `cloudflared access`、WARP/Cloudflare One Client，或使用对应客户端集成；不能假设任意公网 TCP 客户端都能直接连接 hostname:port。
- 任意 TCP 服务可在客户端建立本地监听，例如 `cloudflared access tcp --hostname db.example.com --url localhost:15432`，再让客户端程序连接 `localhost:15432`。长连接场景优先考虑 Cloudflare One Client/WARP 的 Client-to-Tunnel 方案。
- SSH 客户端常见 ProxyCommand：

```sshconfig
Host ssh.example.com
  ProxyCommand cloudflared access ssh --hostname %h
```

- 数据库和管理端口必须叠加 Access/Service Token/WARP 策略，不应匿名暴露。

### 主机与网络

- Connector 需要向 Cloudflare 出站访问端口 `7844`；受限防火墙应先做官方 connectivity pre-check。
- 一条 Tunnel 可以运行多个 replica；同一 Tunnel 的流量不保证固定落到某个 replica。
- 本机休眠、关机或 Connector 停止时 Tunnel 无法服务，DNS 仍会保留。
- 多级子域名可能不在 Universal SSL 默认覆盖范围内，例如 `a.b.example.com`，可能需要 Advanced Certificate。

### 凭据

- API Token、Tunnel token、`cert.pem`、Tunnel credentials JSON 和 Access Service Token secret 都是敏感凭据。
- 前端不得持有具备 Tunnel/DNS/Access Edit 的 Cloudflare API Token。
- 服务端对 hostname、service scheme、loopback/内网地址和端口做白名单校验，避免把映射 API 变成 SSRF 或任意内网代理。
- 日志中脱敏 `Authorization`、Tunnel token、Service Token client secret 和完整 API 响应。

## 18. 常见问题

### DNS 正确但返回 1016

常见原因：Tunnel 未运行、Tunnel ID 错误、无健康连接。检查：

```bash
cloudflared tunnel info <TUNNEL_ID>
```

并查询 Tunnel API 的 `status` 和 `connections`。

### Tunnel healthy 但返回 404

通常是 hostname/path 未匹配 ingress，落入 `http_status:404`。检查规则顺序、hostname 拼写和 path 正则。

### 返回 502

通常是 Connector 能连接 Cloudflare，但无法连接本地 service。检查本地端口、协议 `http/https`、TLS 证书和容器网络中的 `localhost` 含义。

### Access 没有生效

确认：

- Access app 的 `domain`/destination 与请求 hostname/path 一致。
- 至少存在一条匹配用户的 Allow policy。
- DNS 是 proxied Cloudflare 记录并正确指向 Tunnel。
- 没有优先级更高的 Bypass policy。
- 若启用 origin JWT 校验，`teamName` 和 `audTag` 正确。

### API 更新后其他映射消失

Tunnel Configuration 使用 PUT。调用方很可能只提交了新规则而未包含旧规则。必须采用“GET 最新配置 -> 合并 -> PUT 完整配置”。

## 19. 官方资料

Tunnel：

- Downloads：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/>
- Useful terms：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/tunnel-useful-terms/>
- Quick Tunnels：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/>
- Create remotely-managed tunnel：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/>
- Create locally-managed tunnel：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/>
- Configuration file：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/>
- Useful commands：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-useful-commands/>
- DNS records for Tunnel：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/>
- Published application protocols：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/>

API：

- List accounts：<https://developers.cloudflare.com/api/resources/accounts/methods/list/>
- List zones：<https://developers.cloudflare.com/api/resources/zones/methods/list/>
- DNS records：<https://developers.cloudflare.com/api/resources/dns/subresources/records/>
- Tunnels：<https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/>
- Tunnel configuration GET：<https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/methods/get/>
- Tunnel configuration PUT：<https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/methods/update/>
- Tunnel token：<https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/token/methods/get/>
- Access applications：<https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/>
- Create Access application：<https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/>
- Create application policy：<https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/subresources/policies/methods/create/>

鉴权与权限：

- Create API token：<https://developers.cloudflare.com/fundamentals/api/get-started/create-token/>
- API token permissions：<https://developers.cloudflare.com/fundamentals/api/reference/permissions/>

## 20. 最小接口清单

```text
GET    /user/tokens/verify
GET    /accounts
GET    /zones
GET    /zones/{zone_id}/dns_records
POST   /zones/{zone_id}/dns_records
PATCH  /zones/{zone_id}/dns_records/{dns_record_id}
PUT    /zones/{zone_id}/dns_records/{dns_record_id}
DELETE /zones/{zone_id}/dns_records/{dns_record_id}

GET    /accounts/{account_id}/tunnels
POST   /accounts/{account_id}/cfd_tunnel
GET    /accounts/{account_id}/cfd_tunnel/{tunnel_id}/token
GET    /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations
PUT    /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations

GET    /accounts/{account_id}/access/apps
POST   /accounts/{account_id}/access/apps
PUT    /accounts/{account_id}/access/apps/{app_id}
DELETE /accounts/{account_id}/access/apps/{app_id}
GET    /accounts/{account_id}/access/apps/{app_id}/policies
POST   /accounts/{account_id}/access/apps/{app_id}/policies
PUT    /accounts/{account_id}/access/apps/{app_id}/policies/{policy_id}
DELETE /accounts/{account_id}/access/apps/{app_id}/policies/{policy_id}
```
