import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_DISABLED = /^(1|true|yes)$/i.test(process.env.OPENAI_DISABLED || "");

loadEnvFile(path.join(__dirname, ".env.local"));

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const mindMap = {
  id: "login-auth",
  label: "ログイン・認証",
  nodes: [
    { id: "root", type: "symptom", title: "ログインできない" },
    { id: "q1", type: "question", title: "エラーメッセージが表示される？" },
    { id: "q2", type: "question", title: "「パスワードが正しくありません」？" },
    { id: "q3", type: "question", title: "画面が読み込まれない？" },
    { id: "l1", type: "leaf", title: "パスワード失念", answer: "パスワードをお忘れの可能性が高いです。サインイン画面の「パスワードを忘れた方」からリセット用メールを送信いただくよう案内してください。届かない場合は迷惑メールフォルダと、登録メールアドレスをご確認ください。" },
    { id: "l2", type: "leaf", title: "アカウントロック", answer: "試行回数の超過による一時ロックです。30分ほど待ってから再試行いただくか、お急ぎの場合は管理コンソールの「ユーザー管理」から手動でロックを解除してください。" },
    { id: "l3", type: "leaf", title: "キャッシュ／Cookie不整合", answer: "ブラウザのキャッシュ／Cookieが原因の可能性が高いです。シークレットウィンドウでの再試行、または該当サイトのキャッシュ削除をご案内ください。" },
    { id: "l4", type: "leaf", title: "SSO／IdP障害", answer: "SSO／IdP（連携先）側の障害が疑われます。同時刻に複数ユーザーで発生していないかを確認し、該当する場合は社内管理者へエスカレーションのうえ、IdPのステータスページをご確認ください。" }
  ],
  edges: [
    { from: "root", to: "q1" },
    { from: "q1", to: "q2", label: "はい" },
    { from: "q1", to: "q3", label: "いいえ" },
    { from: "q2", to: "l1", label: "はい" },
    { from: "q2", to: "l2", label: "いいえ" },
    { from: "q3", to: "l3", label: "はい" },
    { from: "q3", to: "l4", label: "いいえ" }
  ]
};

const mapsStore = new Map();
mapsStore.set(mindMap.id, { ...mindMap, source: "builtin" });

const routesSeed = [
  { title: "2段階認証のコードが届かない", size: 58, sample: "SMSの認証コードがいつまでも届きません", action: "append", target: "ログイン・認証", confidence: 92, reason: "既存の認証フローの分岐として「コード未着」リーフを追加できます。" },
  { title: "請求書PDFがダウンロードできない", size: 41, sample: "請求書のPDFを開こうとするとエラーになります", action: "append", target: "請求・課金", confidence: 88, reason: "既存「請求・課金」マップの出力系トラブルとして接続可能です。" },
  { title: "Webhookが発火しない", size: 36, sample: "イベントが起きてもWebhookが送信されません", action: "create", target: "API・連携", confidence: 95, reason: "既存マップとの類似度が低いため、新規マップとして独立させるのが適切です。" },
  { title: "管理者権限を別メンバーへ委譲したい", size: 29, sample: "管理者を他の人に変更する方法を教えてください", action: "append", target: "権限・共有", confidence: 84, reason: "既存「権限・共有」マップにロール変更の分岐として追加できます。" },
  { title: "アプリが起動直後に落ちる", size: 24, sample: "モバイルアプリを開くとすぐ強制終了します", action: "create", target: "モバイル不具合", confidence: 91, reason: "モバイル固有の事象で既存マップに当てはまりません。" }
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") return redirect(res, "/assistant.html");
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, hasKey: Boolean(process.env.OPENAI_API_KEY) && !OPENAI_DISABLED, model: MODEL });
    if (req.method === "POST" && url.pathname === "/api/answer") return await handleAnswer(req, res);
    if (req.method === "POST" && url.pathname === "/api/analyze-csv") return await handleCsv(req, res);
    if (req.method === "GET" && url.pathname === "/api/maps") return handleListMaps(res);
    if (req.method === "POST" && url.pathname === "/api/maps/import") return await handleImportMap(req, res);
    if (req.method === "GET" && url.pathname.startsWith("/api/maps/")) return handleExportMap(url, res);
    if (req.method === "GET") return await serveStatic(url.pathname, res);
    json(res, 404, { error: "not_found" });
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "not_found" });
    if (error.message === "request_too_large") return json(res, 413, { error: "request_too_large" });
    if (error instanceof SyntaxError) return json(res, 400, { error: "invalid_json" });
    json(res, 500, { error: "server_error", message: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`回答アシスタント running at http://localhost:${PORT}`);
});

