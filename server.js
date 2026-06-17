import http from "node:http";
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = process.env.SETTINGS_ENV_FILE || path.join(__dirname, ".env.local");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, ".data");
const MAPS_FILE = process.env.MAPS_FILE || path.join(DATA_DIR, "maps.json");
const FEEDBACK_FILE = process.env.FEEDBACK_FILE || path.join(DATA_DIR, "feedback.jsonl");
const OKF_DIR = process.env.OKF_DIR || path.join(DATA_DIR, "okf");
loadEnvFile(ENV_FILE);

const PORT = Number(process.env.PORT || 4173);
const DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_DISABLED = /^(1|true|yes)$/i.test(process.env.OPENAI_DISABLED || "");
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AZURE_API_VERSION = "preview";
const PUBLIC_NODE_STATUS = "published";
const REVIEW_NODE_STATUS = "review";
const DEFAULT_WORKSPACE_ID = "support";

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
const workspacesStore = new Map();
workspacesStore.set(DEFAULT_WORKSPACE_ID, {
  id: DEFAULT_WORKSPACE_ID,
  label: "サポート",
  description: "ログイン・認証などのカスタマーサポート用ユースケース",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});
mapsStore.set(mindMap.id, { ...mindMap, source: "builtin", workspaceId: DEFAULT_WORKSPACE_ID });
if (!(await loadOkfBundle())) await loadPersistedMaps();
normalizeStoredMaps();

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
    if (req.method === "GET" && url.pathname === "/api/health") {
      const config = getAiConfig();
      return json(res, 200, { ok: true, hasKey: Boolean(config.key) && !OPENAI_DISABLED, provider: config.provider, model: getModel() });
    }
    if (req.method === "GET" && url.pathname === "/api/settings") return handleGetSettings(res);
    if (req.method === "PUT" && url.pathname === "/api/settings") return await handleUpdateSettings(req, res);
    if (req.method === "POST" && url.pathname === "/api/answer") return await handleAnswer(req, res);
    if (req.method === "POST" && url.pathname === "/api/feedback") return await handleFeedback(req, res);
    if (req.method === "POST" && url.pathname === "/api/analyze-csv") return await handleCsv(req, res);
    if (req.method === "GET" && url.pathname === "/api/improvements") return await handleImprovements(res);
    if (req.method === "GET" && url.pathname === "/api/workspaces") return handleListWorkspaces(res);
    if (req.method === "POST" && url.pathname === "/api/workspaces") return await handleCreateWorkspace(req, res);
    if (req.method === "GET" && url.pathname === "/api/maps") return handleListMaps(url, res);
    if (req.method === "POST" && url.pathname === "/api/maps/import") return await handleImportMap(req, res);
    if (req.method === "POST" && url.pathname.startsWith("/api/maps/")) return await handleCreateMapItem(req, url, res);
    if (req.method === "GET" && url.pathname.startsWith("/api/maps/")) return handleGetMapOrExport(url, res);
    if (req.method === "PUT" && url.pathname.startsWith("/api/maps/")) return await handleUpdateMapItem(req, url, res);
    if (req.method === "DELETE" && url.pathname.startsWith("/api/maps/")) return await handleDeleteMapItem(url, res);
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
  const workspaceId = normalizeWorkspaceId(body.workspaceId);
  if (!query) return json(res, 400, { error: "query_required" });

  const fallback = heuristicAnswer(query, workspaceId);
  const selectedMap = mapsStore.get(fallback.mapId) || mindMap;
  const prompt = [
    "あなたはカスタマーサポートの回答アシスタントです。",
    "与えられたマインドマップだけを主な根拠に、質問に対して辿るべきpath、根本原因、回答案をJSONで返してください。",
    "信頼度が75未満、または根本原因が一意に決まらない場合は、回答を断定せずnextQuestionを返してください。",
    "JSON keys: mapLabel, confidence, path, cause, answer, nextQuestion, needsFollowup, rationale, evidence。",
    "pathはマインドマップ内のnode id配列です。最終原因に到達できる場合はleafまで含めてください。",
    "evidenceには根拠となる元Q&Aやマップノードの要約を最大3件入れてください。",
    `マインドマップ: ${JSON.stringify(selectedMap)}`,
    `会話履歴: ${JSON.stringify(history)}`,
    `質問: ${query}`
  ].join("\n");

  const ai = await callOpenAI(prompt, fallback);
  json(res, 200, {
    source: ai.usedOpenAI ? "openai" : "fallback",
    ...normalizeAnswer(ai.data, fallback, selectedMap),
    candidates: findMapCandidates(query, workspaceId)
  });
}

async function handleCsv(req, res) {
  const body = await readJson(req, 2_000_000);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
  const columns = Array.isArray(body.columns) ? body.columns : [];
  const mapping = normalizeMapping(body.mapping, columns);
  const settings = normalizeExtractionSettings(body.settings);
  const workspaceId = normalizeWorkspaceId(body.workspaceId);
  const qaRows = extractQaRows(rows, mapping, settings);
  const fallback = buildFallbackAnalysis(columns, mapping, qaRows, Number(body.totalRows || rows.length), settings);

  const prompt = [
    "あなたはQ&AログからFAQと判断木更新候補を抽出するアナリストです。",
    "CSVの列、サンプル行、既存マップ、抽出設定を見て、列マッピングと、既存マップに追加するか新規作成するかの提案をJSONで返してください。",
    "JSON keys: mapping {question, answer, category}, clusters [{title,size,sample,action,target,parentId,confidence,reason,rootCause,answer,escalation,sourceQa [{question,answer,category}]}], summary {totalRows, appendCount, newCount, reflectedQa, duplicateCount}。",
    "parentIdは既存マップへ追加する場合の推奨追加先ノードです。sourceQaには根拠となった元Q&Aを最大3件入れてください。",
    `抽出設定: ${JSON.stringify(settings)}`,
    `既存マップ: ${JSON.stringify([...mapsStore.values()].filter((map) => map.workspaceId === workspaceId))}`,
    `列: ${JSON.stringify(columns)}`,
    `Q&Aサンプル: ${JSON.stringify(qaRows.slice(0, 40))}`
  ].join("\n");

  const ai = await callOpenAI(prompt, fallback);
  const data = ai.data && typeof ai.data === "object" ? ai.data : fallback;
  json(res, 200, {
    source: ai.usedOpenAI ? "openai" : "fallback",
    columns,
    mapping: data.mapping || fallback.mapping,
    settings,
    preview: qaRows.slice(0, 5),
    clusters: Array.isArray(data.clusters) && data.clusters.length ? data.clusters.slice(0, 8).map(normalizeCluster) : fallback.clusters,
    summary: data.summary || fallback.summary
  });
}

function handleListWorkspaces(res) {
  const workspaces = [...workspacesStore.values()].map((workspace) => {
    const maps = [...mapsStore.values()].filter((map) => map.workspaceId === workspace.id);
    return {
      id: workspace.id,
      label: workspace.label,
      description: workspace.description || "",
      mapCount: maps.length,
      nodeCount: maps.reduce((sum, map) => sum + map.nodes.length, 0),
      updatedAt: workspace.updatedAt || ""
    };
  });
  json(res, 200, { workspaces, activeWorkspaceId: DEFAULT_WORKSPACE_ID });
}

