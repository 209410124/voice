# 即時語音轉文字與翻譯 Vite + React 版

這個版本已經升級成比較正式的前後端分工：

1. `Vite + React` 負責前端開發
2. `server.js` 專注翻譯 API
3. 正式部署時由 Node 伺服器提供 `dist` 靜態檔

## 專案結構

```text
.
|-- .env.example
|-- index.html
|-- package.json
|-- server.js
|-- src
|   |-- App.jsx
|   |-- main.jsx
|   `-- styles.css
`-- vite.config.js
```

## 安裝與啟動

1. 安裝套件

```bash
npm install
```

2. 建立 `.env`

```bash
copy .env.example .env
```

3. 編輯 `.env`

```env
OPENAI_API_KEY=你的金鑰
OPENAI_MODEL=你要使用的模型名稱
PORT=3000
```

## 開發模式

開兩個終端：

1. 前端

```bash
npm run dev
```

2. 後端 API

```bash
npm run dev:server
```

前端預設會在：

```text
http://localhost:5173
```

Vite 已經設定好把 `/api` 代理到：

```text
http://localhost:3000
```

## 正式部署流程

1. 建置前端

```bash
npm run build
```

2. 啟動 Node 伺服器

```bash
npm start
```

3. 打開

```text
http://localhost:3000
```

## 目前版本特性

- React state 管理即時字幕與翻譯結果
- Web Speech API 做瀏覽器端語音辨識
- 後端可直接串接 OpenAI 翻譯模型
- 前後端開發職責已分離，後續更好擴充

## 建議下一步

- 拆成更多 React components
- 加入自訂 hooks
- 做字幕匯出
- 加入錄音檔上傳
- 升級成 WebSocket 串流翻譯
