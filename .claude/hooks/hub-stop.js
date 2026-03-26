#!/usr/bin/env node
/**
 * hub-stop.js — Stop hook for Work-Down managed Claude sessions.
 *
 * Only signals Hub when Work-Down specific env vars are present.
 * Outside Work-Down dispatched sessions, this hook is a no-op.
 */

const fs = require("fs");
const http = require("http");
const https = require("https");

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf-8"));
  } catch {
    return {};
  }
}

function postJson(urlString, payload, callback) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    callback();
    return;
  }

  const body = JSON.stringify(payload);
  const client = url.protocol === "https:" ? https : http;
  const req = client.request(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    },
    (res) => {
      res.resume();
      res.on("end", callback);
    }
  );

  req.on("error", callback);
  req.write(body);
  req.end();
}

function main() {
  const apiBase = process.env.HUB_API_BASE || "";
  const sessionId = process.env.HUB_SESSION_ID || "";
  const jobId = process.env.HUB_JOB_ID || "";

  if (!apiBase || !sessionId || !jobId) {
    process.exit(0);
  }

  const input = readInput();
  postJson(
    new URL("/api/hooks/stop-ready", apiBase).toString(),
    {
      sessionId,
      jobId,
      reason: input.reason || "stop_hook",
    },
    () => process.exit(0)
  );
}

main();
