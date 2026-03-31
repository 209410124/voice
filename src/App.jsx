import { useEffect, useMemo, useRef, useState } from "react";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const LANGUAGE_OPTIONS = [
  { value: "zh-TW", label: "繁體中文" },
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" }
];

const PLACEHOLDERS = {
  translationIdle: "翻譯會顯示在這裡",
  translationLoading: "正在翻譯中...",
  translationError: "翻譯失敗，請再試一次",
  translationEmpty: "目前沒有可用翻譯",
  transcriptIdle: "開始錄音後，逐字稿會即時出現在這裡",
  practiceIdle: "先播放翻譯，再開始跟讀練習"
};

const DEFAULT_STATUS = {
  label: "準備完成",
  message: "先選語言，按下開始錄音後直接說話即可。",
  isError: false
};

const DEFAULT_SERVER_STATUS = {
  checked: false,
  ok: false,
  server: "unknown",
  apiKeyConfigured: false,
  modelConfigured: false,
  model: null
};

function isUsableTranslation(text) {
  return text && !Object.values(PLACEHOLDERS).includes(text);
}

export default function App() {
  const recognitionRef = useRef(null);
  const practiceRecognitionRef = useRef(null);
  const requestCounterRef = useRef(0);
  const [availableVoices, setAvailableVoices] = useState([]);

  const [sourceLanguage, setSourceLanguage] = useState("zh-TW");
  const [targetLanguage, setTargetLanguage] = useState("en-US");
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [finalizedTranscript, setFinalizedTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [liveTranslation, setLiveTranslation] = useState(PLACEHOLDERS.translationIdle);
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
  const [serverStatus, setServerStatus] = useState(DEFAULT_SERVER_STATUS);

  const combinedTranscript = useMemo(
    () => [finalizedTranscript, interimTranscript].filter(Boolean).join(" ").trim(),
    [finalizedTranscript, interimTranscript]
  );

  const filteredVoices = useMemo(() => {
    const exact = availableVoices.filter((voice) => voice.lang === targetLanguage);
    const prefix = availableVoices.filter((voice) => voice.lang?.startsWith(targetLanguage.split("-")[0]));
    return exact.length > 0 ? exact : prefix.length > 0 ? prefix : availableVoices;
  }, [availableVoices, targetLanguage]);

  const hasLiveTranslation = isUsableTranslation(liveTranslation);
  const sessionReadyForPractice = hasLiveTranslation && !isListening;

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        const response = await fetch("/api/health");
        const payload = await readJsonSafely(response);

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          throw new Error("健康檢查失敗");
        }

        setServerStatus({
          checked: true,
          ok: Boolean(payload.ok),
          server: payload.server || "online",
          apiKeyConfigured: Boolean(payload.apiKeyConfigured),
          modelConfigured: Boolean(payload.modelConfigured),
          model: payload.model || null
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setServerStatus({
          checked: true,
          ok: false,
          server: "offline",
          apiKeyConfigured: false,
          modelConfigured: false,
          model: null
        });
        setStatus({
          label: "API 未連線",
          message: "後端翻譯服務沒有啟動。請使用 `npm run dev`，或另外啟動 `npm run dev:server`。",
          isError: true
        });
      }
    }

    checkHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!window.speechSynthesis) {
      return undefined;
    }

    function loadVoices() {
      setAvailableVoices(window.speechSynthesis.getVoices());
    }

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  useEffect(() => {
    if (!filteredVoices.some((voice) => voice.name === selectedVoice)) {
      setSelectedVoice(filteredVoices[0]?.name || "");
    }
  }, [filteredVoices, selectedVoice]);

  useEffect(() => {
    if (!SpeechRecognition) {
      setStatus({
        label: "瀏覽器不支援",
        message: "這個功能需要 Web Speech API，建議使用最新版 Chrome 或 Edge。",
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
        label: "錄音中",
        message: "正在收音，你可以自然說話，系統會分段翻譯。",
        isError: false
      });
    };

    recognition.onend = () => {
      setIsListening(false);
      setStatus((current) =>
        current.isError
          ? current
          : {
              label: "已停止錄音",
              message: "你可以重新開始錄音，或直接播放翻譯、做跟讀練習。",
              isError: false
            }
      );
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      setStatus({
        label: "錄音失敗",
        message: `語音辨識發生錯誤：${event.error}`,
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
      setLiveTranslation(PLACEHOLDERS.translationLoading);

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

        const safeTranslation = translatedText || PLACEHOLDERS.translationEmpty;
        setLiveTranslation(safeTranslation);
        setTranslationHistory((current) => [
          { id: `${Date.now()}-${currentRequestId}`, text: safeTranslation },
          ...current
        ]);
        setStatus({
          label: "翻譯完成",
          message: "最新一句已翻好，現在可以直接播放，或開始跟讀。",
          isError: false
        });
      } catch (error) {
        setLiveTranslation(PLACEHOLDERS.translationError);
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
        message: "請照著翻譯內容念，完成後再按一次停止。",
        isError: false
      });
    };

    practiceRecognition.onend = () => {
      setIsPracticeListening(false);
    };

    practiceRecognition.onerror = (event) => {
      setIsPracticeListening(false);
      setStatus({
        label: "跟讀失敗",
        message: `語音辨識發生錯誤：${event.error}`,
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

  function stopSpeaking() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setSpeakingId(null);
  }

  function stopAllRecognition() {
    recognitionRef.current?.stop();
    practiceRecognitionRef.current?.stop();
  }

  function resetSession() {
    requestCounterRef.current = 0;
    stopAllRecognition();
    stopSpeaking();
    setFinalizedTranscript("");
    setInterimTranscript("");
    setTranscriptHistory([]);
    setTranslationHistory([]);
    setLiveTranslation(PLACEHOLDERS.translationIdle);
    setEvaluation(null);
    setIsEvaluating(false);
    setPracticeTranscript("");
    setPracticeInterim("");
    setIsPracticeListening(false);
    setStatus(DEFAULT_STATUS);
  }

  function handleSwapLanguages() {
    if (isListening || isPracticeListening) {
      return;
    }

    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
    resetSession();
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
        label: "無法開始錄音",
        message: "錄音正在初始化或尚未完全停止，請稍等一下再試。",
        isError: true
      });
    }
  }

  function handleTogglePracticeListening() {
    const recognition = practiceRecognitionRef.current;

    if (!recognition) {
      return;
    }

    if (!sessionReadyForPractice) {
      setStatus({
        label: "還不能跟讀",
        message: "請先完成一段翻譯，再開始跟讀練習。",
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
        label: "無法開始跟讀",
        message: "跟讀辨識尚未準備好，請稍等一下再試。",
        isError: true
      });
    }
  }

  function handleSpeakTranslation() {
    if (!window.speechSynthesis || !hasLiveTranslation) {
      return;
    }

    speakText(liveTranslation, "live");
  }

  async function handleEvaluateSpeech() {
    if (!practiceTranscript.trim()) {
      setStatus({
        label: "缺少跟讀內容",
        message: "請先完成一次跟讀，再進行發音評分。",
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
        label: "評分完成",
        message: "你可以先看總分，再往下看具體建議。",
        isError: false
      });
    } catch (error) {
      setStatus({
        label: "評分失敗",
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
      stopSpeaking();
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

    setIsSpeaking(true);
    setSpeakingId(id);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Voice Translation Studio</p>
          <h1>語音翻譯與跟讀練習</h1>
          <p className="intro">
            把常用操作集中在最上方，照著「錄音、播放、跟讀、評分」的順序走，不用在畫面裡來回找按鈕。
          </p>
        </div>
        <div className="hero-steps card">
          <p className="steps-title">使用流程</p>
          <ol className="steps-list">
            <li>選擇語言並開始錄音</li>
            <li>查看即時翻譯並播放</li>
            <li>開始跟讀並送出評分</li>
          </ol>
        </div>
      </section>

      <section className="card command-bar">
        <div className="field-group">
          <label>
            你要說的語言
            <select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="swap-button"
            onClick={handleSwapLanguages}
            disabled={isListening || isPracticeListening}
            aria-label="交換語言"
          >
            ⇄
          </button>

          <label>
            想翻成的語言
            <select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="cta-group">
          <button
            type="button"
            className={`primary-button${isListening ? " active" : ""}`}
            onClick={handleToggleListening}
            disabled={!SpeechRecognition}
          >
            {isListening ? "停止錄音" : "開始錄音"}
          </button>
          <button type="button" className="secondary-button" onClick={resetSession}>
            清空這次內容
          </button>
        </div>
      </section>

      <section className="status-row">
        <div className={`status-pill${status.isError ? " error" : ""}`}>{status.label}</div>
        <div className="status-text">{status.message}</div>
      </section>

      {!serverStatus.ok ? (
        <section className="card service-warning">
          <div className="panel-header compact">
            <div>
              <p className="section-kicker">Service Check</p>
              <h2>翻譯服務目前不可用</h2>
            </div>
            <span>{serverStatus.checked ? serverStatus.server : "checking"}</span>
          </div>
          <p className="service-copy">
            {!serverStatus.checked
              ? "正在檢查翻譯服務狀態..."
              : "請先確認本機 API server 有啟動，且 `.env` 內的 `OPENAI_API_KEY` 與 `OPENAI_MODEL` 都有設定。"}
          </p>
          <p className="service-copy">
            建議直接執行 `npm run dev`。這個指令現在會同時啟動前端和後端，不需要再分開開兩個視窗。
          </p>
        </section>
      ) : null}

      <section className="workspace">
        <div className="main-column">
          <section className="panels">
            <article className="card panel">
              <div className="panel-header">
                <div>
                  <p className="section-kicker">Step 1</p>
                  <h2>原文逐字稿</h2>
                </div>
                <span>{isListening ? "正在更新" : "等待輸入"}</span>
              </div>
              <div className="live-block">{combinedTranscript || PLACEHOLDERS.transcriptIdle}</div>
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
                <div>
                  <p className="section-kicker">Step 2</p>
                  <h2>即時翻譯</h2>
                </div>
                <span>{targetLanguage}</span>
              </div>
              <div className="live-block translated">{liveTranslation}</div>
              <div className="action-row">
                <button
                  type="button"
                  className="utility-button"
                  onClick={handleSpeakTranslation}
                  disabled={!window.speechSynthesis || !hasLiveTranslation}
                >
                  {isSpeaking && speakingId === "live" ? "停止播放" : "播放翻譯"}
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

          <section className="card panel practice-panel">
            <div className="panel-header">
              <div>
                <p className="section-kicker">Step 3</p>
                <h2>跟讀練習</h2>
              </div>
              <button
                type="button"
                className="utility-button"
                onClick={handleTogglePracticeListening}
                disabled={!sessionReadyForPractice}
              >
                {isPracticeListening ? "停止跟讀" : "開始跟讀"}
              </button>
            </div>
            <p className="practice-hint">
              先播放翻譯熟悉語調，再按開始跟讀。系統會把你剛剛說的內容記下來，方便接著做評分。
            </p>
            <div className="live-block practice-block">
              {practiceTranscript || practiceInterim || PLACEHOLDERS.practiceIdle}
            </div>
          </section>
        </div>

        <aside className="side-column">
          <section className="card speech-panel">
            <div className="panel-header">
              <div>
                <p className="section-kicker">Playback</p>
                <h2>播放設定</h2>
              </div>
              <span>{filteredVoices.length ? `${filteredVoices.length} 個語音` : "無可用語音"}</span>
            </div>
            <div className="speech-grid">
              <label>
                聲音
                <select value={selectedVoice} onChange={(event) => setSelectedVoice(event.target.value)}>
                  {filteredVoices.length > 0 ? (
                    filteredVoices.map((voice) => (
                      <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))
                  ) : (
                    <option value="">目前沒有可用語音</option>
                  )}
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

          <section className="card panel evaluation-panel">
            <div className="panel-header">
              <div>
                <p className="section-kicker">Step 4</p>
                <h2>發音評分</h2>
              </div>
              <button type="button" className="utility-button" onClick={handleEvaluateSpeech} disabled={isEvaluating}>
                {isEvaluating ? "評分中..." : "開始評分"}
              </button>
            </div>
            {evaluation ? (
              <div className="evaluation-grid">
                <div className="score-card">
                  <span className="score-label">總分</span>
                  <strong className="score-value">{evaluation.overallScore ?? "--"}</strong>
                </div>
                <div className="evaluation-list">
                  <p><strong>IELTS 估計：</strong>{evaluation.ieltsBand || "--"}</p>
                  <p><strong>TOEIC Speaking 估計：</strong>{evaluation.toeicEstimate || "--"}</p>
                  <p><strong>流暢度：</strong>{evaluation.fluency || "--"}</p>
                  <p><strong>清晰度：</strong>{evaluation.clarity || "--"}</p>
                  <p><strong>完整度：</strong>{evaluation.completeness || "--"}</p>
                  <p><strong>字彙：</strong>{evaluation.vocabulary || "--"}</p>
                  <p><strong>文法：</strong>{evaluation.grammar || "--"}</p>
                  <p><strong>發音提醒：</strong>{evaluation.pronunciationNote || "--"}</p>
                  <p><strong>整體總結：</strong>{evaluation.summary || "--"}</p>
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
              <p className="empty-evaluation">
                完成跟讀後按下開始評分，這裡會顯示總分、能力估計和可直接練習的修正建議。
              </p>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}

async function translateText({ text, sourceLanguage, targetLanguage }) {
  let response;

  try {
    response = await fetch("/api/translate", {
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
  } catch (error) {
    throw new Error("無法連到翻譯服務。請確認後端已啟動，再試一次。");
  }

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : payload.detail?.error?.message || payload.error;

    throw new Error(detail || "翻譯服務暫時無法使用，請稍後再試。");
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
    throw new Error(`伺服器回傳了無法解析的 JSON，HTTP ${response.status}。請確認 API 是否正常啟動。`);
  }
}

async function evaluateSpeech({ transcript, sourceLanguage, referenceText }) {
  let response;

  try {
    response = await fetch("/api/evaluate", {
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
  } catch (error) {
    throw new Error("無法連到評分服務。請確認後端已啟動，再試一次。");
  }

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : payload.detail?.error?.message || payload.error;

    throw new Error(detail || "發音評分暫時失敗，請稍後再試。");
  }

  return payload.evaluation || null;
}