async function handleCreateWorkspace(req, res) {
  const body = await readJson(req);
  const label = String(body.label || "").trim();
  if (!label) return json(res, 400, { error: "workspace_label_required" });
  const workspace = {
    id: uniqueWorkspaceId(label),
    label,
    description: String(body.description || ""),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  workspacesStore.set(workspace.id, workspace);
  const map = createStarterMap(workspace);
  mapsStore.set(map.id, map);
  normalizeStoredMaps();
  await savePersistedMaps();
  json(res, 201, { workspace, map });
}

function handleListMaps(url, res) {
  const workspaceId = String(url.searchParams.get("workspaceId") || "");
  const maps = [...mapsStore.values()].filter((map) => !workspaceId || map.workspaceId === workspaceId).map((map) => ({
    id: map.id,
    label: map.label,
    workspaceId: map.workspaceId || DEFAULT_WORKSPACE_ID,
    source: map.source || "imported",
    nodeCount: map.nodes.length,
    leafCount: map.nodes.filter((node) => node.type === "leaf").length,
    publishedCount: map.nodes.filter((node) => node.status === PUBLIC_NODE_STATUS).length,
    reviewCount: map.nodes.filter((node) => node.status === REVIEW_NODE_STATUS).length,
    draftCount: map.nodes.filter((node) => node.status === "draft").length,
    unresolvedCount: map.nodes.reduce((sum, node) => sum + Number(node.metrics?.unresolved || 0), 0),
    updatedAt: map.updatedAt || map.createdAt || ""
  }));
  json(res, 200, { maps });
}

function createStarterMap(workspace) {
  const id = uniqueMapId(slugify(`${workspace.label}-map`));
  const now = new Date().toISOString();
  return {
    id,
    label: `${workspace.label}マップ`,
    workspaceId: workspace.id,
    source: "workspace",
    status: REVIEW_NODE_STATUS,
    createdAt: now,
    updatedAt: now,
    nodes: [{ id: "root", type: "symptom", title: `${workspace.label}の問い合わせ`, status: PUBLIC_NODE_STATUS, metrics: { resolved: 0, unresolved: 0 }, sourceQa: [], keywords: tokenize(workspace.label) }],
    edges: []
  };
}

function handleGetMapOrExport(url, res) {
  const parts = url.pathname.split("/").filter(Boolean);
  const mapId = decodeURIComponent(parts[2] || "");
  if (parts.length === 3 && !url.searchParams.has("format")) {
    const map = mapsStore.get(mapId);
    if (!map) return json(res, 404, { error: "map_not_found" });
    return json(res, 200, { map });
  }
  return handleExportMap(url, res);
}

async function handleCreateMapItem(req, url, res) {
  const parts = url.pathname.split("/").filter(Boolean);
  const mapId = decodeURIComponent(parts[2] || "");
  if (!mapId || parts.length !== 4) return json(res, 404, { error: "not_found" });
  const map = mapsStore.get(mapId);
  if (!map) return json(res, 404, { error: "map_not_found" });
  const body = await readJson(req);
  if (parts[3] === "nodes") return createMapNode(map, body, res);
  if (parts[3] === "edges") return createMapEdge(map, body, res);
  return json(res, 404, { error: "not_found" });
}

async function createMapNode(map, body, res) {
  const title = String(body.title || "").trim();
  if (!title) return json(res, 400, { error: "title_required" });
  const node = {
    id: uniqueNodeId(map, body.id || title),
    type: normalizeNodeType(body.type),
    title,
    status: normalizeNodeStatus(body.status || REVIEW_NODE_STATUS),
    metrics: { resolved: 0, unresolved: 0 },
    sourceQa: [],
    keywords: [],
    createdAt: new Date().toISOString()
  };
  updateNodeFields(node, body);
  node.status ||= normalizeNodeStatus(body.status || REVIEW_NODE_STATUS);
  node.keywords = Array.isArray(body.keywords) ? body.keywords.map(String).slice(0, 12) : tokenize(`${node.title} ${node.answer || ""}`).slice(0, 8);
  map.nodes.push(node);
  if (body.parentId && map.nodes.some((item) => item.id === String(body.parentId))) {
    map.edges.push(normalizeEdge(map, { from: String(body.parentId), to: node.id, label: String(body.edgeLabel || "追加") }));
  }
  map.updatedAt = new Date().toISOString();
  await savePersistedMaps();
  json(res, 201, { map, node });
}

async function createMapEdge(map, body, res) {
  const edge = normalizeEdge(map, {
    from: String(body.from || ""),
    to: String(body.to || ""),
    label: String(body.label || ""),
    condition: String(body.condition || "")
  });
  const validation = validateEdge(map, edge);
  if (validation) return json(res, 400, { error: validation });
  map.edges.push(edge);
  map.updatedAt = new Date().toISOString();
  await savePersistedMaps();
  json(res, 201, { map, edge });
}

async function handleUpdateMapItem(req, url, res) {
  const parts = url.pathname.split("/").filter(Boolean);
  const mapId = decodeURIComponent(parts[2] || "");
  const itemId = decodeURIComponent(parts[4] || "");
  if (!mapId || !itemId || !["nodes", "edges"].includes(parts[3])) return json(res, 404, { error: "not_found" });
  const map = mapsStore.get(mapId);
  if (!map) return json(res, 404, { error: "map_not_found" });
  const body = await readJson(req);
  if (parts[3] === "edges") return updateMapEdge(map, itemId, body, res);
  return updateMapNode(map, itemId, body, res);
}

async function updateMapNode(map, nodeId, body, res) {
  const node = map.nodes.find((item) => item.id === nodeId);
  if (!node) return json(res, 404, { error: "node_not_found" });
  updateNodeFields(node, body);
  map.updatedAt = new Date().toISOString();
  await savePersistedMaps();
  json(res, 200, { map, node });
}

function updateNodeFields(node, body) {
  const textFields = ["title", "rootCause", "answer", "nextQuestion", "escalation", "reason", "target", "parentId"];
  for (const field of textFields) {
    if (field in body) node[field] = String(body[field] || "");
  }
  if (body.position && typeof body.position === "object") node.position = normalizePosition(body.position);
  if ("status" in body) node.status = normalizeNodeStatus(body.status);
  if ("type" in body) node.type = normalizeNodeType(body.type);
  if ("confidence" in body) node.confidence = normalizeConfidence(body.confidence || 0);
  if (Array.isArray(body.keywords)) node.keywords = body.keywords.map(String).slice(0, 12);
  if (Array.isArray(body.sourceQa)) node.sourceQa = normalizeSourceQa(body.sourceQa);
  applyNodeTypeRules(node);
  node.updatedAt = new Date().toISOString();
}

function normalizePosition(position) {
  return {
    x: Math.max(0, Math.min(2000, Number(position.x) || 0)),
    y: Math.max(0, Math.min(2000, Number(position.y) || 0))
  };
}

function applyNodeTypeRules(node) {
  node.type = normalizeNodeType(node.type);
  if (node.type === "symptom") {
    node.rootCause = "";
    node.answer = "";
    node.nextQuestion = "";
    node.escalation = "";
    return;
  }
  if (node.type === "question") {
    node.rootCause = "";
    node.answer = "";
    node.escalation = "";
    return;
  }
  node.nextQuestion = "";
  if (!String(node.rootCause || "").trim()) node.rootCause = String(node.title || "").trim();
}

async function updateMapEdge(map, edgeId, body, res) {
  const edge = map.edges.find((item) => item.id === edgeId);
  if (!edge) return json(res, 404, { error: "edge_not_found" });
  const next = {
    ...edge,
    from: "from" in body ? String(body.from || "") : edge.from,
    to: "to" in body ? String(body.to || "") : edge.to,
    label: "label" in body ? String(body.label || "") : edge.label,
    condition: "condition" in body ? String(body.condition || "") : edge.condition
  };
  const validation = validateEdge(map, next);
  if (validation) return json(res, 400, { error: validation });
  Object.assign(edge, next, { updatedAt: new Date().toISOString() });
  map.updatedAt = edge.updatedAt;
  await savePersistedMaps();
  json(res, 200, { map, edge });
}

async function handleDeleteMapItem(url, res) {
  const parts = url.pathname.split("/").filter(Boolean);
  const mapId = decodeURIComponent(parts[2] || "");
  const itemId = decodeURIComponent(parts[4] || "");
  if (!mapId || !itemId || !["nodes", "edges"].includes(parts[3])) return json(res, 404, { error: "not_found" });
  const map = mapsStore.get(mapId);
  if (!map) return json(res, 404, { error: "map_not_found" });
  if (parts[3] === "edges") {
    const before = map.edges.length;
    map.edges = map.edges.filter((edge) => edge.id !== itemId);
    if (map.edges.length === before) return json(res, 404, { error: "edge_not_found" });
    map.updatedAt = new Date().toISOString();
    await savePersistedMaps();
    return json(res, 200, { map, deleted: { type: "edge", id: itemId } });
  }
  if (itemId === "root") return json(res, 400, { error: "cannot_delete_root" });
  const before = map.nodes.length;
  map.nodes = map.nodes.filter((node) => node.id !== itemId);
  if (map.nodes.length === before) return json(res, 404, { error: "node_not_found" });
  map.edges = map.edges.filter((edge) => edge.from !== itemId && edge.to !== itemId);
  map.updatedAt = new Date().toISOString();
  await savePersistedMaps();
  json(res, 200, { map, deleted: { type: "node", id: itemId } });
}

function normalizeNodeType(value) {
  const type = String(value || "").toLowerCase();
  if (["symptom", "question", "leaf"].includes(type)) return type;
  return "question";
}

function normalizeEdge(map, edge) {
  const normalized = {
    id: edge.id ? String(edge.id) : uniqueEdgeId(map, edge.from, edge.to, edge.label),
    from: String(edge.from || ""),
    to: String(edge.to || ""),
    label: String(edge.label || ""),
    condition: String(edge.condition || "")
  };
  return normalized;
}

function validateEdge(map, edge) {
  if (!edge.from || !edge.to) return "edge_endpoints_required";
  if (edge.from === edge.to) return "edge_self_loop";
  const ids = new Set(map.nodes.map((node) => node.id));
  if (!ids.has(edge.from) || !ids.has(edge.to)) return "edge_node_not_found";
  const duplicate = map.edges.some((item) => item.id !== edge.id && item.from === edge.from && item.to === edge.to && String(item.label || "") === String(edge.label || ""));
  if (duplicate) return "edge_duplicate";
  return "";
}

function uniqueNodeId(map, seed) {
  const base = slugify(seed).slice(0, 40) || "node";
  const existing = new Set(map.nodes.map((node) => node.id));
  let id = base;
  let counter = 2;
  while (existing.has(id)) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  return id;
}

function uniqueEdgeId(map, from, to, label = "") {
  const base = `e-${slugify(from)}-${slugify(to)}-${slugify(label || "edge")}`.slice(0, 80) || "e-edge";
  const existing = new Set(map.edges.map((edge) => edge.id).filter(Boolean));
  let id = base;
  let counter = 2;
  while (existing.has(id)) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  return id;
}

function normalizeNodeStatus(value) {
  const status = String(value || "").toLowerCase();
  if (["draft", REVIEW_NODE_STATUS, PUBLIC_NODE_STATUS, "rejected"].includes(status)) return status;
  return REVIEW_NODE_STATUS;
}

function handleGetSettings(res) {
  json(res, 200, publicSettings());
}

async function handleFeedback(req, res) {
  const body = await readJson(req);
  const mapId = String(body.mapId || "");
  const path = Array.isArray(body.path) ? body.path.map(String) : [];
  const entry = {
    id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    outcome: String(body.outcome || "unknown"),
    reason: String(body.reason || ""),
    note: String(body.note || ""),
    mapId,
    path,
    nodeId: String(body.nodeId || path[path.length - 1] || ""),
    cause: String(body.cause || ""),
    confidence: normalizeConfidence(body.confidence || 0),
    source: String(body.source || "")
  };
  applyFeedbackToNode(entry);
  await ensureDataDir();
  await appendFile(FEEDBACK_FILE, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  if (entry.outcome === "unresolved") await savePersistedMaps();
  json(res, 200, { ok: true, feedback: entry });
}

async function handleImprovements(res) {
  const feedback = await readFeedbackEntries();
  const unresolved = feedback.filter((entry) => entry.outcome === "unresolved");
  const nodeItems = [];
  for (const map of mapsStore.values()) {
    for (const node of map.nodes) {
      const unresolvedCount = Number(node.metrics?.unresolved || 0);
      if (!unresolvedCount && node.status !== REVIEW_NODE_STATUS) continue;
      nodeItems.push({
        mapId: map.id,
        workspaceId: map.workspaceId || DEFAULT_WORKSPACE_ID,
        mapLabel: map.label,
        nodeId: node.id,
        title: node.title,
        status: node.status,
        unresolvedCount,
        lastReason: node.metrics?.lastUnresolvedReason || "",
        updatedAt: node.updatedAt || map.updatedAt || ""
      });
    }
  }
  nodeItems.sort((a, b) => (b.unresolvedCount - a.unresolvedCount) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  json(res, 200, { items: nodeItems, feedback: unresolved.slice(-20).reverse() });
}

async function handleUpdateSettings(req, res) {
  const body = await readJson(req);
  const provider = normalizeProvider(body.provider);
  const openaiBaseUrl = cleanUrl(body.openaiBaseUrl) || DEFAULT_OPENAI_BASE_URL;
  const azureBaseUrl = cleanUrl(body.azureBaseUrl);
  const azureApiVersion = String(body.azureApiVersion || DEFAULT_AZURE_API_VERSION).trim() || DEFAULT_AZURE_API_VERSION;
  const model = normalizeModel(body.model);
  const updates = {
    AI_PROVIDER: provider,
    OPENAI_MODEL: model,
    OPENAI_BASE_URL: openaiBaseUrl,
    AZURE_OPENAI_BASE_URL: azureBaseUrl,
    AZURE_OPENAI_API_VERSION: azureApiVersion
  };

  const openaiApiKey = cleanSecret(body.openaiApiKey);
  const azureApiKey = cleanSecret(body.azureApiKey);
  if (openaiApiKey) updates.OPENAI_API_KEY = openaiApiKey;
  if (azureApiKey) updates.AZURE_OPENAI_API_KEY = azureApiKey;

  await updateEnvFile(ENV_FILE, updates);
  Object.assign(process.env, updates);
  json(res, 200, publicSettings());
}

function publicSettings() {
  const provider = normalizeProvider(process.env.AI_PROVIDER);
  return {
    provider,
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasAzureKey: Boolean(process.env.AZURE_OPENAI_API_KEY),
    openaiBaseUrl: process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL,
    azureBaseUrl: process.env.AZURE_OPENAI_BASE_URL || "",
    azureApiVersion: process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION,
    model: getModel(),
    modelOptions: modelOptions(),
    disabled: OPENAI_DISABLED
  };
}

function getModel() {
  return normalizeModel(process.env.OPENAI_MODEL);
}

function normalizeModel(value) {
  const model = String(value || "").trim();
  if (!model) return DEFAULT_MODEL;
  return model.replace(/[\r\n\t"'`]/g, "").slice(0, 100) || DEFAULT_MODEL;
}

function modelOptions() {
  const current = getModel();
  const options = [DEFAULT_MODEL, "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"];
  return [...new Set([current, ...options])];
}

async function updateEnvFile(filePath, updates) {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates).filter(([, value]) => value != null));
  const next = existing.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${envValue(value)}`;
  });
  if (next.length && next[next.length - 1] === "") next.pop();
  for (const [key, value] of pending) next.push(`${key}=${envValue(value)}`);
  await writeFile(filePath, `${next.join("\n")}\n`, { mode: 0o600 });
}

function envValue(value) {
  return String(value ?? "").replace(/[\r\n]/g, "");
}

function normalizeProvider(value) {
  return String(value || "").toLowerCase() === "azure" ? "azure" : "openai";
}

function cleanUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function cleanSecret(value) {
  return String(value || "").trim();
}

async function handleImportMap(req, res) {
  const body = await readJson(req, 2_000_000);
  const title = String(body.title || "CSV取り込みマップ").trim();
  const workspaceId = normalizeWorkspaceId(body.workspaceId);
  const clusters = Array.isArray(body.clusters) ? body.clusters.map(normalizeCluster).slice(0, 24) : [];
  if (!clusters.length) return json(res, 400, { error: "clusters_required" });
  const map = buildImportedMap(title, clusters, normalizeExtractionSettings(body.settings), normalizeMapping(body.mapping, []), workspaceId);
  mapsStore.set(map.id, map);
  normalizeStoredMaps();
  await savePersistedMaps();
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
  if (format === "okf") return text(res, 200, JSON.stringify(mapToOkfBundle(map), null, 2), "application/json; charset=utf-8", `${map.id}.okf.json`);
  return text(res, 200, JSON.stringify(map, null, 2), "application/json; charset=utf-8", `${map.id}.json`);
}

function buildImportedMap(title, clusters, settings = normalizeExtractionSettings(), mapping = {}, workspaceId = DEFAULT_WORKSPACE_ID) {
  const id = uniqueMapId(slugify(title || "csv-map"));
  const nodes = [{ id: "root", type: "symptom", title, domain: "customer-support", generatedFrom: "csv", status: PUBLIC_NODE_STATUS }];
  const edges = [];
  for (const [idx, cluster] of clusters.entries()) {
    const nodeId = `c${idx + 1}`;
    nodes.push({
      id: nodeId,
      type: "leaf",
      title: cluster.title,
      status: cluster.status || REVIEW_NODE_STATUS,
      answer: buildClusterAnswer(cluster),
      rootCause: cluster.rootCause,
      escalation: cluster.escalation,
      nextQuestion: cluster.nextQuestion,
      sample: cluster.sample,
      target: cluster.target,
      action: cluster.action,
      parentId: cluster.parentId || "root",
      confidence: cluster.confidence,
      reason: cluster.reason,
      size: cluster.size,
      sourceQa: cluster.sourceQa,
      keywords: cluster.keywords,
      metrics: { resolved: 0, unresolved: 0 },
      updatedAt: new Date().toISOString()
    });
    edges.push({ from: "root", to: nodeId, label: cluster.action === "create" ? "新規" : "追加" });
  }
  return { id, label: title, workspaceId, source: "csv-import", status: REVIEW_NODE_STATUS, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), settings, mapping, nodes, edges };
}

function normalizeWorkspaceId(value) {
  const id = String(value || DEFAULT_WORKSPACE_ID);
  return workspacesStore.has(id) ? id : DEFAULT_WORKSPACE_ID;
}

function buildClusterAnswer(cluster) {
  if (cluster.answer) return cluster.answer;
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
    parentId: String(cluster.parentId || cluster.parent || "root"),
    status: normalizeNodeStatus(cluster.status || REVIEW_NODE_STATUS),
    confidence: Math.max(0, Math.min(100, Math.round(confidence || 80))),
    reason: String(cluster.reason || cluster.rationale || "既存マップとの類似度と回答方針から判定しました。"),
    rootCause: String(cluster.rootCause || cluster.cause || cluster.title || "未分類"),
    answer: String(cluster.answer || ""),
    escalation: String(cluster.escalation || "既知手順で解消しない場合は担当チームへエスカレーションしてください。"),
    nextQuestion: String(cluster.nextQuestion || "対象ユーザー、発生時刻、再現条件は確認済みですか？"),
    sourceQa: normalizeSourceQa(cluster.sourceQa || cluster.evidence || []),
    keywords: Array.isArray(cluster.keywords) ? cluster.keywords.map(String).slice(0, 12) : tokenize(`${cluster.title || ""} ${cluster.sample || ""}`).slice(0, 8)
  };
}

function normalizeMapping(mapping = {}, columns = []) {
  const detected = detectMapping(columns);
  return {
    question: String(mapping.question || detected.question || ""),
    answer: String(mapping.answer || detected.answer || ""),
    category: String(mapping.category || detected.category || "")
  };
}

function normalizeExtractionSettings(settings = {}) {
  const abstraction = ["low", "medium", "high"].includes(settings.abstraction) ? settings.abstraction : "medium";
  return {
    abstraction,
    integrateExisting: settings.integrateExisting !== false,
    dedupe: settings.dedupe !== false
  };
}

function extractQaRows(rows, mapping, settings) {
  const seen = new Set();
  const qaRows = [];
  for (const [idx, row] of rows.entries()) {
    const question = displayText(row[mapping.question]).trim();
    const answer = displayText(row[mapping.answer]).trim();
    if (!question && !answer) continue;
    const key = `${normalizeSearchText(question)}::${normalizeSearchText(answer)}`;
    if (settings.dedupe && seen.has(key)) continue;
    seen.add(key);
    qaRows.push({
      id: `row-${idx + 1}`,
      question,
      answer,
      category: displayText(row[mapping.category]).trim(),
      raw: row
    });
  }
  return qaRows;
}

function buildFallbackAnalysis(columns, mapping, qaRows, totalRows, settings) {
  const groups = new Map();
  for (const row of qaRows) {
    const key = classifyQa(row, settings);
    if (!groups.has(key.title)) groups.set(key.title, { ...key, rows: [] });
    groups.get(key.title).rows.push(row);
  }
  const clusters = [...groups.values()].slice(0, 8).map((group) => {
    const sourceQa = group.rows.slice(0, 3).map(({ question, answer, category }) => ({ question, answer, category }));
    return normalizeCluster({
      title: group.title,
      size: group.rows.length,
      sample: sourceQa[0]?.question || "",
      action: settings.integrateExisting ? group.action : "create",
      target: settings.integrateExisting ? group.target : group.title,
      parentId: group.parentId,
      confidence: group.confidence,
      reason: group.reason,
      rootCause: group.rootCause,
      answer: group.answer,
      escalation: group.escalation,
      sourceQa,
      keywords: tokenize(`${group.title} ${sourceQa.map((item) => item.question).join(" ")}`).slice(0, 8)
    });
  });
  const appendCount = clusters.filter((cluster) => cluster.action === "append").length;
  const newCount = clusters.filter((cluster) => cluster.action === "create").length;
  return {
    columns,
    mapping,
    preview: qaRows.slice(0, 5),
    clusters: clusters.length ? clusters : routesSeed.map((cluster) => normalizeCluster(cluster)),
    summary: {
      totalRows,
      appendCount,
      newCount,
      reflectedQa: qaRows.length,
      duplicateCount: Math.max(0, totalRows - qaRows.length)
    }
  };
}

function classifyQa(row, settings) {
  const text = `${row.question} ${row.answer} ${row.category}`;
  if (/sms|2段階|二段階|認証コード|mfa|otp/i.test(text)) {
    return {
      title: settings.abstraction === "low" ? "認証コードが届かない" : "2段階認証のコードが届かない",
      action: "append",
      target: "ログイン・認証",
      parentId: "q1",
      confidence: 90,
      rootCause: "認証コード未着",
      reason: "ログイン・認証マップの認証フローに追加できる問い合わせです。",
      answer: "2段階認証コードが届かない問い合わせです。SMSやメールの受信状態、再送操作、登録先の電話番号またはメールアドレスを確認し、届かない場合は管理者に認証方法のリセットを依頼してください。",
      escalation: "複数ユーザーで同時に発生する場合はIdPまたは配信基盤の障害としてエスカレーションしてください。"
    };
  }
  if (/webhook|イベント|配信|api/i.test(text)) {
    return {
      title: "Webhookが発火しない",
      action: "create",
      target: "API・連携",
      parentId: "root",
      confidence: 92,
      rootCause: "Webhook配信条件または連携設定の不整合",
      reason: "既存のログイン系マップとは領域が異なるため、新規マップ候補です。",
      answer: "Webhookが発火しない問い合わせです。イベント発生条件、エンドポイントURL、署名検証、配信ログ、再送設定を確認し、配信ログに失敗が残る場合はAPI連携担当へエスカレーションしてください。",
      escalation: "配信ログが欠落している、または複数テナントで同時発生する場合は開発チームへエスカレーションしてください。"
    };
  }
  if (/請求|invoice|pdf|領収|課金/.test(text)) {
    return {
      title: "請求書PDFがダウンロードできない",
      action: "append",
      target: "請求・課金",
      parentId: "root",
      confidence: 86,
      rootCause: "請求書出力または権限の問題",
      reason: "請求・課金領域の出力系トラブルとして扱えます。",
      answer: "請求書PDFのダウンロード不可に関する問い合わせです。請求期間、対象アカウント、閲覧権限、ブラウザのポップアップ制御を確認し、再生成後も失敗する場合は課金担当へエスカレーションしてください。",
      escalation: "同一期間のPDF生成が複数顧客で失敗する場合は請求基盤の障害として扱ってください。"
    };
  }
  const title = settings.abstraction === "high" ? "未分類の操作・不具合問い合わせ" : (row.category ? `${row.category}の問い合わせ` : "未分類クラスタ");
  return {
    title,
    action: "create",
    target: title,
    parentId: "root",
    confidence: 72,
    rootCause: title,
    reason: "既存マップとの一致が弱いため、新規候補としてレビューが必要です。",
    answer: `${title}です。事象の再現条件、対象ユーザー、発生時刻、関連ログを確認し、既存手順で解消しない場合は担当チームへエスカレーションしてください。`,
    escalation: "再現性が高い、影響範囲が広い、またはログに異常がある場合は担当チームへエスカレーションしてください。"
  };
}

function normalizeSourceQa(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 5).map((item) => {
    if (typeof item === "string") return { question: item, answer: "", category: "" };
    return {
      question: String(item.question || item.q || item.sample || ""),
      answer: String(item.answer || item.a || ""),
      category: String(item.category || "")
    };
  }).filter((item) => item.question || item.answer);
}

function displayText(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function callOpenAI(input, fallback) {
  const config = getAiConfig();
  if (OPENAI_DISABLED) return { usedOpenAI: false, data: fallback };
  if (!config.key) return { usedOpenAI: false, data: fallback };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...config.headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: getModel(),
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

function getAiConfig() {
  const provider = normalizeProvider(process.env.AI_PROVIDER);
  if (provider === "azure") {
    const baseUrl = process.env.AZURE_OPENAI_BASE_URL || "";
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION;
    return {
      provider,
      key: process.env.AZURE_OPENAI_API_KEY || "",
      url: withApiVersion(azureResponsesUrl(baseUrl), apiVersion),
      headers: { "api-key": process.env.AZURE_OPENAI_API_KEY || "" }
    };
  }
  const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL;
  return {
    provider,
    key: process.env.OPENAI_API_KEY || "",
    url: `${cleanUrl(baseUrl)}/responses`,
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ""}` }
  };
}

function azureResponsesUrl(baseUrl) {
  const cleaned = cleanUrl(baseUrl);
  if (!cleaned) return "";
  if (/\/responses$/i.test(cleaned)) return cleaned;
  if (/\/openai\/v1$/i.test(cleaned)) return `${cleaned}/responses`;
  return `${cleaned}/openai/v1/responses`;
}

function withApiVersion(url, apiVersion) {
  if (!url) return "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}api-version=${encodeURIComponent(apiVersion || DEFAULT_AZURE_API_VERSION)}`;
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

function heuristicAnswer(query, workspaceId = DEFAULT_WORKSPACE_ID) {
  const imported = findImportedMapMatch(query, workspaceId);
  if (imported) return imported;
  if (workspaceId !== DEFAULT_WORKSPACE_ID) {
    const map = [...mapsStore.values()].find((item) => item.workspaceId === workspaceId) || mindMap;
    return {
      mapId: map.id,
      mapLabel: map.label,
      confidence: 50,
      path: ["root"],
      cause: "未確定",
      answer: "このワークスペースのマップだけでは根本原因を断定できません。症状、影響範囲、再現条件を確認してください。",
      nextQuestion: map.nodes.find((node) => node.type === "question")?.title || "まず確認したい症状や条件を入力してください。",
      needsFollowup: true,
      rationale: `ワークスペース「${workspacesStore.get(workspaceId)?.label || workspaceId}」内で一致する公開済み原因が見つかりませんでした。`,
      evidence: []
    };
  }
  if (/全員|社員全員|sso|idp|障害/.test(query)) {
    return answerFromBuiltin("l4", 88, "複数ユーザー同時発生の文脈からSSO/IdP側を優先。");
  }
  if (/真っ白|読み込|ロード|キャッシュ|cookie/.test(query)) {
    return answerFromBuiltin("l3", 91, "画面読み込み不良はキャッシュ不整合の既存リーフに一致。");
  }
  if (/ロック|回数|何度/.test(query)) {
    return answerFromBuiltin("l2", 86, "試行回数超過の可能性が高い。");
  }
  if (/パスワード|ログインでき|サインイン/i.test(query)) {
    return answerFromBuiltin("l1", 82, "パスワード不一致の代表的な根本原因。");
  }
  return {
    mapId: mindMap.id,
    mapLabel: "ログイン・認証",
    confidence: 62,
    path: ["root", "q1"],
    cause: "未確定",
    answer: "現時点では根本原因を断定できません。エラーメッセージの有無、影響範囲、画面読み込み状況を確認してください。",
    nextQuestion: "エラーメッセージは表示されていますか？",
    needsFollowup: true,
    rationale: "既存マップとの一致が弱いため追加確認が必要。",
    evidence: []
  };
}

function answerFromBuiltin(leafId, confidence, rationale) {
  const node = mindMap.nodes.find((n) => n.id === leafId);
  return {
    mapId: mindMap.id,
    mapLabel: "ログイン・認証",
    confidence,
    path: canonicalPath(leafId),
    cause: node.title,
    answer: node.answer,
    nextQuestion: "",
    needsFollowup: false,
    rationale,
    evidence: [{ question: node.title, answer: node.answer, category: "builtin" }]
  };
}

function findImportedMapMatch(query, workspaceId = DEFAULT_WORKSPACE_ID) {
  const candidates = [];
  for (const map of mapsStore.values()) {
    if (map.id === mindMap.id) continue;
    if (map.workspaceId !== workspaceId) continue;
    for (const node of map.nodes.filter((item) => item.type === "leaf" && item.status === PUBLIC_NODE_STATUS)) {
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
    needsFollowup: best.score < 3,
    evidence: best.node.sourceQa || [{ question: best.node.sample || best.node.title, answer: best.node.answer || "", category: best.node.target || "" }],
    rationale: `保存済みマップ「${best.map.label}」内のクラスタ「${best.node.title}」に一致しました。`
  };
}

function findMapCandidates(query, workspaceId = DEFAULT_WORKSPACE_ID) {
  const candidates = [];
  for (const map of mapsStore.values()) {
    if (map.workspaceId !== workspaceId) continue;
    let score = scoreTextMatch(query, `${map.label} ${map.nodes.map((node) => `${node.title} ${node.keywords?.join(" ") || ""}`).join(" ")}`);
    const bestNode = map.nodes
      .filter((node) => node.type === "leaf")
      .map((node) => ({
        node,
        score: scoreTextMatch(query, [node.title, node.sample, node.target, node.reason, node.answer, ...(node.keywords || [])].filter(Boolean).join(" "))
      }))
      .sort((a, b) => b.score - a.score)[0];
    if (bestNode?.score) score += bestNode.score;
    if (score <= 0 && map.id !== mindMap.id) continue;
    candidates.push({
      mapId: map.id,
      mapLabel: map.label,
      confidence: Math.max(40, Math.min(96, 56 + score * 7)),
      nodeId: bestNode?.node?.id || "root",
      nodeTitle: bestNode?.node?.title || map.label,
      status: bestNode?.node?.status || map.status || PUBLIC_NODE_STATUS
    });
  }
  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 4);
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
    needsFollowup: Boolean(data?.needsFollowup || fallback.needsFollowup || (normalizeConfidence(data?.confidence || fallback.confidence || 80) < 75 && (data?.nextQuestion || fallback.nextQuestion))),
    evidence: normalizeSourceQa(data?.evidence || fallback.evidence || selectedMap.nodes.find((node) => node.id === path[path.length - 1])?.sourceQa || []),
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
  const rows = [["map_id", "map_label", "node_id", "type", "title", "root_cause", "answer", "target", "action", "parent_id", "confidence", "sample", "reason", "escalation", "source_qa"]];
  for (const node of map.nodes) {
    rows.push([
      map.id,
      map.label,
      node.id,
      node.type,
      node.title,
      node.rootCause || "",
      node.answer || "",
      node.target || "",
      node.action || "",
      node.parentId || "",
      node.confidence || "",
      node.sample || "",
      node.reason || "",
      node.escalation || "",
      JSON.stringify(node.sourceQa || [])
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
- Parent ID: ${node.parentId || "root"}
- Confidence: ${node.confidence || "n/a"}
- Root cause: ${node.rootCause || node.title}
- Sample: ${node.sample || "n/a"}
- Reason: ${node.reason || "n/a"}
- Escalation: ${node.escalation || "n/a"}
- Evidence: ${(node.sourceQa || []).map((item) => `Q: ${item.question} / A: ${item.answer}`).join(" | ") || "n/a"}
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
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `item-${hashString(value)}`;
}

function hashString(value) {
  let hash = 0;
  for (const char of String(value || "item")) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36).slice(0, 8) || "0";
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

function uniqueWorkspaceId(label) {
  const base = slugify(label || "workspace").slice(0, 48) || "workspace";
  let id = base;
  let counter = 2;
  while (workspacesStore.has(id)) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  return id;
}

function okfConcept(frontmatter, body = "") {
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trimEnd()}\n`;
}

function parseOkfConcept(text) {
  const match = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: String(text || "") };
  return {
    frontmatter: YAML.parse(match[1]) || {},
    body: match[2] || ""
  };
}

function okfTypeForNode(node) {
  if (node.type === "symptom") return "Support Symptom";
  if (node.type === "leaf") return "Root Cause";
  return "Decision Question";
}

function okfNodePath(mapId, nodeId) {
  return `/nodes/${slugify(mapId)}/${slugify(nodeId)}.md`;
}

function okfQaPath(mapId, nodeId, idx) {
  return `/references/qa/${slugify(mapId)}/${slugify(nodeId)}-${idx + 1}.md`;
}

function okfLinkTitle(value) {
  return String(value || "").replace(/[[\]\n\r]/g, " ").trim() || "Untitled";
}

function mapToOkfBundle(map) {
  const workspace = workspacesStore.get(map.workspaceId || DEFAULT_WORKSPACE_ID) || workspacesStore.get(DEFAULT_WORKSPACE_ID);
  const files = {};
  const add = (filePath, content) => { files[filePath.replace(/^\/+/, "")] = content; };
  add("index.md", okfRootIndex([...workspacesStore.values()], [map]));
  add("workspaces/index.md", okfDirectoryIndex("Workspaces", [{ title: workspace.label, href: `${slugify(workspace.id)}.md`, description: workspace.description || "" }]));
  add(`workspaces/${slugify(workspace.id)}.md`, okfWorkspaceConcept(workspace, [map]));
  add("maps/index.md", okfDirectoryIndex("Maps", [{ title: map.label, href: `${slugify(map.id)}.md`, description: `${map.nodes.length} nodes / ${map.edges.length} branches` }]));
  add(`maps/${slugify(map.id)}.md`, okfMapConcept(map));
  add(`nodes/${slugify(map.id)}/index.md`, okfDirectoryIndex(`${map.label} Nodes`, map.nodes.map((node) => ({
    title: node.title,
    href: `${slugify(node.id)}.md`,
    description: `${okfTypeForNode(node)} / ${node.status || REVIEW_NODE_STATUS}`
  }))));
  for (const node of map.nodes) {
    add(`nodes/${slugify(map.id)}/${slugify(node.id)}.md`, okfNodeConcept(map, node));
    for (const [idx, qa] of (node.sourceQa || []).entries()) {
      add(`references/qa/${slugify(map.id)}/${slugify(node.id)}-${idx + 1}.md`, okfQaConcept(map, node, qa, idx));
    }
  }
  return {
    okf_version: "0.1",
    app_schema: "distill-support-map/v1",
    bundle_root: ".",
    files
  };
}

function okfRootIndex(workspaces, maps) {
  const body = [
    "# Distill Support Knowledge Bundle",
    "",
    "This bundle is the canonical internal knowledge store for the support answer assistant.",
    "",
    "# Workspaces",
    "",
    ...workspaces.map((workspace) => `* [${okfLinkTitle(workspace.label)}](/workspaces/${slugify(workspace.id)}.md) - ${workspace.description || "Support workspace"}`),
    "",
    "# Maps",
    "",
    ...maps.map((map) => `* [${okfLinkTitle(map.label)}](/maps/${slugify(map.id)}.md) - ${map.nodes.length} nodes / ${map.edges.length} branches`)
  ].join("\n");
  return okfConcept({ okf_version: "0.1", app_schema: "distill-support-map/v1" }, body);
}

function okfDirectoryIndex(title, entries) {
  return [`# ${title}`, "", ...entries.map((entry) => `* [${okfLinkTitle(entry.title)}](${entry.href}) - ${entry.description || ""}`)].join("\n") + "\n";
}

function okfWorkspaceConcept(workspace, maps) {
  const frontmatter = {
    type: "Support Workspace",
    title: workspace.label,
    description: workspace.description || "",
    resource: `app://workspaces/${workspace.id}`,
    tags: ["support", "workspace"],
    timestamp: workspace.updatedAt || workspace.createdAt || new Date().toISOString(),
    okf_version: "0.1",
    app_schema: "distill-support-map/v1",
    workspace_id: workspace.id,
    created_at: workspace.createdAt || ""
  };
  const body = [
    "# Purpose",
    "",
    workspace.description || "Support knowledge workspace.",
    "",
    "# Maps",
    "",
    ...maps.map((map) => `* [${okfLinkTitle(map.label)}](/maps/${slugify(map.id)}.md)`)
  ].join("\n");
  return okfConcept(frontmatter, body);
}

function okfMapConcept(map) {
  const rootId = map.nodes.some((node) => node.id === "root") ? "root" : map.nodes[0]?.id || "";
  const frontmatter = {
    type: "Support Decision Map",
    title: map.label,
    description: `Decision map for ${map.label}.`,
    resource: `app://maps/${map.id}`,
    tags: ["support", "decision-map", map.workspaceId || DEFAULT_WORKSPACE_ID],
    timestamp: map.updatedAt || map.createdAt || new Date().toISOString(),
    okf_version: "0.1",
    app_schema: "distill-support-map/v1",
    map_id: map.id,
    workspace_id: map.workspaceId || DEFAULT_WORKSPACE_ID,
    map_status: map.status || REVIEW_NODE_STATUS,
    source: map.source || "okf",
    root_node_id: rootId,
    settings: map.settings || {},
    mapping: map.mapping || {},
    created_at: map.createdAt || ""
  };
  const body = [
    "# Traversal Contract",
    "",
    "Agents should start at the root node, inspect the node body and `outcomes` frontmatter, then select one outgoing branch or ask the node's follow-up question when confidence is low.",
    "",
    "# Nodes",
    "",
    ...map.nodes.map((node) => `* [${okfLinkTitle(node.title)}](${okfNodePath(map.id, node.id)}) - ${okfTypeForNode(node)} / ${node.status || REVIEW_NODE_STATUS}`),
    "",
    "# Branches",
    "",
    ...map.edges.map((edge) => {
      const from = map.nodes.find((node) => node.id === edge.from);
      const to = map.nodes.find((node) => node.id === edge.to);
      return `* [${okfLinkTitle(from?.title || edge.from)}](${okfNodePath(map.id, edge.from)}) -> [${okfLinkTitle(to?.title || edge.to)}](${okfNodePath(map.id, edge.to)}) - ${edge.label || "next"}${edge.condition ? `; condition: ${edge.condition}` : ""}`;
    })
  ].join("\n");
  return okfConcept(frontmatter, body);
}

function okfNodeConcept(map, node) {
  const outgoing = (map.edges || []).filter((edge) => edge.from === node.id);
  const incoming = (map.edges || []).filter((edge) => edge.to === node.id);
  const frontmatter = {
    type: okfTypeForNode(node),
    title: node.title,
    description: nodeDescription(node),
    resource: `app://maps/${map.id}/nodes/${node.id}`,
    tags: ["support", map.workspaceId || DEFAULT_WORKSPACE_ID, map.id, node.type || "question"],
    timestamp: node.updatedAt || map.updatedAt || map.createdAt || new Date().toISOString(),
    okf_version: "0.1",
    app_schema: "distill-support-map/v1",
    map_id: map.id,
    node_id: node.id,
    node_kind: node.type,
    status: node.status || REVIEW_NODE_STATUS,
    position: node.position || null,
    metrics: node.metrics || { resolved: 0, unresolved: 0 },
    keywords: node.keywords || [],
    root_cause: node.rootCause || "",
    answer: node.answer || "",
    next_question: node.nextQuestion || "",
    escalation: node.escalation || "",
    reason: node.reason || "",
    target: node.target || "",
    action: node.action || "",
    parent_id: node.parentId || incoming[0]?.from || "",
    confidence: node.confidence || null,
    sample: node.sample || "",
    source_qa: node.sourceQa || [],
    outcomes: outgoing.map((edge) => ({
      edge_id: edge.id,
      label: edge.label || "next",
      condition: edge.condition || "",
      to: okfNodePath(map.id, edge.to),
      to_node_id: edge.to
    })),
    incoming: incoming.map((edge) => ({
      edge_id: edge.id,
      label: edge.label || "next",
      from: okfNodePath(map.id, edge.from),
      from_node_id: edge.from
    })),
    created_at: node.createdAt || ""
  };
  const body = [
    "# Agent Instructions",
    "",
    agentInstructionForNode(node),
    "",
    node.type === "question" ? "# Decision Criteria" : node.type === "leaf" ? "# Root Cause" : "# Entry Context",
    "",
    node.reason || node.rootCause || node.title,
    "",
    ...(node.nextQuestion ? ["# Follow-up Question", "", node.nextQuestion, ""] : []),
    ...(node.answer ? ["# Answer", "", node.answer, ""] : []),
    ...(node.escalation ? ["# Escalation", "", node.escalation, ""] : []),
    "# Decision Outcomes",
    "",
    ...(outgoing.length ? outgoing.map((edge) => {
      const to = map.nodes.find((item) => item.id === edge.to);
      return `* [${edge.label || "next"}](${okfNodePath(map.id, edge.to)}) - ${edge.condition || to?.title || ""}`;
    }) : ["No outgoing outcomes. This is a terminal concept."]),
    "",
    "# Evidence",
    "",
    ...((node.sourceQa || []).length ? node.sourceQa.map((item) => `* Q: ${item.question || ""}\n  A: ${item.answer || ""}${item.category ? `\n  Category: ${item.category}` : ""}`) : ["No source Q&A has been attached."]),
    "",
    "# Citations",
    "",
    ...((node.sourceQa || []).length ? node.sourceQa.map((item, idx) => `[${idx + 1}] [Source Q&A ${idx + 1}](${okfQaPath(map.id, node.id, idx)})`) : ["No citations."])
  ].join("\n");
  return okfConcept(frontmatter, body);
}

function okfQaConcept(map, node, qa, idx) {
  const title = `${node.title} source Q&A ${idx + 1}`;
  const frontmatter = {
    type: "Reference",
    title,
    description: qa.question || qa.answer || "Source Q&A used as support evidence.",
    resource: `app://maps/${map.id}/nodes/${node.id}/source-qa/${idx + 1}`,
    tags: ["support", "source-qa", map.id, node.id],
    timestamp: node.updatedAt || map.updatedAt || new Date().toISOString(),
    okf_version: "0.1",
    app_schema: "distill-support-map/v1",
    map_id: map.id,
    node_id: node.id,
    source_qa_index: idx + 1,
    category: qa.category || ""
  };
  const body = [
    "# Question",
    "",
    qa.question || "",
    "",
    "# Answer",
    "",
    qa.answer || "",
    "",
    "# Related Concept",
    "",
    `[${okfLinkTitle(node.title)}](${okfNodePath(map.id, node.id)})`
  ].join("\n");
  return okfConcept(frontmatter, body);
}

function nodeDescription(node) {
  if (node.type === "leaf") return node.rootCause || node.answer || node.title;
  if (node.type === "question") return node.nextQuestion || node.reason || node.title;
  return node.reason || node.title;
}

function agentInstructionForNode(node) {
  if (node.type === "leaf") return "This terminal node provides the root cause and answer. Use the answer text, cite attached evidence, and apply escalation guidance when conditions match.";
  if (node.type === "symptom") return "This entry node frames the initial user symptom. Compare the user request with outgoing outcomes and continue to the most relevant decision node.";
  return "This decision node is suitable for a subagent. Evaluate the user's message and available evidence against each outcome condition, return the selected branch label and confidence, or ask the follow-up question when the branch is ambiguous.";
}

async function loadOkfBundle() {
  if (!existsSync(OKF_DIR)) return false;
  try {
    const mapsDir = path.join(OKF_DIR, "maps");
    const nodesDir = path.join(OKF_DIR, "nodes");
    if (!existsSync(mapsDir) || !existsSync(nodesDir)) return false;

    const loadedWorkspaces = new Map();
    const workspacesDir = path.join(OKF_DIR, "workspaces");
    if (existsSync(workspacesDir)) {
      for (const entry of await readdir(workspacesDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "index.md") continue;
        const { frontmatter } = parseOkfConcept(await readFile(path.join(workspacesDir, entry.name), "utf8"));
        const id = String(frontmatter.workspace_id || path.basename(entry.name, ".md"));
        loadedWorkspaces.set(id, {
          id,
          label: String(frontmatter.title || id),
          description: String(frontmatter.description || ""),
          createdAt: String(frontmatter.created_at || frontmatter.timestamp || new Date().toISOString()),
          updatedAt: String(frontmatter.timestamp || "")
        });
      }
    }

    const loadedMaps = new Map();
    for (const entry of await readdir(mapsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "index.md") continue;
      const { frontmatter } = parseOkfConcept(await readFile(path.join(mapsDir, entry.name), "utf8"));
      const id = String(frontmatter.map_id || path.basename(entry.name, ".md"));
      loadedMaps.set(id, {
        id,
        label: String(frontmatter.title || id),
        workspaceId: String(frontmatter.workspace_id || DEFAULT_WORKSPACE_ID),
        source: String(frontmatter.source || "okf"),
        status: String(frontmatter.map_status || REVIEW_NODE_STATUS),
        createdAt: String(frontmatter.created_at || frontmatter.timestamp || new Date().toISOString()),
        updatedAt: String(frontmatter.timestamp || ""),
        settings: frontmatter.settings && typeof frontmatter.settings === "object" ? frontmatter.settings : {},
        mapping: frontmatter.mapping && typeof frontmatter.mapping === "object" ? frontmatter.mapping : {},
        nodes: [],
        edges: []
      });
    }

    for (const mapEntry of await readdir(nodesDir, { withFileTypes: true })) {
      if (!mapEntry.isDirectory()) continue;
      const map = [...loadedMaps.values()].find((item) => item.id === mapEntry.name || slugify(item.id) === mapEntry.name);
      if (!map) continue;
      const mapNodesDir = path.join(nodesDir, mapEntry.name);
      const edges = [];
      for (const entry of await readdir(mapNodesDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "index.md") continue;
        const { frontmatter } = parseOkfConcept(await readFile(path.join(mapNodesDir, entry.name), "utf8"));
        const node = okfFrontmatterToNode(frontmatter, entry.name);
        map.nodes.push(node);
        for (const outcome of Array.isArray(frontmatter.outcomes) ? frontmatter.outcomes : []) {
          const to = String(outcome.to_node_id || path.basename(String(outcome.to || ""), ".md"));
          if (!to) continue;
          edges.push({
            id: String(outcome.edge_id || uniqueEdgeId({ edges }, node.id, to, outcome.label || "next")),
            from: node.id,
            to,
            label: String(outcome.label || ""),
            condition: String(outcome.condition || "")
          });
        }
      }
      map.edges = edges;
    }

    if (!loadedMaps.size) return false;
    for (const [id, workspace] of loadedWorkspaces) workspacesStore.set(id, workspace);
    for (const [id, map] of loadedMaps) mapsStore.set(id, map);
    return true;
  } catch (error) {
    console.warn(`OKF bundle load failed: ${error.message}`);
    return false;
  }
}

function okfFrontmatterToNode(frontmatter, fileName) {
  const typeByOkf = {
    "Support Symptom": "symptom",
    "Decision Question": "question",
    "Root Cause": "leaf"
  };
  const node = {
    id: String(frontmatter.node_id || path.basename(fileName, ".md")),
    type: normalizeNodeType(frontmatter.node_kind || typeByOkf[frontmatter.type] || "question"),
    title: String(frontmatter.title || path.basename(fileName, ".md")),
    status: normalizeNodeStatus(frontmatter.status || REVIEW_NODE_STATUS),
    metrics: frontmatter.metrics && typeof frontmatter.metrics === "object" ? frontmatter.metrics : { resolved: 0, unresolved: 0 },
    sourceQa: normalizeSourceQa(frontmatter.source_qa || []),
    keywords: Array.isArray(frontmatter.keywords) ? frontmatter.keywords.map(String).slice(0, 12) : [],
    rootCause: String(frontmatter.root_cause || ""),
    answer: String(frontmatter.answer || ""),
    nextQuestion: String(frontmatter.next_question || ""),
    escalation: String(frontmatter.escalation || ""),
    reason: String(frontmatter.reason || ""),
    target: String(frontmatter.target || ""),
    action: String(frontmatter.action || ""),
    parentId: String(frontmatter.parent_id || ""),
    confidence: frontmatter.confidence == null ? undefined : normalizeConfidence(frontmatter.confidence),
    sample: String(frontmatter.sample || ""),
    createdAt: String(frontmatter.created_at || ""),
    updatedAt: String(frontmatter.timestamp || "")
  };
  if (frontmatter.position && typeof frontmatter.position === "object") node.position = normalizePosition(frontmatter.position);
  return node;
}

async function writeOkfBundle(workspaces, maps) {
  await ensureDataDir();
  await rm(OKF_DIR, { recursive: true, force: true });
  await mkdir(OKF_DIR, { recursive: true, mode: 0o700 });
  const allMaps = maps.filter((map) => map?.id && Array.isArray(map.nodes) && Array.isArray(map.edges));
  const addFile = async (relativePath, content) => {
    const filePath = path.join(OKF_DIR, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, content, { mode: 0o600 });
  };

  await addFile("index.md", okfRootIndex(workspaces, allMaps));
  await addFile("workspaces/index.md", okfDirectoryIndex("Workspaces", workspaces.map((workspace) => ({
    title: workspace.label,
    href: `${slugify(workspace.id)}.md`,
    description: workspace.description || ""
  }))));
  for (const workspace of workspaces) {
    await addFile(`workspaces/${slugify(workspace.id)}.md`, okfWorkspaceConcept(workspace, allMaps.filter((map) => (map.workspaceId || DEFAULT_WORKSPACE_ID) === workspace.id)));
  }
  await addFile("maps/index.md", okfDirectoryIndex("Maps", allMaps.map((map) => ({
    title: map.label,
    href: `${slugify(map.id)}.md`,
    description: `${map.nodes.length} nodes / ${map.edges.length} branches`
  }))));
  for (const map of allMaps) {
    await addFile(`maps/${slugify(map.id)}.md`, okfMapConcept(map));
    await addFile(`nodes/${slugify(map.id)}/index.md`, okfDirectoryIndex(`${map.label} Nodes`, map.nodes.map((node) => ({
      title: node.title,
      href: `${slugify(node.id)}.md`,
      description: `${okfTypeForNode(node)} / ${node.status || REVIEW_NODE_STATUS}`
    }))));
    for (const node of map.nodes) {
      await addFile(`nodes/${slugify(map.id)}/${slugify(node.id)}.md`, okfNodeConcept(map, node));
      for (const [idx, qa] of (node.sourceQa || []).entries()) {
        await addFile(`references/qa/${slugify(map.id)}/${slugify(node.id)}-${idx + 1}.md`, okfQaConcept(map, node, qa, idx));
      }
    }
  }
  await addFile("log.md", okfLogConcept());
}

function okfLogConcept() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "# Directory Update Log",
    "",
    `## ${today}`,
    `* **Update**: Regenerated OKF bundle from the current Distill support knowledge state.`
  ].join("\n") + "\n";
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
}

async function loadPersistedMaps() {
  if (!existsSync(MAPS_FILE)) return;
  try {
    const payload = JSON.parse(await readFile(MAPS_FILE, "utf8"));
    const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
    for (const workspace of workspaces) {
      if (!workspace?.id || !workspace?.label) continue;
      workspacesStore.set(workspace.id, workspace);
    }
    const maps = Array.isArray(payload.maps) ? payload.maps : [];
    for (const map of maps) {
      if (!map?.id || !Array.isArray(map.nodes) || !Array.isArray(map.edges)) continue;
      mapsStore.set(map.id, map);
    }
  } catch (error) {
    console.warn(`persisted map load failed: ${error.message}`);
  }
}

async function savePersistedMaps() {
  await ensureDataDir();
  const maps = [...mapsStore.values()];
  const workspaces = [...workspacesStore.values()];
  await writeOkfBundle(workspaces, maps);
  await writeFile(MAPS_FILE, JSON.stringify({ version: 2, savedAt: new Date().toISOString(), workspaces, maps }, null, 2), { mode: 0o600 });
}

function normalizeStoredMaps() {
  if (!workspacesStore.has(DEFAULT_WORKSPACE_ID)) {
    workspacesStore.set(DEFAULT_WORKSPACE_ID, { id: DEFAULT_WORKSPACE_ID, label: "サポート", description: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  for (const map of mapsStore.values()) {
    map.workspaceId ||= DEFAULT_WORKSPACE_ID;
    if (!workspacesStore.has(map.workspaceId)) {
      workspacesStore.set(map.workspaceId, { id: map.workspaceId, label: map.workspaceId, description: "", createdAt: map.createdAt || new Date().toISOString(), updatedAt: map.updatedAt || "" });
    }
    map.status ||= map.id === mindMap.id ? PUBLIC_NODE_STATUS : REVIEW_NODE_STATUS;
    map.updatedAt ||= map.createdAt || "";
    const normalizedEdges = [];
    const edgeMap = { ...map, edges: normalizedEdges };
    for (const edge of map.edges || []) normalizedEdges.push(normalizeEdge(edgeMap, edge));
    map.edges = normalizedEdges;
    for (const node of map.nodes || []) {
      node.status ||= map.id === mindMap.id ? PUBLIC_NODE_STATUS : REVIEW_NODE_STATUS;
      node.metrics ||= { resolved: 0, unresolved: 0 };
      node.sourceQa = normalizeSourceQa(node.sourceQa || []);
      node.keywords = Array.isArray(node.keywords) ? node.keywords.map(String).slice(0, 12) : tokenize(`${node.title || ""} ${node.sample || ""}`).slice(0, 8);
      if (node.position) node.position = normalizePosition(node.position);
      applyNodeTypeRules(node);
    }
  }
}

function applyFeedbackToNode(entry) {
  const map = mapsStore.get(entry.mapId);
  const node = map?.nodes?.find((item) => item.id === entry.nodeId);
  if (!node) return;
  node.metrics ||= { resolved: 0, unresolved: 0 };
  if (entry.outcome === "resolved") node.metrics.resolved = Number(node.metrics.resolved || 0) + 1;
  if (entry.outcome === "unresolved") {
    node.metrics.unresolved = Number(node.metrics.unresolved || 0) + 1;
    node.metrics.lastUnresolvedReason = entry.reason;
    if (node.status === PUBLIC_NODE_STATUS) node.status = REVIEW_NODE_STATUS;
  }
  node.updatedAt = new Date().toISOString();
  map.updatedAt = node.updatedAt;
}

async function readFeedbackEntries() {
  if (!existsSync(FEEDBACK_FILE)) return [];
  const text = await readFile(FEEDBACK_FILE, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

async function serveStatic(urlPath, res) {
  const decoded = decodeURIComponent(urlPath);
  const safePath = decoded === "/" || decoded === "/assistant.html" ? "/回答アシスタント.dc.html" : decoded;
  const filePath = path.normalize(path.join(__dirname, safePath));
  const relativePath = path.relative(__dirname, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return json(res, 403, { error: "forbidden" });
  if (!["回答アシスタント.dc.html", "app.js"].includes(relativePath)) return json(res, 404, { error: "not_found" });
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
