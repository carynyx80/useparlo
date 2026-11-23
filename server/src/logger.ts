import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: "parlo-server" },
  redact: {
    paths: [
      "RELAYER_PRIVATE_KEY",
      "REPORTER_PRIVATE_KEY",
      "*.RELAYER_PRIVATE_KEY",
      "*.REPORTER_PRIVATE_KEY",
      "privateKey",
      "*.privateKey",
      "headers.authorization",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
});
