import { useEffect, useMemo, useRef, useState } from "react";

const LANGUAGE_OPTIONS = [
  { value: "zh-TW", label: "繁體中文" },
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" }
];

const PLACEHOLDERS = {
  translationIdle: "錄音完成後，翻譯會顯示在這裡。",
  translationLoading: "Whisper 正在轉錄並翻譯中...",
  translationError: "翻譯失敗，請再試一次。",
  translationEmpty: "目前沒有可用翻譯。",
  transcriptIdle: "開始錄音，停止後就會看到 Whisper 轉錄結果。",
  practiceIdle: "先播放翻譯，再開始跟讀錄音。"
};

const DEFAULT_STATUS = {
  label: "準備完成",
  message: "先選語言，錄音結束後系統會把音訊送到 Whisper 轉錄。",
  isError: false
};

const DEFAULT_SERVER_STATUS = {
  checked: false,
  ok: false,
  server: "unknown",
  apiKeyConfigured: false,
  transcriptionModelConfigured: false,
  textModelConfigured: false,
  transcriptionModel: null,
  textModel: null,
  model: null
};

function isUsableTranslation(text) {
  return text && !Object.values(PLACEHOLDERS).includes(text);
}

function getSupportedMimeType() {
  if (!window.MediaRecorder) {
    return "";
  }

  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
}

