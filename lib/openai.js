function getConfig() {
  return {
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || process.env.OPENAI_MODEL || "",
    textModel: process.env.OPENAI_TEXT_MODEL || ""
  };
}

function getHealthStatus() {
  const { openAiApiKey, transcriptionModel, textModel } = getConfig();
  return {
    ok: Boolean(openAiApiKey && transcriptionModel && textModel),
    server: "online",
    apiKeyConfigured: Boolean(openAiApiKey),
    transcriptionModelConfigured: Boolean(transcriptionModel),
    textModelConfigured: Boolean(textModel),
    modelConfigured: Boolean(transcriptionModel && textModel),
    transcriptionModel: transcriptionModel || null,
    textModel: textModel || null,
    model: textModel || transcriptionModel || null
  };
}

async function transcribeAudio({ audioBase64, mimeType = "audio/webm", language = "" }) {
  const { openAiApiKey, transcriptionModel } = getConfig();

  if (!audioBase64) {
    return {
      status: 400,
      body: { error: "Missing audio" }
    };
  }

  if (!openAiApiKey) {
    return {
      status: 503,
      body: {
        error: "OPENAI_API_KEY is not configured",
        detail: "Set OPENAI_API_KEY in .env to enable audio transcription."
      }
    };
  }

  if (!transcriptionModel) {
    return {
      status: 503,
      body: {
        error: "OPENAI_TRANSCRIPTION_MODEL is not configured",
        detail: "Set OPENAI_TRANSCRIPTION_MODEL in .env. For Whisper, use whisper-1."
      }
    };
  }

  const extension = getAudioExtension(mimeType);
  const audioBuffer = Buffer.from(audioBase64, "base64");
  const formData = new FormData();
  const audioBlob = new Blob([audioBuffer], { type: mimeType || "audio/webm" });

  formData.append("file", audioBlob, `recording.${extension}`);
  formData.append("model", transcriptionModel);
  formData.append("response_format", "json");
  formData.append("temperature", "0");
  formData.append("prompt", "Transcribe only the spoken words. Do not guess, do not invent missing content, and return an empty result if the audio is unclear.");
  if (language && language !== "auto") {
    formData.append("language", normalizeLanguage(language));
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`
    },
    body: formData
  });

  const payload = await readJsonResponseSafely(response);
  if (!response.ok) {
    return {
      status: response.status,
      body: {
        error: "Transcription request failed",
        detail: formatOpenAiError(payload)
      }
    };
  }

  return {
    status: 200,
    body: {
      transcript: sanitizeTranscript(typeof payload.text === "string" ? payload.text : "")
    }
  };
}

async function translateText({ text, sourceLanguage = "auto", targetLanguage = "en-US" }) {
  const { openAiApiKey, textModel } = getConfig();
  if (!text || !text.trim()) {
    return {
      status: 400,
      body: { error: "Missing text" }
    };
  }

  if (!openAiApiKey) {
    return {
      status: 503,
      body: {
        error: "OPENAI_API_KEY is not configured",
        detail: "Set OPENAI_API_KEY in .env to enable translation."
      }
    };
  }

  if (!textModel) {
    return {
      status: 503,
      body: {
        error: "OPENAI_TEXT_MODEL is not configured",
        detail: "Set OPENAI_TEXT_MODEL in .env to the OpenAI text model you want to use."
      }
    };
  }

  const prompt = [
    "You are a live interpreter.",
    "Translate the input text naturally and concisely.",
    "Preserve names, numbers, and formatting where possible.",
    "Return only the translated text without explanations.",
    `Source language hint: ${sourceLanguage}.`,
    `Target language: ${targetLanguage}.`,
    "",
    text
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`
    },
    body: JSON.stringify({
      model: textModel,
      input: prompt
    })
  });

  const payload = await readJsonResponseSafely(response);
  if (!response.ok) {
    return {
      status: response.status,
      body: {
        error: "Translation request failed",
        detail: formatOpenAiError(payload)
      }
    };
  }

  return {
    status: 200,
    body: {
      translatedText: extractOutputText(payload)
    }
  };
}

