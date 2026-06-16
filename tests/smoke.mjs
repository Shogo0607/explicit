import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = 4317;
const child = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: String(port), OPENAI_API_KEY: "", OPENAI_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer(port);
  const health = await fetchJson(`http://localhost:${port}/api/health`);
  assert.equal(health.ok, true);
  assert.equal(health.hasKey, false);

  const aliasHtml = await fetchOk(`http://localhost:${port}/assistant.html`).then((r) => r.text());
  assert.match(aliasHtml, /回答アシスタント/);

  const html = await fetchOk(`http://localhost:${port}/%E5%9B%9E%E7%AD%94%E3%82%A2%E3%82%B7%E3%82%B9%E3%82%BF%E3%83%B3%E3%83%88.dc.html`).then((r) => r.text());
  assert.match(html, /回答アシスタント/);
  assert.match(html, /app\.js/);

  const missing = await fetch(`http://localhost:${port}/missing.js`);
  assert.equal(missing.status, 404);

  const emptyAnswer = await fetch(`http://localhost:${port}/api/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "   " })
  });
  assert.equal(emptyAnswer.status, 400);
  assert.equal((await emptyAnswer.json()).error, "query_required");

  const malformedJson = await fetch(`http://localhost:${port}/api/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{"
  });
  assert.equal(malformedJson.status, 400);
  assert.equal((await malformedJson.json()).error, "invalid_json");

  const answer = await postJson(`http://localhost:${port}/api/answer`, { query: "ログイン画面が真っ白で進めません" });
  assert.equal(answer.source, "fallback");
  assert.ok(Array.isArray(answer.path));
  assert.deepEqual(answer.path, ["root", "q1", "q3", "l3"]);
  assert.equal(answer.cause, "キャッシュ／Cookie不整合");
  assert.ok(answer.answer.length > 20);

  const csv = await postJson(`http://localhost:${port}/api/analyze-csv`, {
    columns: ["customer_message", "agent_reply", "category"],
    rows: [{ customer_message: "SMSが届かない", agent_reply: "再送してください", category: "認証" }, { customer_message: "改行つきの問い合わせ", agent_reply: "引用符\"を含む回答", category: "認証" }],
    totalRows: 1
  });
  assert.equal(csv.source, "fallback");
  assert.equal(csv.mapping.question, "customer_message");
  assert.equal(csv.mapping.answer, "agent_reply");
  assert.equal(csv.mapping.category, "category");
  assert.equal(csv.preview.length, 2);
  assert.ok(csv.clusters.length > 0);

  const imported = await postJson(`http://localhost:${port}/api/maps/import`, {
    title: "CSV取り込みマップ",
    clusters: csv.clusters
  });
  assert.equal(imported.map.label, "CSV取り込みマップ");
  assert.ok(imported.map.id);
  assert.ok(imported.map.nodes.some((node) => node.title === "Webhookが発火しない"));

  const maps = await fetchJson(`http://localhost:${port}/api/maps`);
  assert.ok(maps.maps.some((map) => map.id === imported.map.id));

  const webhookAnswer = await postJson(`http://localhost:${port}/api/answer`, { query: "Webhookが発火しません。イベントが送信されないです" });
  assert.equal(webhookAnswer.mapId, imported.map.id);
  assert.equal(webhookAnswer.mapLabel, "CSV取り込みマップ");
  assert.ok(webhookAnswer.path.includes("c3"));
  assert.match(webhookAnswer.answer, /Webhook/);

  const exportedJson = await fetchOk(`http://localhost:${port}/api/maps/${imported.map.id}/export?format=json`).then((r) => r.json());
  assert.equal(exportedJson.id, imported.map.id);

  const exportedCsv = await fetchOk(`http://localhost:${port}/api/maps/${imported.map.id}/export?format=csv`).then((r) => r.text());
  assert.match(exportedCsv, /map_id,map_label,node_id/);
  assert.match(exportedCsv, /Webhook/);

  const exportedSkill = await fetchOk(`http://localhost:${port}/api/maps/${imported.map.id}/export?format=skill`).then((r) => r.text());
  assert.match(exportedSkill, /^---\nname: /);
  assert.match(exportedSkill, /description: "/);
  assert.match(exportedSkill, /# CSV取り込みマップ/);
  assert.match(exportedSkill, /## Answer Workflow/);
  assert.match(exportedSkill, /### Webhookが発火しない/);
} finally {
  child.kill();
}

async function waitForServer(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("server did not start");
}

async function fetchJson(url) {
  return fetchOk(url).then((response) => response.json());
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.ok, true);
  return response.json();
}

async function fetchOk(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response;
}