export default function App() {
  const recordingRecorderRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const practiceRecorderRef = useRef(null);
  const practiceStreamRef = useRef(null);
  const practiceChunksRef = useRef([]);
  const requestCounterRef = useRef(0);
  const [availableVoices, setAvailableVoices] = useState([]);

  const [sourceLanguage, setSourceLanguage] = useState("zh-TW");
  const [targetLanguage, setTargetLanguage] = useState("en-US");
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [finalizedTranscript, setFinalizedTranscript] = useState("");
  const [liveTranslation, setLiveTranslation] = useState(PLACEHOLDERS.translationIdle);
  const [transcriptHistory, setTranscriptHistory] = useState([]);
  const [translationHistory, setTranslationHistory] = useState([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [isPracticeListening, setIsPracticeListening] = useState(false);
  const [isPracticeTranscribing, setIsPracticeTranscribing] = useState(false);
  const [practiceTranscript, setPracticeTranscript] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [speechRate, setSpeechRate] = useState(1);
  const [speechPitch, setSpeechPitch] = useState(1);
  const [serverStatus, setServerStatus] = useState(DEFAULT_SERVER_STATUS);

  const filteredVoices = useMemo(() => {
    const exact = availableVoices.filter((voice) => voice.lang === targetLanguage);
    const prefix = availableVoices.filter((voice) => voice.lang?.startsWith(targetLanguage.split("-")[0]));
    return exact.length > 0 ? exact : prefix.length > 0 ? prefix : availableVoices;
  }, [availableVoices, targetLanguage]);

  const hasLiveTranslation = isUsableTranslation(liveTranslation);
  const sessionReadyForPractice = hasLiveTranslation && !isListening && !isTranscribing;
  const supportsAudioRecording = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

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
          throw new Error("健康檢查失敗。");
        }

        setServerStatus({
          checked: true,
          ok: Boolean(payload.ok),
          server: payload.server || "online",
          apiKeyConfigured: Boolean(payload.apiKeyConfigured),
          transcriptionModelConfigured: Boolean(payload.transcriptionModelConfigured),
          textModelConfigured: Boolean(payload.textModelConfigured),
          transcriptionModel: payload.transcriptionModel || null,
          textModel: payload.textModel || null,
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
          transcriptionModelConfigured: false,
          textModelConfigured: false,
          transcriptionModel: null,
          textModel: null,
          model: null
        });
        setStatus({
          label: "API 未連線",
          message: "後端服務尚未啟動。請執行 npm run dev 或 npm run dev:server。",
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
    if (!supportsAudioRecording) {
      setStatus({
        label: "瀏覽器不支援",
        message: "這個版本需要 MediaRecorder 和麥克風權限，建議使用最新版 Chrome 或 Edge。",
        isError: true
      });
    }
  }, [supportsAudioRecording]);

  useEffect(() => {
    return () => {
      cleanupRecorder(recordingRecorderRef, recordingStreamRef);
      cleanupRecorder(practiceRecorderRef, practiceStreamRef);
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function stopSpeaking() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setSpeakingId(null);
  }

  function resetSession() {
    requestCounterRef.current = 0;
    if (isListening) {
      stopRecorder(recordingRecorderRef.current);
    }
    if (isPracticeListening) {
      stopRecorder(practiceRecorderRef.current);
    }
    stopSpeaking();
    setFinalizedTranscript("");
    setTranscriptHistory([]);
    setTranslationHistory([]);
    setLiveTranslation(PLACEHOLDERS.translationIdle);
    setEvaluation(null);
    setIsEvaluating(false);
    setPracticeTranscript("");
    setIsPracticeListening(false);
    setIsTranscribing(false);
    setIsPracticeTranscribing(false);
    setStatus(DEFAULT_STATUS);
  }

  function handleSwapLanguages() {
    if (isListening || isPracticeListening || isTranscribing || isPracticeTranscribing) {
      return;
    }

    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
    resetSession();
  }

  async function handleToggleListening() {
    if (!supportsAudioRecording) {
      return;
    }

    if (isListening) {
      const audioBlob = await stopCapture({ recorderRef: recordingRecorderRef, streamRef: recordingStreamRef, chunksRef: recordingChunksRef });
      setIsListening(false);
      await processTranslationAudio(audioBlob);
      return;
    }

    resetSession();

    try {
      await startCapture({ recorderRef: recordingRecorderRef, streamRef: recordingStreamRef, chunksRef: recordingChunksRef, setActive: setIsListening });
      setStatus({
        label: "錄音中",
        message: "請自然說話，結束後按停止送出給 Whisper。",
        isError: false
      });
    } catch (error) {
      setStatus({
        label: "無法開始錄音",
        message: error.message,
        isError: true
      });
    }
  }

  async function handleTogglePracticeListening() {
    if (!supportsAudioRecording) {
      return;
    }

    if (!sessionReadyForPractice) {
      setStatus({
        label: "目前無法跟讀",
        message: "請先完成一段翻譯，再開始跟讀錄音。",
        isError: true
      });
      return;
    }

    if (isPracticeListening) {
      const audioBlob = await stopCapture({ recorderRef: practiceRecorderRef, streamRef: practiceStreamRef, chunksRef: practiceChunksRef });
      setIsPracticeListening(false);
      await processPracticeAudio(audioBlob);
      return;
    }

    setPracticeTranscript("");
    setEvaluation(null);

    try {
      await startCapture({ recorderRef: practiceRecorderRef, streamRef: practiceStreamRef, chunksRef: practiceChunksRef, setActive: setIsPracticeListening });
      setStatus({
        label: "跟讀錄音中",
        message: "請跟著翻譯念，停止後會由 Whisper 轉成文字。",
        isError: false
      });
    } catch (error) {
      setStatus({
        label: "無法開始跟讀",
        message: error.message,
        isError: true
      });
    }
  }

  async function processTranslationAudio(audioBlob) {
    if (!audioBlob || audioBlob.size === 0) {
      setStatus({
        label: "沒有錄到聲音",
        message: "這次錄音沒有可用音訊，請確認麥克風權限後再試一次。",
        isError: true
      });
      return;
    }

    const currentRequestId = ++requestCounterRef.current;
    setIsTranscribing(true);
    setLiveTranslation(PLACEHOLDERS.translationLoading);
    setStatus({
      label: "轉錄中",
      message: "Whisper 正在把錄音轉成文字，接著會自動翻譯。",
      isError: false
    });

    try {
      const transcript = await transcribeAudio({ audioBlob, language: sourceLanguage });
      if (currentRequestId !== requestCounterRef.current) {
        return;
      }

      if (!transcript) {
        throw new Error("Whisper 沒有辨識到足夠語音內容，請再錄一次。");
      }

      setFinalizedTranscript((current) => [current, transcript].filter(Boolean).join(" ").trim());
      setTranscriptHistory((current) => [transcript, ...current]);

      const translatedText = await translateText({
        text: transcript,
        sourceLanguage,
        targetLanguage
      });

      if (currentRequestId !== requestCounterRef.current) {
        return;
      }

      const safeTranslation = translatedText || PLACEHOLDERS.translationEmpty;
      setLiveTranslation(safeTranslation);
      setTranslationHistory((current) => [{ id: `${Date.now()}-${currentRequestId}`, text: safeTranslation }, ...current]);
      setStatus({
        label: "翻譯完成",
        message: "Whisper 轉錄和翻譯都完成了，現在可以播放或開始跟讀。",
        isError: false
      });
    } catch (error) {
      setLiveTranslation(PLACEHOLDERS.translationError);
      setStatus({
        label: "處理失敗",
        message: error.message,
        isError: true
      });
    } finally {
      setIsTranscribing(false);
    }
  }

  async function processPracticeAudio(audioBlob) {
    if (!audioBlob || audioBlob.size === 0) {
      setStatus({
        label: "沒有跟讀音訊",
        message: "這次跟讀錄音沒有可用音訊，請再試一次。",
        isError: true
      });
      return;
    }

    setIsPracticeTranscribing(true);
    setStatus({
      label: "跟讀轉錄中",
      message: "Whisper 正在整理你的跟讀內容。",
      isError: false
    });

    try {
      const transcript = await transcribeAudio({ audioBlob, language: targetLanguage });
      if (!transcript) {
        throw new Error("Whisper 沒有辨識到跟讀語音，請再試一次。");
      }

      setPracticeTranscript(transcript);
      setStatus({
        label: "跟讀完成",
        message: "已取得跟讀文字，現在可以直接送出評分。",
        isError: false
      });
    } catch (error) {
      setStatus({
        label: "跟讀失敗",
        message: error.message,
        isError: true
      });
    } finally {
      setIsPracticeTranscribing(false);
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
        message: "請先完成一次跟讀錄音，再進行發音評分。",
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
        message: "可以先看總分，再往下看具體建議。",
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
          <h1>Whisper 語音翻譯練習</h1>
          <p className="intro">
            這個版本會先錄下音訊，再交給 Whisper 轉錄，接著完成翻譯和口說評分。
          </p>
        </div>
        <div className="hero-steps card">
          <p className="steps-title">流程</p>
          <ol className="steps-list">
            <li>選擇語言並錄音</li>
            <li>等待 Whisper 轉錄與翻譯</li>
            <li>播放、跟讀、送出評分</li>
          </ol>
        </div>
      </section>

      <section className="card command-bar">
        <div className="field-group">
          <label>
            原始語言
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
            disabled={isListening || isPracticeListening || isTranscribing || isPracticeTranscribing}
            aria-label="交換語言"
          >
            ⇄
          </button>

          <label>
            目標語言
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
            disabled={!supportsAudioRecording || isTranscribing || isPracticeListening || isPracticeTranscribing}
          >
            {isListening ? "停止並送出" : "開始錄音"}
          </button>
          <button type="button" className="secondary-button" onClick={resetSession}>
            清空本次內容
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
              <h2>需要先完成後端設定</h2>
            </div>
            <span>{serverStatus.checked ? serverStatus.server : "checking"}</span>
          </div>
          <p className="service-copy">
            {!serverStatus.checked
              ? "正在檢查服務狀態..."
              : "請確認後端已啟動，而且 .env 包含 OPENAI_API_KEY、OPENAI_TRANSCRIPTION_MODEL、OPENAI_TEXT_MODEL。"}
          </p>
          <p className="service-copy">最方便的啟動方式是執行 npm run dev，它會同時啟動前端與後端。</p>
        </section>
      ) : null}

      <section className="workspace">
        <div className="main-column">
          <section className="panels">
            <article className="card panel">
              <div className="panel-header">
                <div>
                  <p className="section-kicker">Step 1</p>
                  <h2>Whisper 逐字稿</h2>
                </div>
                <span>{isListening ? "錄音中" : isTranscribing ? "轉錄中" : "待機"}</span>
              </div>
              <div className="live-block">{finalizedTranscript || PLACEHOLDERS.transcriptIdle}</div>
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
                  <h2>翻譯結果</h2>
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
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="card panel practice-panel">
            <div className="panel-header">
              <div>
                <p className="section-kicker">Step 3</p>
                <h2>跟讀錄音</h2>
              </div>
              <button
                type="button"
                className="utility-button"
                onClick={handleTogglePracticeListening}
                disabled={!sessionReadyForPractice || isPracticeTranscribing || isTranscribing}
              >
                {isPracticeListening ? "停止跟讀" : "開始跟讀"}
              </button>
            </div>
            <p className="practice-hint">
              先播放翻譯，再跟著念，停止錄音後 Whisper 會幫你轉成文字。
            </p>
            <div className="live-block practice-block">
              {practiceTranscript || (isPracticeTranscribing ? "Whisper 正在轉錄你的跟讀音訊..." : PLACEHOLDERS.practiceIdle)}
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
              <span>{filteredVoices.length ? `${filteredVoices.length} 個語音` : "沒有可用語音"}</span>
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
                <h2>口說評分</h2>
              </div>
              <button
                type="button"
                className="utility-button"
                onClick={handleEvaluateSpeech}
                disabled={isEvaluating || isPracticeListening || isPracticeTranscribing}
              >
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
                  <p><strong>IELTS 估計：</strong> {evaluation.ieltsBand || "--"}</p>
                  <p><strong>TOEIC 估計：</strong> {evaluation.toeicEstimate || "--"}</p>
                  <p><strong>流暢度：</strong> {evaluation.fluency || "--"}</p>
                  <p><strong>清晰度：</strong> {evaluation.clarity || "--"}</p>
                  <p><strong>完整度：</strong> {evaluation.completeness || "--"}</p>
                  <p><strong>字彙：</strong> {evaluation.vocabulary || "--"}</p>
                  <p><strong>文法：</strong> {evaluation.grammar || "--"}</p>
                  <p><strong>發音提醒：</strong> {evaluation.pronunciationNote || "--"}</p>
                  <p><strong>總結：</strong> {evaluation.summary || "--"}</p>
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
                完成一次跟讀後按下開始評分，這裡會顯示總分與可直接練習的建議。
              </p>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}

async function startCapture({ recorderRef, streamRef, chunksRef, setActive }) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = getSupportedMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

  chunksRef.current = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunksRef.current.push(event.data);
    }
  };

  recorderRef.current = recorder;
  streamRef.current = stream;
  recorder.start();
  setActive(true);
}

