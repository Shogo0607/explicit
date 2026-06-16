import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const port = 4317;
const envDir = await mkdtemp(path.join(tmpdir(), "qa-answer-assistant-"));
const settingsEnvFile = path.join(envDir, ".env.local");
const dataDir = path.join(envDir, "data");
const child = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: String(port), OPENAI_API_KEY: "", OPENAI_DISABLED: "1", SETTINGS_ENV_FILE: settingsEnvFile, DATA_DIR: dataDir },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer(port);
  const health = await fetchJson(`http://localhost:${port}/api/health`);
  assert.equal(health.ok, true);
  assert.equal(health.hasKey, false);
  assert.equal(health.provider, "openai");

  const initialSettings = await fetchJson(`http://localhost:${port}/api/settings`);
  assert.equal(initialSettings.provider, "openai");
  assert.equal(initialSettings.hasOpenAIKey, false);
  assert.equal(initialSettings.openaiBaseUrl, "https://api.openai.com/v1");

  const updatedSettings = await putJson(`http://localhost:${port}/api/settings`, {
    provider: "azure",
    openaiBaseUrl: "https://proxy.example/v1/",
    azureBaseUrl: "https://example-resource.openai.azure.com/openai/v1/",
    azureApiVersion: "preview",
    azureApiKey: "test-azure-key"
  });
  assert.equal(updatedSettings.provider, "azure");
  assert.equal(updatedSettings.hasAzureKey, true);
  assert.equal(updatedSettings.azureBaseUrl, "https://example-resource.openai.azure.com/openai/v1");
  assert.equal(updatedSettings.openaiBaseUrl, "https://proxy.example/v1");

  const azureHealth = await fetchJson(`http://localhost:${port}/api/health`);
  assert.equal(azureHealth.provider, "azure");
  assert.equal(azureHealth.hasKey, false);

  const workspaces = await fetchJson(`http://localhost:${port}/api/workspaces`);
  assert.ok(workspaces.workspaces.some((workspace) => workspace.id === "support"));

  const billingWorkspace = await postJson(`http://localhost:${port}/api/workspaces`, {
    label: "請求・課金",
    description: "請求問い合わせの検証用"
  });
  assert.equal(billingWorkspace.workspace.label, "請求・課金");
  assert.equal(billingWorkspace.map.workspaceId, billingWorkspace.workspace.id);

  const billingMaps = await fetchJson(`http://localhost:${port}/api/maps?workspaceId=${encodeURIComponent(billingWorkspace.workspace.id)}`);
  assert.ok(billingMaps.maps.every((map) => map.workspaceId === billingWorkspace.workspace.id));
  assert.ok(billingMaps.maps.some((map) => map.id === billingWorkspace.map.id));

  const aliasHtml = await fetchOk(`http://localhost:${port}/assistant.html`).then((r) => r.text());
  assert.match(aliasHtml, /回答アシスタント/);

  const html = await fetchOk(`http://localhost:${port}/%E5%9B%9E%E7%AD%94%E3%82%A2%E3%82%B7%E3%82%B9%E3%82%BF%E3%83%B3%E3%83%88.dc.html`).then((r) => r.text());
  assert.match(html, /回答アシスタント/);
  assert.match(html, /app\.js/);

  const missing = await fetch(`http://localhost:${port}/missing.js`);
  assert.equal(missing.status, 404);
  const leakedEnv = await fetch(`http://localhost:${port}/.env.local`);
  assert.equal(leakedEnv.status, 404);

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
    rows: [
      { customer_message: "SMSが届かない", agent_reply: "再送してください", category: "認証" },
      { customer_message: "改行つきの問い合わせ", agent_reply: "引用符\"を含む回答", category: "認証" },
      { customer_message: "Webhookが発火しません", agent_reply: "配信ログを確認してください", category: "API" }
    ],
    settings: { abstraction: "high", integrateExisting: true, dedupe: true },
    totalRows: 3
  });
  assert.equal(csv.source, "fallback");
  assert.equal(csv.mapping.question, "customer_message");
  assert.equal(csv.mapping.answer, "agent_reply");
  assert.equal(csv.mapping.category, "category");
  assert.equal(csv.preview.length, 3);
  assert.ok(csv.clusters.length > 0);
  assert.equal(csv.settings.abstraction, "high");
  assert.ok(csv.clusters.some((cluster) => Array.isArray(cluster.sourceQa) && cluster.sourceQa.length > 0));

  const imported = await postJson(`http://localhost:${port}/api/maps/import`, {
    title: "CSV取り込みマップ",
    clusters: csv.clusters,
    workspaceId: "support"
  });
  assert.equal(imported.map.label, "CSV取り込みマップ");
  assert.equal(imported.map.workspaceId, "support");
  assert.ok(imported.map.id);
  assert.ok(imported.map.nodes.some((node) => node.title === "Webhookが発火しない"));
  assert.ok(imported.map.nodes.some((node) => Array.isArray(node.sourceQa) && node.sourceQa.length > 0));
  const webhookNode = imported.map.nodes.find((node) => node.title === "Webhookが発火しない");
  assert.equal(webhookNode.status, "review");

  const persisted = JSON.parse(await readFile(path.join(dataDir, "maps.json"), "utf8"));
  assert.ok(persisted.maps.some((map) => map.id === imported.map.id));

  const maps = await fetchJson(`http://localhost:${port}/api/maps`);
  assert.ok(maps.maps.some((map) => map.id === imported.map.id));
  const mapSummary = maps.maps.find((map) => map.id === imported.map.id);
  assert.ok(mapSummary.reviewCount > 0);

  const mapDetail = await fetchJson(`http://localhost:${port}/api/maps/${imported.map.id}`);
  assert.equal(mapDetail.map.id, imported.map.id);
  assert.ok(mapDetail.map.nodes.some((node) => node.status === "review"));
  assert.ok(mapDetail.map.edges.every((edge) => edge.id));

  const createdNode = await postJson(`http://localhost:${port}/api/maps/login-auth/nodes`, {
    title: "テスト用の追加確認",
    type: "question",
    status: "review",
    rootCause: "判断ノードには残さない原因",
    answer: "判断ノードには残さない回答",
    escalation: "判断ノードには残さない条件",
    parentId: "root",
    edgeLabel: "テスト"
  });
  assert.equal(createdNode.node.title, "テスト用の追加確認");
  assert.equal(createdNode.node.rootCause, "");
  assert.equal(createdNode.node.answer, "");
  assert.equal(createdNode.node.escalation, "");
  assert.ok(createdNode.map.edges.some((edge) => edge.to === createdNode.node.id && edge.label === "テスト"));

  const createdLeaf = await postJson(`http://localhost:${port}/api/maps/login-auth/nodes`, {
    title: "テスト用の根本原因",
    type: "leaf",
    status: "review",
    nextQuestion: "終端ノードには残さない追加質問",
    answer: "テスト用の回答案です。",
    parentId: "q1",
    edgeLabel: "原因"
  });
  assert.equal(createdLeaf.node.rootCause, "テスト用の根本原因");
  assert.equal(createdLeaf.node.nextQuestion, "");

  const createdEdge = await postJson(`http://localhost:${port}/api/maps/login-auth/edges`, {
    from: createdNode.node.id,
    to: "q1",
    label: "戻す",
    condition: "テスト条件"
  });
  assert.equal(createdEdge.edge.from, createdNode.node.id);
  assert.equal(createdEdge.edge.to, "q1");

  const updatedEdge = await putJson(`http://localhost:${port}/api/maps/login-auth/edges/${createdEdge.edge.id}`, {
    from: createdNode.node.id,
    to: "q1",
    label: "更新済み",
    condition: "更新条件"
  });
  assert.equal(updatedEdge.edge.label, "更新済み");

  const positionedNode = await putJson(`http://localhost:${port}/api/maps/login-auth/nodes/${createdNode.node.id}`, {
    position: { x: 320, y: 180 }
  });
  assert.deepEqual(positionedNode.node.position, { x: 320, y: 180 });

  const deletedEdge = await deleteJson(`http://localhost:${port}/api/maps/login-auth/edges/${createdEdge.edge.id}`);
  assert.equal(deletedEdge.deleted.type, "edge");
  const deletedLeaf = await deleteJson(`http://localhost:${port}/api/maps/login-auth/nodes/${createdLeaf.node.id}`);
  assert.equal(deletedLeaf.deleted.type, "node");
  const deletedNode = await deleteJson(`http://localhost:${port}/api/maps/login-auth/nodes/${createdNode.node.id}`);
  assert.equal(deletedNode.deleted.type, "node");

  const prePublishAnswer = await postJson(`http://localhost:${port}/api/answer`, { query: "Webhookが発火しません。イベントが送信されないです" });
  assert.notEqual(prePublishAnswer.mapId, imported.map.id);

  const publishedNode = await putJson(`http://localhost:${port}/api/maps/${imported.map.id}/nodes/${webhookNode.id}`, {
    status: "published",
    title: webhookNode.title,
    rootCause: webhookNode.rootCause,
    answer: webhookNode.answer,
    escalation: webhookNode.escalation,
    reason: webhookNode.reason
  });
  assert.equal(publishedNode.node.status, "published");

  const webhookAnswer = await postJson(`http://localhost:${port}/api/answer`, { query: "Webhookが発火しません。イベントが送信されないです" });
  assert.equal(webhookAnswer.mapId, imported.map.id);
  assert.equal(webhookAnswer.mapLabel, "CSV取り込みマップ");
  assert.ok(webhookAnswer.path.some((id) => /^c\d+$/.test(id)));
  assert.match(webhookAnswer.answer, /Webhook/);
  assert.ok(Array.isArray(webhookAnswer.evidence));
  assert.ok(webhookAnswer.candidates.some((candidate) => candidate.mapId === imported.map.id));

  const unknownAnswer = await postJson(`http://localhost:${port}/api/answer`, { query: "よくわからない相談です" });
  assert.equal(unknownAnswer.needsFollowup, true);
  assert.ok(unknownAnswer.nextQuestion);

  const feedback = await postJson(`http://localhost:${port}/api/feedback`, { outcome: "unresolved", reason: "cause-mismatch", mapId: webhookAnswer.mapId, path: webhookAnswer.path, cause: webhookAnswer.cause, confidence: webhookAnswer.confidence, source: webhookAnswer.source });
  assert.equal(feedback.ok, true);
  assert.equal(feedback.feedback.reason, "cause-mismatch");

  const improvements = await fetchJson(`http://localhost:${port}/api/improvements`);
  assert.ok(improvements.items.some((item) => item.mapId === imported.map.id && item.nodeId === webhookNode.id));

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
  await rm(envDir, { recursive: true, force: true });
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
  return sendJson("POST", url, body);
}

async function putJson(url, body) {
  return sendJson("PUT", url, body);
}

async function deleteJson(url) {
  return sendJson("DELETE", url);
}

async function sendJson(method, url, body) {
  const options = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) options.body = JSON.stringify(body);
  const response = await fetch(url, options);
  assert.equal(response.ok, true);
  return response.json();
}

async function fetchOk(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response;
}
