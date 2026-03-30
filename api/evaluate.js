const { evaluateSpeech } = require("../lib/openai");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const result = await evaluateSpeech({
    transcript: typeof req.body?.transcript === "string" ? req.body.transcript : "",
    sourceLanguage: typeof req.body?.sourceLanguage === "string" ? req.body.sourceLanguage : "auto",
    referenceText: typeof req.body?.referenceText === "string" ? req.body.referenceText : ""
  });

  res.status(result.status).json(result.body);
};