function stopCapture({ recorderRef, streamRef, chunksRef }) {
  return new Promise((resolve, reject) => {
    const recorder = recorderRef.current;
    if (!recorder) {
      resolve(null);
      return;
    }

    recorder.onstop = () => {
      const mimeType = recorder.mimeType || "audio/webm";
      const audioBlob = new Blob(chunksRef.current, { type: mimeType });
      cleanupRecorder(recorderRef, streamRef);
      chunksRef.current = [];
      resolve(audioBlob);
    };

    recorder.onerror = () => {
      cleanupRecorder(recorderRef, streamRef);
      chunksRef.current = [];
      reject(new Error("錄音失敗，請再試一次。"));
    };

    stopRecorder(recorder);
  });
}

function stopRecorder(recorder) {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }
}

function cleanupRecorder(recorderRef, streamRef) {
  const recorder = recorderRef.current;
  if (recorder) {
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
  }

  const stream = streamRef.current;
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  recorderRef.current = null;
  streamRef.current = null;
}

async function transcribeAudio({ audioBlob, language }) {
  const audioBase64 = await blobToBase64(audioBlob);
  let response;

  try {
    response = await fetch("/api/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        audioBase64,
        mimeType: audioBlob.type || "audio/webm",
        language
      })
    });
  } catch (error) {
    throw new Error("無法連到 Whisper 服務，請先確認後端已啟動。");
  }

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : payload.detail?.error?.message || payload.error;
    throw new Error(detail || "Whisper 轉錄服務暫時不可用。");
  }

  return payload.transcript || "";
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
    throw new Error("無法連到翻譯服務，請先確認後端已啟動。");
  }

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : payload.detail?.error?.message || payload.error;
    throw new Error(detail || "翻譯服務暫時不可用。");
  }

  return payload.translatedText || "";
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
    throw new Error("無法連到評分服務，請先確認後端已啟動。");
  }

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : payload.detail?.error?.message || payload.error;
    throw new Error(detail || "口說評分服務暫時不可用。");
  }

  return payload.evaluation || null;
}

async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 32_768;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

async function readJsonSafely(response) {
  const raw = await response.text();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`伺服器回傳了無法解析的 JSON，HTTP ${response.status}。`);
  }
}

