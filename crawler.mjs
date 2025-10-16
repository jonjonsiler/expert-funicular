#!/usr/bin/env node
/**
 * crawler.mjs
 * 
 * Fetches the root HTML of a domain, extracts <script src="..."> tags,
 * passes each resolved URL to find-flag.mjs, and optionally writes
 * the raw object output to a file (one element per script).
 * 
 * Usage:
 *   node crawler.mjs https://example.com [--json] [--context] [--unique] [--output|-o]
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

const rootUrl = process.argv[2];
if (!rootUrl) {
  console.error("Usage: node crawler.mjs <root-url> [--json] [--context] [--unique] [--output|-o]");
  process.exit(1);
}

// separate the output flag, pass the rest to find-flag.mjs
const rawFlags = process.argv.slice(3);
const outputEnabled = rawFlags.includes("--output") || rawFlags.includes("-o");
const flags = rawFlags.filter(f => f !== "--output" && f !== "-o");

// force JSON mode when writing to file
const jsonFlags = outputEnabled ? [...flags, "--json"] : flags;

async function fetchHtml(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

async function extractScriptSrcs(html, base) {
  const pattern = /<script[^>]+src=["']([^"']+)["']/gi;
  const srcs = new Set();
  let m;
  while ((m = pattern.exec(html)) !== null) {
    try {
      const full = new URL(m[1], base);
      full.search = "";   // strip query params
      full.hash = "";     // strip fragments
      srcs.add(full.href);
    } catch {}
  }
  return Array.from(srcs);
}

async function runFindPairs(url, flags) {
  try {
    const { stdout } = await execFileAsync("node", ["find-flag.mjs", url, ...flags]);
    if (flags.includes("--json")) {
      return JSON.parse(stdout);
    } else {
      return { url, output: stdout.trim() };
    }
  } catch (err) {
    return { url, error: err.message };
  }
}

function getOutputFilename(rootUrl) {
  const domain = new URL(rootUrl).hostname.replace(/^www\./, '');
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return path.join("captures", `${domain} - ${timestamp}.txt`);
}

(async () => {
  try {
    console.log(`Fetching scripts from: ${rootUrl}`);
    const html = await fetchHtml(rootUrl);
    const scripts = await extractScriptSrcs(html, rootUrl);

    if (scripts.length === 0) {
      console.log("No external script tags found.");
      process.exit(0);
    }

    console.log(`Found ${scripts.length} script${scripts.length !== 1 ? "s" : ""}:\n`);
    for (const s of scripts) console.log(" • " + s);
    console.log("\nScanning for key/value pairs...\n");

    const results = [];
    for (const scriptUrl of scripts) {
      const result = await runFindPairs(scriptUrl, jsonFlags);
      results.push(result);
    }

    // console output (only if not in output-only mode)
    if (!outputEnabled) {
      for (const r of results) {
        if (r.error) console.log(`--- ${r.url} ---\nError: ${r.error}\n`);
        else console.log(JSON.stringify(r, null, 2) + "\n");
      }
    }

    // file output if enabled
    if (outputEnabled) {
      if (!fs.existsSync("captures")) fs.mkdirSync("captures");
      const filename = getOutputFilename(rootUrl);
      fs.writeFileSync(filename, JSON.stringify(results, null, 2), "utf-8");
      console.log(`\nResults written to file: ${filename}`);
    }

  } catch (err) {
    console.error("Fatal error:", err.message);
  }
})();