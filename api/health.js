const { getHealthStatus } = require("../lib/openai");

module.exports = async function handler(req, res) {
  res.status(200).json(getHealthStatus());
};
