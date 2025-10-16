// find-flag.mjs
// Extracts .post(...).set("x-api-key", ...) pairs from remote JS
// Flags:
//   --unique      show only unique [url, key] pairs
//   --json        output as JSON
//   --context=N   show N chars of surrounding context
// Usage:
//   node find-flag.mjs <URL> [--unique] [--json] [--context=40]

async function getFetch() {
  if (typeof fetch === "function") return fetch;
  try {
    const mod = await import("node-fetch");
    return mod.default ?? mod;
  } catch {
    console.error("Install node-fetch: npm i node-fetch@2");
    process.exit(1);
  }
}

function parseArgs(argv) {
  const args = { flags: {}, url: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      args.flags[k] = v || true;
    } else if (!args.url) args.url = a;
  }
  return args;
}

function findPostKeyPairs(text) {
  const regex =
    /\.post\s*\(\s*(['"])(.*?)\1\s*\)\s*\.set\s*\(\s*['"]x-api-key['"]\s*,\s*(['"])(.*?)\3/gi;
  const matches = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    matches.push({
      url: m[2],
      key: m[4],
      index: m.index,
    });
  }
  return matches;
}

function enrichWithLineNumbers(text, matches) {
  const lines = text.split(/\r?\n/);
  const lineStarts = [];
  let pos = 0;
  for (const line of lines) {
    lineStarts.push(pos);
    pos += line.length + 1;
  }
  function idxToLine(idx) {
    let lo = 0,
      hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= idx) {
        if (mid === lineStarts.length - 1 || lineStarts[mid + 1] > idx)
          return mid + 1;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return 1;
  }
  return matches.map((m) => ({ ...m, line: idxToLine(m.index) }));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.url) {
    console.error(
      "Usage: node find-pairs.mjs <URL> [--unique] [--json] [--context=40]"
    );
    process.exit(2);
  }

  const fetchFn = await getFetch();
  const res = await fetchFn(args.url);
  if (!res.ok) {
    console.error(`Fetch failed: ${res.status} ${res.statusText}`);
    process.exit(3);
  }

  const text = await res.text();
  const rawPairs = findPostKeyPairs(text);
  const withLines = enrichWithLineNumbers(text, rawPairs);

  let results = withLines;

  // handle unique flag
  if (args.flags.unique) {
    const seen = new Set();
    const uniq = [];
    for (const p of withLines) {
      const id = `${p.url}::${p.key}`;
      if (!seen.has(id)) {
        seen.add(id);
        uniq.push(p);
      }
    }
    results = uniq;
  }

  const ctxChars = args.flags.context ? parseInt(args.flags.context, 10) : 0;
  results = results.map((p) => {
    let ctx = null;
    if (ctxChars > 0) {
      const start = Math.max(0, p.index - ctxChars);
      const end = Math.min(text.length, p.index + ctxChars + 40);
      ctx = text.slice(start, end).replace(/\r?\n/g, "⏎");
    }
    return { ...p, context: ctx };
  });

  // Output
  if (args.flags.json) {
    console.log(
      JSON.stringify(
        { url: args.url, count: results.length, pairs: results },
        null,
        2
      )
    );
    return;
  }

  console.log(`Fetched: ${args.url}`);
  console.log(
    `Found ${results.length} ${
      args.flags.unique ? "unique " : ""
    }.post/.set("x-api-key") pair(s).\n`
  );

  for (const p of results) {
    console.log(`URL: ${p.url}`);
    console.log(`KEY: ${p.key}`);
    console.log(`Line: ${p.line}`);
    if (p.context) console.log(`Context: ...${p.context}...\n`);
    else console.log("");
  }
}

main();