async function handleAnswer(req, res) {
  const body = await readJson(req);
  const query = String(body.query || "").trim();
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  if (!query) return json(res, 400, { error: "query_required" });

  const fallback = heuristicAnswer(query);
  const selectedMap = mapsStore.get(fallback.mapId) || mindMap;
  const prompt = [
    "あなたはカスタマーサポートの回答アシスタントです。",
    "与えられたマインドマップだけを主な根拠に、質問に対して辿るべきpath、根本原因、回答案をJSONで返してください。",
    "JSON keys: mapLabel, confidence, path, cause, answer, nextQuestion, rationale。",
    "pathはマインドマップ内のnode id配列です。最終原因に到達できる場合はleafまで含めてください。",
    `マインドマップ: ${JSON.stringify(selectedMap)}`,
    `会話履歴: ${JSON.stringify(history)}`,
    `質問: ${query}`
  ].join("\n");

  const ai = await callOpenAI(prompt, fallback);
  json(res, 200, {
    source: ai.usedOpenAI ? "openai" : "fallback",
    ...normalizeAnswer(ai.data, fallback, selectedMap)
  });
}

async function handleCsv(req, res) {
  const body = await readJson(req, 2_000_000);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 60) : [];
  const columns = Array.isArray(body.columns) ? body.columns : [];
  const fallback = {
    columns,
    mapping: detectMapping(columns),
    preview: rows.slice(0, 5),
    clusters: routesSeed,
    summary: { totalRows: Number(body.totalRows || rows.length), appendCount: 3, newCount: 2, reflectedQa: 188 }
  };

  const prompt = [
    "あなたはQ&AログからFAQと判断木更新候補を抽出するアナリストです。",
    "CSVの列、サンプル行、既存マップを見て、列マッピングと、既存マップに追加するか新規作成するかの提案をJSONで返してください。",
    "JSON keys: mapping {question, answer, category}, clusters [{title,size,sample,action,target,confidence,reason}], summary {totalRows, appendCount, newCount, reflectedQa}。",
    `既存マップ: ${JSON.stringify(mindMap)}`,
    `列: ${JSON.stringify(columns)}`,
    `行サンプル: ${JSON.stringify(rows.slice(0, 12))}`
  ].join("\n");

  const ai = await callOpenAI(prompt, fallback);
  const data = ai.data && typeof ai.data === "object" ? ai.data : fallback;
  json(res, 200, {
    source: ai.usedOpenAI ? "openai" : "fallback",
    columns,
    mapping: data.mapping || fallback.mapping,
    preview: rows.slice(0, 5),
    clusters: Array.isArray(data.clusters) && data.clusters.length ? data.clusters.slice(0, 8).map(normalizeCluster) : fallback.clusters,
    summary: data.summary || fallback.summary
  });
}

function handleListMaps(res) {
  const maps = [...mapsStore.values()].map((map) => ({
    id: map.id,
    label: map.label,
    source: map.source || "imported",
    nodeCount: map.nodes.length,
    leafCount: map.nodes.filter((node) => node.type === "leaf").length
  }));
  json(res, 200, { maps });
}

async function handleImportMap(req, res) {
  const body = await readJson(req, 2_000_000);
  const title = String(body.title || "CSV取り込みマップ").trim();
  const clusters = Array.isArray(body.clusters) ? body.clusters.map(normalizeCluster).slice(0, 24) : [];
  if (!clusters.length) return json(res, 400, { error: "clusters_required" });
  const map = buildImportedMap(title, clusters);
  mapsStore.set(map.id, map);
  json(res, 200, { map });
}

