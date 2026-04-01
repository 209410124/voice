const { transcribeAudio } = require("../lib/openai");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const result = await transcribeAudio({
    audioBase64: typeof req.body?.audioBase64 === "string" ? req.body.audioBase64 : "",
    mimeType: typeof req.body?.mimeType === "string" ? req.body.mimeType : "audio/webm",
    language: typeof req.body?.language === "string" ? req.body.language : ""
  });

  res.status(result.status).json(result.body);
};
