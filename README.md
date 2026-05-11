# Realtime Translate Caption

スマホのブラウザで使うリアルタイム翻訳字幕アプリの試作です。

## できること

- スマホ/PCのマイク音声をOpenAI Realtime APIへ送信
- 話した内容を指定言語へ翻訳
- 翻訳字幕を大きく表示
- 聞き取り結果と翻訳履歴を表示
- 任意で翻訳音声も再生

## ローカルで動かす

```bash
cd /Users/show/Documents/Codex/2026-05-02/new-chat/realtime_translate
export OPENAI_API_KEY="sk-..."
npm start
```

開くURL:

```text
http://127.0.0.1:5177/
```

## スマホで使う場合

スマホのマイクは、基本的にHTTPSページでないと使えません。
Macの `http://192.168.x.x:5177/` をスマホで開くだけだと、マイク許可が出ないことがあります。

実機テストは次のどちらかが現実的です。

- Cloudflare TunnelなどでHTTPS URLを発行する
- Cloudflare Pagesにデプロイして HTTPS URL を使う（後述）

## Cloudflare Pages へのデプロイ（公開は保留中）

このプロジェクトは Cloudflare Pages + Functions で動くように構成済みです。

### 構成

- `public/` … 静的フロント（Pages がそのまま配信）
- `functions/session.js` … `POST /session`（Pages Functions）
- `functions/health.js` … `GET /health`（Pages Functions）
- `server.js` … ローカル開発専用。Pages では使われない

### Pages プロジェクト設定

| 項目 | 値 |
|---|---|
| Framework preset | None |
| Build command | （空欄） |
| Build output directory | `public` |

### 環境変数

Pages の Settings → Environment variables に登録：

- `OPENAI_API_KEY` … **Secret（暗号化）** で登録
- `OPENAI_REALTIME_MODEL` … 任意。プレーンでOK。未設定なら `gpt-realtime`

### 課金・公開の注意

- Realtime API は使った音声長に応じてOpenAI側で従量課金されます
- 公開URLは認証なしだと第三者にも使われ得るため、本番公開する場合は Cloudflare Access などで保護してください
- OpenAI ダッシュボードで予算上限（Usage limits）を設定しておくと安全

## ファイル構成

```
realtime_translate/
├── public/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── functions/
│   ├── session.js
│   └── health.js
├── server.js          # ローカル開発用
├── package.json
├── .gitignore
└── README.md
```

## 注意

- OpenAI APIキーはサーバー側だけに置きます。スマホ側のJavaScriptには入れません。
- Realtime APIの利用料金が発生します。
- 周囲の音が大きい場所では、翻訳精度と区切り判定が落ちます。
