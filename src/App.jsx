import { useEffect, useMemo, useRef, useState } from "react";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const LANGUAGE_OPTIONS = [
  { value: "zh-TW", label: "中文（繁體）" },
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" }
];

const DEFAULT_STATUS = {
  label: "尚未開始",
  message: "按下開始收音後，瀏覽器會要求麥克風權限。",
  isError: false
};

const DEFAULT_BACKEND_STATUS = {
  loading: true,
  online: false,
  ready: false,
  apiKeyConfigured: false,
  modelConfigured: false,
  model: null,
  message: "正在檢查後端連線..."
};

export default function App() {
  const recognitionRef = useRef(null);
  const requestCounterRef = useRef(0);

  const [sourceLanguage, setSourceLanguage] = useState("zh-TW");
  const [targetLanguage, setTargetLanguage] = useState("en-US");
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [finalizedTranscript, setFinalizedTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [liveTranslation, setLiveTranslation] = useState("等待翻譯...");
  const [transcriptHistory, setTranscriptHistory] = useState([]);
  const [translationHistory, setTranslationHistory] = useState([]);
  const [backendStatus, setBackendStatus] = useState(DEFAULT_BACKEND_STATUS);

  const combinedTranscript = useMemo(
    () => [finalizedTranscript, interimTranscript].filter(Boolean).join(" ").trim(),
    [finalizedTranscript, interimTranscript]
  );

  useEffect(() => {
    checkBackendHealth();
  }, []);

  useEffect(() => {
    if (!SpeechRecognition) {
      setStatus({
        label: "裝置不支援",
        message: "這個瀏覽器不支援 Web Speech API，建議使用最新版 Chrome 或 Edge。",
        isError: true
      });
      return undefined;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = sourceLanguage;

    recognition.onstart = () => {
      setIsListening(true);
      setStatus({
        label: "收音中",
        message: "正在持續辨識語音，完成的片段會自動送去翻譯。",
        isError: false
      });
    };

    recognition.onend = () => {
      setIsListening(false);
      setStatus((current) =>
        current.isError
          ? current
          : {
              label: "已停止",
              message: "收音已停止，你可以重新開始新的翻譯回合。",
              isError: false
            }
      );
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      setStatus({
        label: "辨識錯誤",
        message: `SpeechRecognition error: ${event.error}`,
        isError: true
      });
    };

    recognition.onresult = async (event) => {
      let nextInterim = "";
      const finalizedSegments = [];

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0].transcript.trim();
        if (!text) {
          continue;
        }

        if (result.isFinal) {
          finalizedSegments.push(text);
        } else {
          nextInterim += `${text} `;
        }
      }

      setInterimTranscript(nextInterim.trim());

      if (finalizedSegments.length === 0) {
        return;
      }

      const finalizedSegment = finalizedSegments.join(" ").trim();
      setFinalizedTranscript((current) => [current, finalizedSegment].filter(Boolean).join(" ").trim());
      setTranscriptHistory((current) => [finalizedSegment, ...current]);
      setInterimTranscript("");
      setLiveTranslation("翻譯中...");

      const currentRequestId = ++requestCounterRef.current;

      try {
        const translatedText = await translateText({
          text: finalizedSegment,
          sourceLanguage,
          targetLanguage
        });

        if (currentRequestId !== requestCounterRef.current) {
          return;
        }

        setLiveTranslation(translatedText || "沒有翻譯內容");
        setTranslationHistory((current) => [translatedText, ...current]);
        setStatus({
          label: "翻譯完成",
          message: "已收到最新翻譯片段，持續說話會繼續追加。",
          isError: false
        });
      } catch (error) {
        setLiveTranslation("翻譯失敗");
        setStatus({
          label: "翻譯失敗",
          message: error.message,
          isError: true
        });
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [sourceLanguage, targetLanguage]);

  async function checkBackendHealth() {
    setBackendStatus(DEFAULT_BACKEND_STATUS);

    try {
      const response = await fetch("/api/health");
      const payload = await readJsonSafely(response);

      setBackendStatus({
        loading: false,
        online: true,
        ready: Boolean(payload.ok),
        apiKeyConfigured: Boolean(payload.apiKeyConfigured),
        modelConfigured: Boolean(payload.modelConfigured),
        model: payload.model || null,
        message: payload.ok
          ? `後端已連線，模型：${payload.model}`
          : "後端已連線，但 API key 或模型設定尚未完成。"
      });
    } catch (error) {
      setBackendStatus({
        loading: false,
        online: false,
        ready: false,
        apiKeyConfigured: false,
        modelConfigured: false,
        model: null,
        message: "無法連到後端，請確認 `npm run dev:server` 是否正在執行。"
      });
    }
  }

  function resetSession() {
    requestCounterRef.current = 0;
    setFinalizedTranscript("");
    setInterimTranscript("");
    setTranscriptHistory([]);
    setTranslationHistory([]);
    setLiveTranslation("等待翻譯...");
    setStatus(DEFAULT_STATUS);
  }

  function handleToggleListening() {
    const recognition = recognitionRef.current;
    if (!recognition) {
      return;
    }

    if (isListening) {
      recognition.stop();
      return;
    }

    resetSession();
    recognition.lang = sourceLanguage;

    try {
      recognition.start();
    } catch (error) {
      setStatus({
        label: "啟動失敗",
        message: "麥克風可能已在使用中，請稍後再試。",
        isError: true
      });
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">React Voice Translation</p>
        <h1>語音轉文字，即時翻譯</h1>
        <p className="intro">
          這個版本已經整理成 Vite + React 結構，畫面、狀態與 API 邏輯都比較適合往正式專案延伸。
        </p>
      </section>

      <section className="controls card">
        <label>
          語音語言
          <select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          翻譯目標
          <select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="primary-button"
          onClick={handleToggleListening}
          disabled={!SpeechRecognition}
        >
          {isListening ? "停止收音" : "開始收音"}
        </button>
      </section>

      <section className="status-row">
        <div className={`status-pill${status.isError ? " error" : ""}`}>{status.label}</div>
        <div className="status-text">{status.message}</div>
      </section>

      <section className="backend-status card">
        <div className="panel-header">
          <h2>後端狀態</h2>
          <button type="button" className="secondary-button" onClick={checkBackendHealth}>
            重新檢查
          </button>
        </div>
        
        <p className="backend-message">{backendStatus.message}</p>
      </section>

      <section className="panels">
        <article className="card panel">
          <div className="panel-header">
            <h2>即時字幕</h2>
            <span>原文</span>
          </div>
          <div className="live-block">{combinedTranscript || "等待語音輸入..."}</div>
          <div className="history">
            {transcriptHistory.map((item, index) => (
              <p className="history-item" key={`${item}-${index}`}>
                {item}
              </p>
            ))}
          </div>
        </article>

        <article className="card panel">
          <div className="panel-header">
            <h2>翻譯結果</h2>
            <span>目標語言</span>
          </div>
          <div className="live-block translated">{liveTranslation}</div>
          <div className="history">
            {translationHistory.map((item, index) => (
              <p className="history-item" key={`${item}-${index}`}>
                {item}
              </p>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

async function translateText({ text, sourceLanguage, targetLanguage }) {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      sourceLanguage,
      targetLanguage
    })
  });

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : payload.detail?.error?.message || payload.error;

    throw new Error(
      detail || "翻譯服務沒有回傳可讀取的錯誤資訊。請確認後端設定。"
    );
  }

  return payload.translatedText || "";
}

async function readJsonSafely(response) {
  const raw = await response.text();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `翻譯服務回傳了非 JSON 內容（HTTP ${response.status}）。請確認後端與 Vite proxy 是否正常。`
    );
  }
}
