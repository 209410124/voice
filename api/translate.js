const { translateText } = require("../lib/openai");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const result = await translateText({
    text: typeof req.body?.text === "string" ? req.body.text : "",
    sourceLanguage: typeof req.body?.sourceLanguage === "string" ? req.body.sourceLanguage : "auto",
    targetLanguage: typeof req.body?.targetLanguage === "string" ? req.body.targetLanguage : "en-US"
  });

  res.status(result.status).json(result.body);
};
