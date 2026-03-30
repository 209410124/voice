function getConfig() {
  return {
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    openAiModel: process.env.OPENAI_MODEL || ""
  };
}

function getHealthStatus() {
  const { openAiApiKey, openAiModel } = getConfig();
  return {
    ok: Boolean(openAiApiKey && openAiModel),
    server: "online",
    apiKeyConfigured: Boolean(openAiApiKey),
    modelConfigured: Boolean(openAiModel),
    model: openAiModel || null
  };
}

async function translateText({ text, sourceLanguage = "auto", targetLanguage = "en-US" }) {
  const { openAiApiKey, openAiModel } = getConfig();
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
        detail: "Copy .env.example to .env and set your API key to enable translation."
      }
    };
  }

  if (!openAiModel) {
    return {
      status: 503,
      body: {
        error: "OPENAI_MODEL is not configured",
        detail: "Set OPENAI_MODEL in .env to the OpenAI model you want to use."
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
      model: openAiModel,
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
  const { openAiApiKey, openAiModel } = getConfig();
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
        detail: "Copy .env.example to .env and set your API key to enable evaluation."
      }
    };
  }

  if (!openAiModel) {
    return {
      status: 503,
      body: {
        error: "OPENAI_MODEL is not configured",
        detail: "Set OPENAI_MODEL in .env to the OpenAI model you want to use."
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
      model: openAiModel,
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
        detail: "模型回傳了無法解析的評估內容。"
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
    return "OpenAI API 額度不足。請檢查 billing、credits 或專案配額。";
  }

  if (apiError.code === "invalid_api_key") {
    return "OpenAI API key 無效。請確認 `.env` 中的 OPENAI_API_KEY。";
  }

  if (apiError.code === "model_not_found") {
    return "找不到指定模型。請確認 `.env` 中的 OPENAI_MODEL 是否正確。";
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

module.exports = {
  getHealthStatus,
  translateText,
  evaluateSpeech
};