function handleExportMap(url, res) {
  const parts = url.pathname.split("/").filter(Boolean);
  const mapId = decodeURIComponent(parts[2] || "");
  const map = mapsStore.get(mapId);
  if (!map) return json(res, 404, { error: "map_not_found" });
  const format = String(url.searchParams.get("format") || "json").toLowerCase();
  if (format === "csv") return text(res, 200, mapToCsv(map), "text/csv; charset=utf-8", `${map.id}.csv`);
  if (format === "skill" || format === "md" || format === "skill.md") return text(res, 200, mapToSkillMd(map), "text/markdown; charset=utf-8", "SKILL.md");
  return text(res, 200, JSON.stringify(map, null, 2), "application/json; charset=utf-8", `${map.id}.json`);
}

function buildImportedMap(title, clusters) {
  const id = uniqueMapId(slugify(title || "csv-map"));
  const nodes = [{ id: "root", type: "symptom", title }];
  const edges = [];
  for (const [idx, cluster] of clusters.entries()) {
    const nodeId = `c${idx + 1}`;
    nodes.push({
      id: nodeId,
      type: "leaf",
      title: cluster.title,
      answer: buildClusterAnswer(cluster),
      sample: cluster.sample,
      target: cluster.target,
      action: cluster.action,
      confidence: cluster.confidence,
      reason: cluster.reason,
      size: cluster.size
    });
    edges.push({ from: "root", to: nodeId, label: cluster.action === "create" ? "新規" : "追加" });
  }
  return { id, label: title, source: "csv-import", createdAt: new Date().toISOString(), nodes, edges };
}

function buildClusterAnswer(cluster) {
  const actionText = cluster.action === "create" ? "新規マップとして扱う候補です。" : `既存マップ「${cluster.target}」へ追加する候補です。`;
  const sampleText = cluster.sample ? `代表例は「${cluster.sample}」です。` : "";
  return `${cluster.title} に関する問い合わせです。${actionText}${sampleText} まず事象の再現条件、対象ユーザー、発生時刻、関連ログを確認し、既知手順で解消しない場合は担当チームへエスカレーションしてください。`;
}

function normalizeCluster(cluster) {
  const rawAction = String(cluster.action || cluster.recommended || "").toLowerCase();
  const action = /new|create|新規/.test(rawAction) ? "create" : "append";
  let target = cluster.target;
  if (target && typeof target === "object") target = target.name || target.title || target.label || target.id;
  if (!target) target = action === "append" ? "ログイン・認証" : cluster.title || "新規マップ";
  let confidence = Number(cluster.confidence ?? cluster.conf ?? 80);
  if (confidence > 0 && confidence <= 1) confidence = Math.round(confidence * 100);
  return {
    title: String(cluster.title || cluster.topic || "未分類クラスタ"),
    size: Number(cluster.size || cluster.count || 1),
    sample: String(cluster.sample || cluster.example || ""),
    action,
    target: String(target),
    confidence: Math.max(0, Math.min(100, Math.round(confidence || 80))),
    reason: String(cluster.reason || cluster.rationale || "既存マップとの類似度と回答方針から判定しました。")
  };
}

async function callOpenAI(input, fallback) {
  const key = process.env.OPENAI_API_KEY;
  if (OPENAI_DISABLED) return { usedOpenAI: false, data: fallback };
  if (!key) return { usedOpenAI: false, data: fallback };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        input,
        temperature: 0.2,
        text: { format: { type: "json_object" } }
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || `OpenAI HTTP ${response.status}`);
    const text = payload.output_text || extractOutputText(payload);
    return { usedOpenAI: true, data: JSON.parse(text) };
  } catch (error) {
    return { usedOpenAI: false, data: { ...fallback, aiError: error.message } };
  } finally {
    clearTimeout(timeout);
  }
}