async function evaluateSpeech({ transcript, sourceLanguage = "auto", referenceText = "" }) {
  const { openAiApiKey, textModel } = getConfig();
  if (!transcript || !transcript.trim()) {
    return {
      status: 400,
      body: { error: "Missing transcript" }
    };
  }

  if (!openAiApiKey) {
    return {
      status: 503,
      body: {
        error: "OPENAI_API_KEY is not configured",
        detail: "Set OPENAI_API_KEY in .env to enable evaluation."
      }
    };
  }

  if (!textModel) {
    return {
      status: 503,
      body: {
        error: "OPENAI_TEXT_MODEL is not configured",
        detail: "Set OPENAI_TEXT_MODEL in .env to the OpenAI text model you want to use."
      }
    };
  }

  const prompt = [
    "You are a speaking coach.",
    referenceText
      ? "Evaluate how well the learner repeated the target sentence."
      : "Evaluate the speaker based only on the transcribed text.",
    "Give a practical estimate of fluency, clarity, completeness, vocabulary, and grammar.",
    "Make the feedback feel similar to IELTS and TOEIC speaking coaching.",
    "If a target sentence is provided, compare the learner transcript with it and comment on similarity and missing words.",
    "Respond in JSON with keys: overallScore, ieltsBand, toeicEstimate, fluency, clarity, completeness, vocabulary, grammar, pronunciationNote, summary, suggestions.",
    "overallScore must be an integer from 0 to 100.",
    "ieltsBand must be a string like '6.5'.",
    "toeicEstimate must be a string range like '120-150'.",
    "fluency, clarity, completeness, vocabulary, grammar, pronunciationNote must be short strings.",
    "summary must be one sentence.",
    "suggestions must be an array of 3 short actionable strings.",
    `Language hint: ${sourceLanguage}.`,
    referenceText ? `Target sentence:\n${referenceText}` : "",
    "Learner transcript:",
    "",
    transcript
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`
    },
    body: JSON.stringify({
      model: textModel,
      input: prompt
    })
  });

  const payload = await readJsonResponseSafely(response);
  if (!response.ok) {
    return {
      status: response.status,
      body: {
        error: "Evaluation request failed",
        detail: formatOpenAiError(payload)
      }
    };
  }

  const evaluation = extractJsonObject(extractOutputText(payload));
  if (!evaluation) {
    return {
      status: 502,
      body: {
        error: "Evaluation parsing failed",
        detail: "The model returned a response that was not valid JSON."
      }
    };
  }

  return {
    status: 200,
    body: { evaluation }
  };
}

function formatOpenAiError(payload) {
  const apiError = payload && payload.error ? payload.error : null;
  if (!apiError) {
    return payload;
  }

  if (apiError.code === "insufficient_quota") {
    return "OpenAI API �B�פ����C���ˬd billing �� credits�C";
  }

  if (apiError.code === "invalid_api_key") {
    return "OpenAI API key �L�ġC�нT�{ .env ���� OPENAI_API_KEY�C";
  }

  if (apiError.code === "model_not_found") {
    return "�䤣����w�ҫ��C�нT�{ .env �����ҫ��W�٬O�_���T�C";
  }

  return apiError.message || payload;
}

async function readJsonResponseSafely(response) {
  const raw = await response.text();
  if (!raw) {
    return {
      error: "Empty upstream response"
    };
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return {
      error: "Invalid upstream JSON",
      detail: raw.slice(0, 500)
    };
  }
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const segments = [];

  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (part && typeof part.text === "string") {
        segments.push(part.text);
      }
    }
  }

  return segments.join("\n").trim();
}

function extractJsonObject(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (nestedError) {
      return null;
    }
  }
}

function getAudioExtension(mimeType) {
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
    return "m4a";
  }

  if (mimeType.includes("mpeg")) {
    return "mp3";
  }

  if (mimeType.includes("wav")) {
    return "wav";
  }

  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  return "webm";
}

function normalizeLanguage(language) {
  return String(language).split("-")[0].toLowerCase();
}

function sanitizeTranscript(text) {
  if (!text || typeof text !== "string") {
    return "";
  }

  const noisePatterns = [
    /字幕由\s*Amara\.org\s*(?:社区|社群|community)?\s*提供/gi,
    /Subtitles?\s+by\s+Amara\.org\s+Community/gi,
    /Caption(?:s)?\s+by\s+Amara\.org\s+Community/gi,
    /Amara\.org/gi
  ];

  let cleaned = text;
  for (const pattern of noisePatterns) {
    cleaned = cleaned.replace(pattern, " ");
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

module.exports = {
  getHealthStatus,
  transcribeAudio,
  translateText,
  evaluateSpeech
};
