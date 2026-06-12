# EchoLink

> ゲーミング向けリアルタイムボイスチャットシステム — セルフホスト、低遅延、マルチプラットフォーム

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![.NET](https://img.shields.io/badge/.NET-8.0-purple.svg)](https://dotnet.microsoft.com/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)

**[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja-JP.md)**

---

## 🎯 プロジェクト概要

EchoLink はゲーミングシーン向けのリアルタイムボイスチャットシステムです。マルチユーザールーム、マイクON/OFF、メンバーリスト、音声アクティビティ検出（VAD）などの機能をサポートしています。

- 🏠 **セルフホスト**：国内サーバーにデプロイ可能、商用RTCクラウドサービスに依存しない
- ⚡ **低遅延**：mediasoup SFU アーキテクチャベース、エンドツーエンド遅延 < 100ms
- 🎮 **マルチプラットフォーム**：Webブラウザ + Windowsデスクトップクライアント
- 🔊 **高音質**：Opusコーデック、48kHzサンプリングレート、FEC前方誤り訂正対応
- 🛡️ **弱い回線対応**：STUN/TURN貫通をサポート、NAT環境でも安定接続

---

## 🏗️ 技術アーキテクチャ

| レイヤー | 技術スタック | 説明 |
|----------|-------------|------|
| メディアサーバー (SFU) | **mediasoup** (Node.js + TypeScript) | 音声ストリームの転送とルーティング |
| シグナリングサーバー | **Node.js + TypeScript + ws** | WebSocketシグナリングプロトコル |
| NAT貫通 | **coturn** (STUN/TURN) | 弱い回線環境での接続保障 |
| Webクライアント | **React + TypeScript + mediasoup-client** | ブラウザ側の検証とテスト |
| Windowsクライアント | **C# + .NET 8 + WPF + NAudio** | 主要なデスクトップクライアント |
| 音声コーデック | **Opus** (FEC有効) | 弱い回線での前方誤り訂正 |
| デプロイ | **Docker / docker-compose** | サーバーのコンテナ化 |

---

## 📁 リポジトリ構造

```
EchoLink/
├── server/          # mediasoup SFU + WebSocket シグナリングサーバー
│   ├── src/
│   │   ├── index.ts          # エントリ：HTTP + WebSocket + mediasoup Worker
│   │   ├── signaling.ts      # シグナリングメッセージ処理
│   │   ├── room.ts           # ルーム管理
│   │   ├── peer.ts           # ピア状態
│   │   ├── config.ts         # サーバー設定
│   │   ├── db.ts             # SQLite ユーザー永続化
│   │   ├── auth.ts           # JWT 認証
│   │   └── mediasoupWorker.ts # Worker / Router 初期化
│   └── package.json
├── web/             # React テストクライアント
│   ├── src/
│   │   ├── components/
│   │   │   ├── Room.tsx      # ルームUI
│   │   │   ├── RoomList.tsx  # ルーム一覧
│   │   │   ├── Login.tsx     # ログインページ
│   │   │   └── Register.tsx  # 登録ページ
│   │   ├── hooks/
│   │   │   ├── useMediasoup.ts # mediasoup ロジックカプセル化
│   │   │   └── useAuth.ts    # 認証状態管理
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── package.json
├── windows/         # C# WPF デスクトップクライアント
│   └── VoiceChat/
│       ├── MainWindow.xaml     # UIレイアウト
│       ├── MainWindow.xaml.cs  # ビジネスロジック
│       ├── LoginWindow.xaml    # ログインUI
│       ├── LoginWindow.xaml.cs # 接続 + 認証ロジック
│       ├── RoomsWindow.xaml    # ルーム一覧UI
│       ├── RoomsWindow.xaml.cs # ルーム一覧ロジック
│       ├── AuthService.cs      # HTTP 認証 / ルーム一覧サービス
│       └── VoiceChat.csproj
├── docker-compose.yml
└── README.md
```

---

## 🚀 クイックスタート

### 環境要件

- Node.js 18+
- .NET 8 SDK
- Docker（オプション、デプロイ用）

### 1. サーバーの起動

```bash
cd server
npm install
npm run dev          # 開発モード（ts-node）
# または
npm run build      # コンパイル
npm start          # 本番モード
```

サーバーはデフォルトで `ws://localhost:1985` をリッスンします。

### 2. Webクライアントの起動

```bash
cd web
npm install
npm run dev        # Vite開発サーバー、デフォルト http://localhost:5173
```

2つのブラウザタブを開き、同じルームに入って双方向音声をテストしてください。

### 3. Windowsクライアントの起動

```bash
cd windows
dotnet restore
dotnet build
dotnet run --project VoiceChat
```

---

## 📡 シグナリングプロトコル

JSONベースのWebSocketシグナリングプロトコル、主要なメッセージタイプ：

| メッセージタイプ | 方向 | 説明 |
|------------------|------|------|
| `joinRoom` | C→S | ルームに参加 |
| `joinedRoom` | S→C | 参加成功、RTP能力を返す |
| `createTransport` | C→S | WebRTC Transport を作成 |
| `transportCreated` | S→C | Transport 作成成功 |
| `connectTransport` | C→S | DTLSハンドシェイクを完了 |
| `transportConnected` | S→C | 接続成功 |
| `produce` | C→S | 音声送信を開始 |
| `produced` | S→C | Producer 作成成功 |
| `consume` | C→S | 他ユーザーの音声を受信するリクエスト |
| `consumed` | S→C | Consumer 作成成功 |
| `resumeConsuming` | C→S | 音声受信を再開 |
| `newProducer` | S→C (ブロードキャスト) | 新規ユーザーがマイクON |
| `producerClosed` | S→C (ブロードキャスト) | ユーザーがマイクOFF |
| `peerJoined` / `peerLeft` | S→C (ブロードキャスト) | ユーザーの入退室 |
| `authenticate` | C→S | オプションの JWT 認証 |
| `authenticated` | S→C | 認証成功 |
| `listRooms` | C→S | オンラインルーム一覧をリクエスト |
| `roomsList` | S→C | オンラインルーム一覧の応答 |

**重要な順序**：Transport を作成 → Transport を接続 → 生産/消費。`connectTransport` をスキップすると静かに失敗します。

### REST API

| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/auth/register` | 新規アカウント登録 |
| POST | `/api/auth/login` | ログインして JWT を取得 |
| GET | `/api/rooms` | オンラインルーム一覧 |

---

## 🎛️ 音声設定

- **コーデック**：Opus
- **サンプリングレート**：48,000 Hz
- **チャンネル**：2（ステレオ）
- **FEC**：有効 (`useinbandfec=1`)
- **フレームサイズ**：20ms (960 サンプル)
- **ビットレート**：64 kbps

---

## 🐳 Dockerデプロイ

```bash
docker-compose up -d
```

注：`docker-compose.yml` は SQLite データベースを永続化するために `./data` を server コンテナにマウントします。本番環境では `.env` で強力な `JWT_SECRET` を設定してください。

---

## 📝 開発規約

1. mediasoup API は公式ドキュメントに厳密に従う必要があります。メソッド名やパラメータを推測しないでください
2. transport/producer/consumer ロジックを実装する前に、完全な協議フローを説明するコメントを先に書いてください
3. クライアントコードにキーや認証情報をハードコードしないでください。サーバー設定または環境変数を使用してください
4. 各モジュールの実装後、ローカル実行/検証コマンドを提供してください
5. 現在のステップに集中してください。将来のステップのコードを早まって生成しないでください

---

## 📄 ライセンス

[MIT](LICENSE)

---

## 🤝 貢献

Issue と PR を歓迎します！

- バグ報告時はブラウザのConsoleログとサーバーログを添付してください
- 機能リクエスト時は具体的な使用シーンを説明してください

---

*Made with ❤️ for gamers.*