function extractOutputText(payload) {
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function heuristicAnswer(query) {
  const q = query.toLowerCase();
  const imported = findImportedMapMatch(query);
  if (imported) return imported;
  if (/全員|社員全員|sso|idp|障害/.test(query)) {
    return { mapId: mindMap.id, mapLabel: "ログイン・認証", confidence: 88, path: ["root", "q1", "q3", "l4"], cause: "SSO／IdP障害", answer: mindMap.nodes.find((n) => n.id === "l4").answer, nextQuestion: "", rationale: "複数ユーザー同時発生の文脈からSSO/IdP側を優先。" };
  }
  if (/真っ白|読み込|ロード|キャッシュ|cookie/.test(query)) {
    return { mapId: mindMap.id, mapLabel: "ログイン・認証", confidence: 91, path: ["root", "q1", "q3", "l3"], cause: "キャッシュ／Cookie不整合", answer: mindMap.nodes.find((n) => n.id === "l3").answer, nextQuestion: "", rationale: "画面読み込み不良はキャッシュ不整合の既存リーフに一致。" };
  }
  if (/ロック|回数|何度/.test(query)) {
    return { mapId: mindMap.id, mapLabel: "ログイン・認証", confidence: 86, path: ["root", "q1", "q2", "l2"], cause: "アカウントロック", answer: mindMap.nodes.find((n) => n.id === "l2").answer, nextQuestion: "", rationale: "試行回数超過の可能性が高い。" };
  }
  return { mapId: mindMap.id, mapLabel: "ログイン・認証", confidence: 90, path: ["root", "q1", "q2", "l1"], cause: "パスワード失念", answer: mindMap.nodes.find((n) => n.id === "l1").answer, nextQuestion: "", rationale: "パスワード不一致の代表的な根本原因。" };
}

function findImportedMapMatch(query) {
  const candidates = [];
  for (const map of mapsStore.values()) {
    if (map.id === mindMap.id) continue;
    for (const node of map.nodes.filter((item) => item.type === "leaf")) {
      const haystack = [node.title, node.sample, node.target, node.reason, node.answer].filter(Boolean).join(" ");
      const score = scoreTextMatch(query, haystack);
      if (score > 0) candidates.push({ map, node, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < 2) return null;
  return {
    mapId: best.map.id,
    mapLabel: best.map.label,
    confidence: Math.min(96, 72 + best.score * 6),
    path: ["root", best.node.id],
    cause: best.node.title,
    answer: best.node.answer,
    nextQuestion: "",
    rationale: `保存済みマップ「${best.map.label}」内のクラスタ「${best.node.title}」に一致しました。`
  };
}

function scoreTextMatch(query, haystack) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedHaystack = normalizeSearchText(haystack);
  let score = 0;
  for (const token of tokenize(normalizedQuery)) {
    if (token.length >= 2 && normalizedHaystack.includes(token)) score += token.length >= 4 ? 2 : 1;
  }
  if (normalizedHaystack.includes(normalizedQuery)) score += 4;
  return score;
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().replace(/[、。・／/（）()[\]\s"'「」]/g, " ");
}

function tokenize(value) {
  const tokens = normalizeSearchText(value).split(/\s+/).filter(Boolean);
  const compact = normalizeSearchText(value).replace(/\s+/g, "");
  if (compact) tokens.push(compact);
  for (const fragment of compact.match(/[a-z0-9]+|[\u30a0-\u30ff]+|[\u3040-\u309f]+|[\u4e00-\u9fff]{2,}/gi) || []) tokens.push(fragment);
  return [...new Set(tokens)];
}

function normalizeAnswer(data, fallback, selectedMap = mindMap) {
  const rawPath = Array.isArray(data?.path) ? data.path : fallback.path;
  const allowed = new Set(selectedMap.nodes.map((node) => node.id));
  const path = rawPath.filter((id) => allowed.has(id));
  let cause = data?.cause || fallback.cause;
  const inferredLeaf = selectedMap.id === mindMap.id ? inferLeafId(cause, data?.answer || fallback.answer) : "";
  if (inferredLeaf && !path.includes(inferredLeaf)) {
    path.splice(0, path.length, ...canonicalPath(inferredLeaf));
  }
  if (inferredLeaf) cause = mindMap.nodes.find((node) => node.id === inferredLeaf)?.title || cause;
  return {
    mapId: selectedMap.id,
    mapLabel: data?.mapLabel || fallback.mapLabel,
    confidence: normalizeConfidence(data?.confidence || fallback.confidence || 80),
    path: path.length ? path : fallback.path,
    cause,
    answer: data?.answer || fallback.answer,
    nextQuestion: data?.nextQuestion || "",
    rationale: data?.rationale || fallback.rationale || ""
  };
}

function normalizeConfidence(value) {
  let confidence = Number(value || 80);
  if (confidence > 0 && confidence <= 1) confidence *= 100;
  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function inferLeafId(cause = "", answer = "") {
  const text = `${cause} ${answer}`;
  if (/パスワード失念|リセットメール|パスワードをお忘れ/.test(text)) return "l1";
  if (/アカウントロック|一時ロック|試行回数/.test(text)) return "l2";
  if (/キャッシュ|Cookie|シークレット/.test(text)) return "l3";
  if (/SSO|IdP|障害|エスカレーション/.test(text)) return "l4";
  return "";
}

function canonicalPath(leafId) {
  const paths = {
    l1: ["root", "q1", "q2", "l1"],
    l2: ["root", "q1", "q2", "l2"],
    l3: ["root", "q1", "q3", "l3"],
    l4: ["root", "q1", "q3", "l4"]
  };
  return paths[leafId] || ["root", "q1"];
}

function detectMapping(columns) {
  const find = (patterns, fallback) => columns.find((col) => patterns.some((p) => p.test(String(col)))) || fallback || columns[0] || "";
  return {
    question: find([/question/i, /customer/i, /message/i, /質問/, /問い合わせ/]),
    answer: find([/answer/i, /reply/i, /agent/i, /回答/], columns[1] || ""),
    category: find([/category/i, /カテゴリ/, /種別/], "")
  };
}

function mapToCsv(map) {
  const rows = [["map_id", "map_label", "node_id", "type", "title", "answer", "target", "action", "confidence", "sample", "reason"]];
  for (const node of map.nodes) {
    rows.push([
      map.id,
      map.label,
      node.id,
      node.type,
      node.title,
      node.answer || "",
      node.target || "",
      node.action || "",
      node.confidence || "",
      node.sample || "",
      node.reason || ""
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function mapToSkillMd(map) {
  const skillName = slugify(map.label || map.id).slice(0, 63) || "support-answer-map";
  const description = `Use when answering customer support questions related to ${map.label}. Route matching questions through this map and cite the selected node answer.`;
  const leaves = map.nodes.filter((node) => node.type === "leaf");
  return `---
name: ${skillName}
description: "${description.replace(/"/g, "'")}"
---

# ${map.label}

Use this skill when a user asks a support question that matches this map. Select the closest node by the user's symptom, sample wording, target area, and reason. If no node fits, say the map does not contain enough information and ask a concise follow-up question.

## Answer Workflow

1. Identify the closest topic under "Map Nodes".
2. Use the node's answer as the primary response.
3. Include escalation guidance when the answer mentions logs, administrators, or responsible teams.
4. Do not invent policy, pricing, contract, security, or account-specific facts that are not present in the node.

## Map Nodes

${leaves.map((node) => `### ${node.title}

- Node ID: \`${node.id}\`
- Target: ${node.target || map.label}
- Action: ${node.action === "create" ? "Create a new map/topic" : "Append to an existing map/topic"}
- Confidence: ${node.confidence || "n/a"}
- Sample: ${node.sample || "n/a"}
- Reason: ${node.reason || "n/a"}
- Answer: ${node.answer || "No answer provided."}
`).join("\n")}
`;
}

function csvCell(value) {
  const textValue = String(value ?? "");
  return /[",\n\r]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
}

function slugify(value) {
  const ascii = String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  return ascii || "csv-import-map";
}

function uniqueMapId(base) {
  let id = base;
  let counter = 2;
  while (mapsStore.has(id)) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  return id;
}

async function serveStatic(urlPath, res) {
  const decoded = decodeURIComponent(urlPath);
  const safePath = decoded === "/" || decoded === "/assistant.html" ? "/回答アシスタント.dc.html" : decoded;
  const filePath = path.normalize(path.join(__dirname, safePath));
  const relativePath = path.relative(__dirname, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return json(res, 403, { error: "forbidden" });
  const data = await readFile(filePath);
  const ext = path.extname(filePath);
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  res.end(data);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function text(res, status, data, contentType, filename) {
  const headers = { "Content-Type": contentType };
  if (filename) headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  res.writeHead(status, headers);
  res.end(data);
}

async function readJson(req, max = 200_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
