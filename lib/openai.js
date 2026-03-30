const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "";

function getHealthStatus() {
  return {
    ok: Boolean(OPENAI_API_KEY && OPENAI_MODEL),
    server: "online",
    apiKeyConfigured: Boolean(OPENAI_API_KEY),
    modelConfigured: Boolean(OPENAI_MODEL),
    model: OPENAI_MODEL || null
  };
}

async function translateText({ text, sourceLanguage = "auto", targetLanguage = "en-US" }) {
  if (!text || !text.trim()) {
    return {
      status: 400,
      body: { error: "Missing text" }
    };
  }

  if (!OPENAI_API_KEY) {
    return {
      status: 503,
      body: {
        error: "OPENAI_API_KEY is not configured",
        detail: "Copy .env.example to .env and set your API key to enable translation."
      }
    };
  }

  if (!OPENAI_MODEL) {
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
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
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

module.exports = {
  getHealthStatus,
  translateText
};
