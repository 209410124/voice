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

export default function App() {
  const recognitionRef = useRef(null);
  const practiceRecognitionRef = useRef(null);
  const requestCounterRef = useRef(0);
  const synthesisRef = useRef(null);
  const [availableVoices, setAvailableVoices] = useState([]);

  const [sourceLanguage, setSourceLanguage] = useState("zh-TW");
  const [targetLanguage, setTargetLanguage] = useState("en-US");
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [finalizedTranscript, setFinalizedTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [liveTranslation, setLiveTranslation] = useState("等待翻譯...");
  const [transcriptHistory, setTranscriptHistory] = useState([]);
  const [translationHistory, setTranslationHistory] = useState([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [isPracticeListening, setIsPracticeListening] = useState(false);
  const [practiceTranscript, setPracticeTranscript] = useState("");
  const [practiceInterim, setPracticeInterim] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [speechRate, setSpeechRate] = useState(1);
  const [speechPitch, setSpeechPitch] = useState(1);

  const combinedTranscript = useMemo(
    () => [finalizedTranscript, interimTranscript].filter(Boolean).join(" ").trim(),
    [finalizedTranscript, interimTranscript]
  );

  const filteredVoices = useMemo(() => {
    const exact = availableVoices.filter((voice) => voice.lang === targetLanguage);
    const prefix = availableVoices.filter((voice) => voice.lang?.startsWith(targetLanguage.split("-")[0]));
    return exact.length > 0 ? exact : prefix.length > 0 ? prefix : availableVoices;
  }, [availableVoices, targetLanguage]);

  useEffect(() => {
    if (!window.speechSynthesis) {
      return undefined;
    }

    function loadVoices() {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
    }

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  useEffect(() => {
    if (!selectedVoice && filteredVoices.length > 0) {
      setSelectedVoice(filteredVoices[0].name);
    }
  }, [filteredVoices, selectedVoice]);

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
        setTranslationHistory((current) => [
          { id: `${Date.now()}-${currentRequestId}`, text: translatedText },
          ...current
        ]);
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
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [sourceLanguage, targetLanguage]);

  useEffect(() => {
    if (!SpeechRecognition) {
      return undefined;
    }

    const practiceRecognition = new SpeechRecognition();
    practiceRecognition.continuous = true;
    practiceRecognition.interimResults = true;
    practiceRecognition.lang = targetLanguage;

    practiceRecognition.onstart = () => {
      setIsPracticeListening(true);
      setStatus({
        label: "跟讀中",
        message: "請跟著翻譯句子朗讀，完成後按停止跟讀。",
        isError: false
      });
    };

    practiceRecognition.onend = () => {
      setIsPracticeListening(false);
    };

    practiceRecognition.onerror = (event) => {
      setIsPracticeListening(false);
      setStatus({
        label: "跟讀辨識錯誤",
        message: `SpeechRecognition error: ${event.error}`,
        isError: true
      });
    };

    practiceRecognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0].transcript.trim();
        if (!text) {
          continue;
        }

        if (result.isFinal) {
          finalText += `${text} `;
        } else {
          interimText += `${text} `;
        }
      }

      if (finalText.trim()) {
        setPracticeTranscript((current) => [current, finalText.trim()].filter(Boolean).join(" ").trim());
      }

      setPracticeInterim(interimText.trim());
    };

    practiceRecognitionRef.current = practiceRecognition;

    return () => {
      practiceRecognition.onstart = null;
      practiceRecognition.onend = null;
      practiceRecognition.onerror = null;
      practiceRecognition.onresult = null;
      practiceRecognition.stop();
      practiceRecognitionRef.current = null;
    };
  }, [targetLanguage]);

  function resetSession() {
    requestCounterRef.current = 0;
    setFinalizedTranscript("");
    setInterimTranscript("");
    setTranscriptHistory([]);
    setTranslationHistory([]);
    setLiveTranslation("等待翻譯...");
    setEvaluation(null);
    setIsEvaluating(false);
    setPracticeTranscript("");
    setPracticeInterim("");
    setIsPracticeListening(false);
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setSpeakingId(null);
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

  function handleTogglePracticeListening() {
    const recognition = practiceRecognitionRef.current;
    if (!recognition) {
      return;
    }

    if (!liveTranslation || liveTranslation === "等待翻譯..." || liveTranslation === "翻譯中..." || liveTranslation === "翻譯失敗") {
      setStatus({
        label: "尚無翻譯",
        message: "請先產生翻譯並聽過一次，再開始跟讀。",
        isError: true
      });
      return;
    }

    if (isPracticeListening) {
      recognition.stop();
      return;
    }

    setPracticeTranscript("");
    setPracticeInterim("");

    try {
      recognition.lang = targetLanguage;
      recognition.start();
    } catch (error) {
      setStatus({
        label: "跟讀啟動失敗",
        message: "跟讀辨識目前無法啟動，請稍後再試。",
        isError: true
      });
    }
  }

  function handleSpeakTranslation() {
    if (!window.speechSynthesis || !liveTranslation || liveTranslation === "等待翻譯..." || liveTranslation === "翻譯中...") {
      return;
    }

    speakText(liveTranslation, "live");
  }

  async function handleEvaluateSpeech() {
    if (!practiceTranscript.trim()) {
      setStatus({
        label: "尚無內容",
        message: "請先完成一次跟讀，系統才能做語音評估。",
        isError: true
      });
      return;
    }

    setIsEvaluating(true);
    setEvaluation(null);

    try {
      const result = await evaluateSpeech({
        transcript: practiceTranscript,
        sourceLanguage: targetLanguage,
        referenceText: liveTranslation
      });
      setEvaluation(result);
      setStatus({
        label: "評估完成",
        message: "已根據目前辨識內容產生語音評估。",
        isError: false
      });
    } catch (error) {
      setStatus({
        label: "評估失敗",
        message: error.message,
        isError: true
      });
    } finally {
      setIsEvaluating(false);
    }
  }

  function speakText(text, id) {
    if (!window.speechSynthesis || !text) {
      return;
    }

    if (isSpeaking && speakingId === id) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setSpeakingId(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = targetLanguage;
    utterance.rate = speechRate;
    utterance.pitch = speechPitch;

    const voice = filteredVoices.find((item) => item.name === selectedVoice);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }

    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingId(null);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setSpeakingId(null);
    };

    synthesisRef.current = utterance;
    setIsSpeaking(true);
    setSpeakingId(id);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
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

      <section className="card speech-panel">
        <div className="panel-header">
          <h2>朗讀設定</h2>
          <span>文字轉語音</span>
        </div>
        <div className="speech-grid">
          <label>
            聲音
            <select value={selectedVoice} onChange={(event) => setSelectedVoice(event.target.value)}>
              {filteredVoices.map((voice) => (
                <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </label>

          <label>
            語速
            <input
              type="range"
              min="0.6"
              max="1.6"
              step="0.1"
              value={speechRate}
              onChange={(event) => setSpeechRate(Number(event.target.value))}
            />
            <span className="slider-value">{speechRate.toFixed(1)}x</span>
          </label>

          <label>
            音高
            <input
              type="range"
              min="0.8"
              max="1.4"
              step="0.1"
              value={speechPitch}
              onChange={(event) => setSpeechPitch(Number(event.target.value))}
            />
            <span className="slider-value">{speechPitch.toFixed(1)}</span>
          </label>
        </div>
      </section>

      <section className="card panel practice-panel">
        <div className="panel-header">
          <h2>跟讀練習</h2>
          <button type="button" className="utility-button" onClick={handleTogglePracticeListening}>
            {isPracticeListening ? "停止跟讀" : "開始跟讀"}
          </button>
        </div>
        <p className="practice-hint">先按「朗讀翻譯」聽一句，再按這裡開始跟讀，系統會根據你的跟讀內容做評估。</p>
        <div className="live-block practice-block">
          {practiceTranscript || practiceInterim || "等待你的跟讀內容..."}
        </div>
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
          <div className="action-row">
            <button
              type="button"
              className="utility-button"
              onClick={handleSpeakTranslation}
              disabled={!window.speechSynthesis || !liveTranslation || liveTranslation === "等待翻譯..." || liveTranslation === "翻譯中..."}
            >
              {isSpeaking && speakingId === "live" ? "停止朗讀" : "朗讀翻譯"}
            </button>
          </div>
          <div className="history">
            {translationHistory.map((item) => (
              <div className="history-row" key={item.id}>
                <p className="history-item">{item.text}</p>
                <button type="button" className="mini-play-button" onClick={() => speakText(item.text, item.id)}>
                  {isSpeaking && speakingId === item.id ? "停止" : "播放"}
                </button>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="card panel evaluation-panel">
        <div className="panel-header">
          <h2>語音評估</h2>
          <button type="button" className="utility-button" onClick={handleEvaluateSpeech} disabled={isEvaluating}>
            {isEvaluating ? "評估中..." : "開始評估"}
          </button>
        </div>
        {evaluation ? (
          <div className="evaluation-grid">
            <div className="score-card">
              <span className="score-label">總分</span>
              <strong className="score-value">{evaluation.overallScore ?? "--"}</strong>
            </div>
            <div className="evaluation-list">
              <p><strong>IELTS 預估：</strong>{evaluation.ieltsBand}</p>
              <p><strong>TOEIC Speaking 預估：</strong>{evaluation.toeicEstimate}</p>
              <p><strong>流暢度：</strong>{evaluation.fluency}</p>
              <p><strong>清晰度：</strong>{evaluation.clarity}</p>
              <p><strong>完整度：</strong>{evaluation.completeness}</p>
              <p><strong>用字：</strong>{evaluation.vocabulary}</p>
              <p><strong>文法：</strong>{evaluation.grammar}</p>
              <p><strong>發音判讀：</strong>{evaluation.pronunciationNote}</p>
              <p><strong>總評：</strong>{evaluation.summary}</p>
            </div>
            <div className="tips-block">
              {(evaluation.suggestions || []).map((item, index) => (
                <p className="tip-item" key={`${item}-${index}`}>
                  {index + 1}. {item}
                </p>
              ))}
            </div>
          </div>
        ) : (
          <p className="empty-evaluation">先聽翻譯，再完成一次跟讀，按下「開始評估」即可看到回饋。</p>
        )}
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

async function evaluateSpeech({ transcript, sourceLanguage, referenceText }) {
  const response = await fetch("/api/evaluate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      transcript,
      sourceLanguage,
      referenceText
    })
  });

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : payload.detail?.error?.message || payload.error;

    throw new Error(detail || "語音評估失敗，請確認後端設定。");
  }

  return payload.evaluation || null;
}
