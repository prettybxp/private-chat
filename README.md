# 私人聊天室

本机部署的单房间 Web 聊天室：访客昵称 + Cookie、WebSocket 实时文字、JSON 持久化聊天记录、管理后台与用户档案。

## 功能

- 进房填写昵称，刷新后 Cookie 自动恢复身份
- 固定单房间，文字、10MB 以内的图片和文件（都经 WebSocket 上传，避免被公司网关拦截）
- 房间内实时显示最近 **100** 条；**全量记录**写入 `data/messages.jsonl`
- 服务重启后从文件恢复最近 100 条到聊天窗
- 左侧聊天、右侧成员列表：**在线** / **离开**（页面无操作 2 分钟）/ **挂机**（插件）
- 聊天标签在后台时收到新消息：标题闪动、图标变红
- **Chrome 插件**（Windows）：关掉聊天页后仍可后台收新消息通知（不依赖谷歌推送）
- **管理后台** `/admin/`：查看聊天记录与用户档案，可一键清空记录、删除用户（需密码）
- 进房时采集客户端信息（IP、浏览器、屏幕、WebRTC 本机 IP 等）

## 环境要求

- **Node.js 18+**（推荐 20+）

## 安装与运行

```bash
cd /home/chat
npm install
npm run build
```

### 生产模式

```bash
npm start
# 或
./start.sh
```

管理后台默认密码为 **baofish**（可通过 `export ADMIN_PASSWORD=新密码` 覆盖）。

| 地址 | 说明 |
|------|------|
| http://127.0.0.1:8088 | 聊天页 |
| http://127.0.0.1:8088/admin/ | 管理后台 |
| http://127.0.0.1:8088/private-chat-extension.zip | Chrome 插件压缩包 |
| http://你的本机IP:8088 | 局域网聊天 |

`./stop.sh` 停止后台服务。

### 开发模式

```bash
npm run dev
```

- 聊天：<http://127.0.0.1:5173>
- 后台：<http://127.0.0.1:5173/admin/>

## 配置

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | HTTP + WebSocket 端口 | `8088` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `ADMIN_PASSWORD` | 管理后台登录密码 | `baofish` |
| `ADMIN_SECRET` | Cookie 签名密钥（可选） | 同 password |
| `DATA_DIR` | 数据目录 | `./data` |
| `NODE_ENV` | `production` 时托管静态页 | `npm start` / `start.sh` |

## 数据文件

```
data/
├── messages.jsonl   # 全量聊天（一行一条 JSON）
└── users.json       # 用户档案（含 clientInfo）
```

定期备份 `data/` 目录。Docker 部署时若 `remoteIp` 为 `172.17.x.x`，是容器网关 IP，需配置端口映射或 host 网络才能看到真实局域网 IP。

## 用户信息说明

- **连接 IP**（`remoteIp`）：服务端看到的对端地址，局域网访问时多为 `192.168.x.x`
- **本机 IP（探测）**（`localIps`）：浏览器 WebRTC 尽力获取，可能为空
- **主机名提示**（`hostHint`）：反向 DNS，通常**不是** Windows/Mac 计算机名

采集信息仅供私人房间管理，请勿在公网未告知访客的情况下使用。

## Chrome 插件（Windows 后台通知）

关掉聊天页后，只要 **Chrome 还在运行**，插件会与服务器保持 WebSocket，收到别人的消息时弹出 Windows 通知。成员列表中该用户显示为 **挂机**（黄点）；重新打开聊天页则变为 **在线**（绿点）。

这是直连你的服务器，**不走 Google FCM**，大陆网络可用。彻底退出 Chrome 后通知会停止。

### 安装

压缩包：仓库根目录 `private-chat-extension.zip`，或在线下载 [https://chat.ifbao.cn:6008/private-chat-extension.zip](https://chat.ifbao.cn:6008/private-chat-extension.zip)。重新打包：`npm run pack:extension`。

1. 先在网页打开一次聊天室并填写昵称（写入 Cookie）。
2. 下载 zip，解压到任意本地文件夹。
3. Chrome 打开 `chrome://extensions/`，打开右上角 **开发者模式**。
4. **加载已解压的扩展程序**，选择解压后的文件夹（里面直接是 `manifest.json`）。
5. 点击工具栏图标，确认「后台听消息」已开启；默认服务器为 `https://chat.ifbao.cn:6008`。若地址不同，改完点「保存地址」。
6. 首次使用时允许系统通知。

聊天页处于前台时，插件不会重复弹通知。图标角标为未读条数，点通知会回到聊天页。

## 限制

- 每人每秒最多 5 条消息
- 管理后台无 HTTPS，请仅在可信局域网使用
- 插件仅覆盖 Windows Chrome；手机 / 关尽浏览器后无法通知
