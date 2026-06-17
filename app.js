const tree = {
  nodes: [
    { id: "root", x: 6, y: 220, w: 150, kind: "症状", cls: "symptom", title: "ログインできない" },
    { id: "q1", x: 184, y: 222, w: 156, kind: "判断 01", title: "エラーメッセージが表示される？" },
    { id: "q2", x: 366, y: 92, w: 158, kind: "判断 02", title: "「パスワードが正しくありません」？" },
    { id: "q3", x: 366, y: 360, w: 158, kind: "判断 02", title: "画面が読み込まれない？" },
    { id: "l1", x: 552, y: 36, w: 162, kind: "根本原因", cls: "leaf amber", title: "パスワード失念", sub: "→ リセットメールを案内" },
    { id: "l2", x: 552, y: 140, w: 162, kind: "根本原因", cls: "leaf amber", title: "アカウントロック", sub: "→ 30分待機・手動解除" },
    { id: "l3", x: 552, y: 310, w: 162, kind: "根本原因", cls: "leaf green", title: "キャッシュ／Cookie不整合", sub: "→ シークレットW・再読込" },
    { id: "l4", x: 552, y: 414, w: 162, kind: "根本原因", cls: "leaf red", title: "SSO／IdP障害", sub: "→ 管理者へエスカレーション" }
  ],
  edges: [
    { from: "root", to: "q1", d: "M156 248 L184 248" },
    { from: "q1", to: "q2", label: "はい", lx: 344, ly: 160, d: "M340 248 C 362 248, 344 118, 366 118" },
    { from: "q1", to: "q3", label: "いいえ", lx: 344, ly: 316, d: "M340 248 C 362 248, 344 386, 366 386" },
    { from: "q2", to: "l1", label: "はい", lx: 528, ly: 84, d: "M524 118 C 540 118, 536 65, 552 65" },
    { from: "q2", to: "l2", label: "いいえ", lx: 528, ly: 140, d: "M524 118 C 540 118, 536 169, 552 169" },
    { from: "q3", to: "l3", label: "はい", lx: 528, ly: 354, d: "M524 386 C 540 386, 536 339, 552 339" },
    { from: "q3", to: "l4", label: "いいえ", lx: 528, ly: 410, d: "M524 386 C 540 386, 536 443, 552 443" }
  ]
};

const state = {
  view: "answer",
  path: [],
  current: null,
  messages: [],
  query: "",
  awaiting: false,
  importStep: 0,
  rows: [],
  columns: [],
  mapping: {},
  clusters: [],
  routeApprovals: [],
  summary: { appendCount: 0, newCount: 0, reflectedQa: 0 },
  extraction: {
    abstraction: "medium",
    integrateExisting: true,
    dedupe: true
  },
  lastAnswer: null,
  apiSource: "",
  zoom: { mindmap: 1.18, mapOnly: 1.42 },
  fullscreenMap: "",
  generatedMap: null,
  answerMapId: "login-auth",
  answerMapLabel: "ログイン・認証",
  generatedCurrent: "",
  flowMap: null,
  selectedFlowNodeId: "",
  selectedFlowEdgeId: "",
  flowDrag: null,
  flowAddParentId: "",
  flowModal: null,
  workspaces: [],
  activeWorkspaceId: "support",
  maps: [],
  activeMap: null,
  selectedNodeId: "",
  mapQuery: "",
  improvements: [],
  feedbackReason: "cause-mismatch",
  settings: {
    loaded: false,
    loading: false,
    saving: false,
    provider: "openai",
    hasOpenAIKey: false,
    hasAzureKey: false,
    openaiBaseUrl: "https://api.openai.com/v1",
    azureBaseUrl: "",
    azureApiVersion: "preview",
    model: "-",
    modelOptions: []
  }
};

const samples = [
  "パスワードを何度入れてもログインできません",
  "ログイン画面が真っ白で進めません",
  "社員全員が急にログインできなくなりました"
];

let flowRenderFrame = 0;
let positionSaveTimer = 0;

function $(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return displayValue(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function displayValue(value) {
  if (value == null) return "";
  if (typeof value === "object") return String(value.name || value.title || value.label || value.id || JSON.stringify(value));
  return String(value);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === view));
  document.querySelectorAll("[data-view-button]").forEach((btn) => btn.classList.toggle("active", btn.dataset.viewButton === view || (view === "maps" && btn.dataset.viewButton === "answer")));
  renderImport();
  if (view === "settings") renderSettings();
  if (view === "answer") {
    renderChat();
    renderComposer();
    renderWorkflowRail();
  }
  renderTrees();
}

function renderChat() {
  const chat = $("#chatScroll");
  const visibleSamples = state.generatedMap ? [...samples, "Webhookが発火しません"] : samples;
  const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const mapLabel = state.answerMapLabel || state.flowMap?.label || "マップ";
  const start = state.messages.length === 0 ? `
    <div class="intake-card">
      <div class="intake-meta"><span class="intake-badge">READY</span><span class="mono-label" style="color:var(--faint);">${escapeHtml(workspace?.label || "サポート")}</span></div>
      <h2>${escapeHtml(mapLabel)}</h2>
      <p>サポートに届いた質問を受け付けています。根拠マップを参照して原因候補と回答案を返します。</p>
    </div>
    <div class="samples">
      <div class="mono-label" style="color:var(--faint);">SAMPLE CASES</div>
      <div class="sample-grid">${visibleSamples.map((text) => `<button class="sample" data-sample="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("")}</div>
    </div>` : "";
  chat.innerHTML = start + state.messages.map((message) => {
    if (message.role === "user") return `<div class="msg user"><div class="bubble">${escapeHtml(message.text)}</div></div>`;
    if (message.kind === "answer") {
      return `<div class="msg"><div class="bot-badge">D</div><div class="answer-card">
        <header><div class="mono-label">根本原因 / ROOT CAUSE</div><h2>${escapeHtml(message.cause)}</h2></header>
        <div style="padding:12px 14px;"><div class="mono-label" style="color:var(--faint);">回答案</div><p>${escapeHtml(message.answer)}</p>
        ${message.evidence?.length ? `<div class="evidence-list"><div class="mono-label" style="color:var(--faint);">根拠Q&A</div>${message.evidence.slice(0, 2).map((item) => `<div class="evidence-item">Q. ${escapeHtml(item.question || item.sample || item)}<br>A. ${escapeHtml(item.answer || "")}</div>`).join("")}</div>` : ""}
        <div class="feedback-row"><select id="feedbackReason"><option value="cause-mismatch">原因違い</option><option value="answer-vague">回答が曖昧</option><option value="stale-procedure">手順が古い</option><option value="need-followup">追加確認が必要</option><option value="no-map">該当マップなし</option></select><button class="ghost" data-feedback="unresolved">未解決</button></div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;"><button class="primary" data-copy-answer="${escapeHtml(message.answer)}" style="font-size:12px;padding:7px 13px;">回答をコピー</button><button class="ghost" data-feedback="resolved">解決</button></div></div>
      </div></div>`;
    }
    if (message.kind === "match") {
      return `<div class="msg"><div class="bot-badge">D</div><div class="bubble">${escapeHtml(message.text)}
        ${message.candidates?.length ? `<div class="candidate-list">${message.candidates.map((candidate) => `<button class="candidate-chip" data-candidate-map="${escapeHtml(candidate.mapId)}">${escapeHtml(candidate.mapLabel)} <span>${candidate.confidence}%</span></button>`).join("")}</div>` : ""}
      </div></div>`;
    }
    return `<div class="msg"><div class="bot-badge">D</div><div class="bubble">${escapeHtml(message.text)}</div></div>`;
  }).join("");
  chat.querySelectorAll("[data-sample]").forEach((button) => button.addEventListener("click", () => submitQuestion(button.dataset.sample)));
  chat.querySelectorAll("[data-copy-answer]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await navigator.clipboard?.writeText(button.dataset.copyAnswer || "");
      toast("回答案をコピーしました。");
    } catch {
      toast("クリップボードにコピーできませんでした。回答文を選択してコピーしてください。");
    }
  }));
  chat.querySelectorAll("[data-feedback]").forEach((button) => button.addEventListener("click", () => sendFeedback(button.dataset.feedback)));
  chat.querySelectorAll("[data-candidate-map]").forEach((button) => button.addEventListener("click", async () => {
    await loadFlowMap(button.dataset.candidateMap);
    setView("answer");
    toast("回答アシスタントの思考プロセスに対象マップを表示しました。");
  }));
  chat.scrollTop = chat.scrollHeight;

  $("#matchMeta").hidden = state.messages.length === 0;
  const confidenceText = state.confidence == null ? "判定中" : `一致 ${state.confidence}%`;
  $("#matchText").textContent = `${state.answerMapLabel || "ログイン・認証"} マップ · ${confidenceText}`;
  $("#treeStatus").textContent = state.current ? (state.current.startsWith("l") ? "根本原因に到達" : `確認 ${Math.max(1, state.path.length - 1)} 件目`) : "待機中";
  renderWorkflowRail();
}

function renderWorkflowRail() {
  const rail = $("#answerWorkflow");
  if (!rail) return;
  const hasQuestion = state.messages.some((message) => message.role === "user");
  const hasMatch = state.messages.some((message) => message.kind === "match");
  const hasAnswer = state.messages.some((message) => message.kind === "answer");
  const steps = [
    { key: "intake", label: "受付", done: hasQuestion, active: !hasQuestion },
    { key: "match", label: "判定", done: hasMatch, active: hasQuestion && !hasMatch },
    { key: "follow", label: "確認", done: hasAnswer, active: state.awaiting },
    { key: "answer", label: "回答", done: hasAnswer, active: hasAnswer && !state.awaiting }
  ];
  rail.innerHTML = steps.map((step, idx) => {
    const cls = `${step.done ? "done" : ""} ${step.active ? "active" : ""}`.trim();
    return `<span class="workflow-step ${cls}" data-workflow-step="${step.key}">${escapeHtml(step.label)}</span>${idx < steps.length - 1 ? `<span class="workflow-divider"></span>` : ""}`;
  }).join("");
}

function renderComposer() {
  const composer = $("#composer");
  if (state.awaiting) {
    const options = currentDecisionOptions();
    if (!options.length) {
      composer.innerHTML = `<div class="composer-box"><input id="queryInput" value="${escapeHtml(state.query)}" placeholder="補足情報を入力…"><button class="send" id="sendBtn">➤</button></div>
        <button class="linkish" id="startOver" style="width:100%;font-size:11.5px;color:var(--faint);margin-top:6px;">最初からやり直す</button>`;
      $("#queryInput").addEventListener("input", (event) => { state.query = event.target.value; });
      $("#queryInput").addEventListener("keydown", (event) => { if (event.key === "Enter") submitQuestion(state.query); });
      $("#sendBtn").addEventListener("click", () => submitQuestion(state.query));
      $("#startOver").addEventListener("click", resetAnswer);
      return;
    }
    composer.innerHTML = `<div><div style="font-size:11px;color:var(--faint);text-align:center;margin-bottom:9px;">この質問に回答してください</div>
      <div class="decision-buttons">${options.map((option) => `<button class="${option.positive ? "yes" : ""}" data-decision-edge="${escapeHtml(option.edge.id)}">${escapeHtml(option.label)}</button>`).join("")}</div>
      <button class="linkish" id="startOver" style="width:100%;font-size:11.5px;color:var(--faint);margin-top:6px;">最初からやり直す</button></div>`;
    composer.querySelectorAll("[data-decision-edge]").forEach((button) => button.addEventListener("click", () => continuePath(button.dataset.decisionEdge)));
    $("#startOver").addEventListener("click", resetAnswer);
  } else {
    composer.innerHTML = `<div class="composer-box"><input id="queryInput" value="${escapeHtml(state.query)}" placeholder="問い合わせ内容を入力"><button class="send" id="sendBtn" aria-label="送信">➤</button></div>`;
    $("#queryInput").addEventListener("input", (event) => { state.query = event.target.value; });
    $("#queryInput").addEventListener("keydown", (event) => { if (event.key === "Enter") submitQuestion(state.query); });
    $("#sendBtn").addEventListener("click", () => submitQuestion(state.query));
  }
}

async function submitQuestion(text) {
  const query = String(text || "").trim();
  if (!query) return;
  state.messages = [{ role: "user", text: query }, { role: "bot", text: "既存マップとの一致と回答経路を判定しています…" }];
  state.path = ["root", "q1"];
  state.current = "q1";
  state.awaiting = false;
  state.confidence = null;
  state.query = "";
  renderAll();
  try {
    const result = await postJson("/api/answer", { query, history: state.messages, workspaceId: state.activeWorkspaceId });
    state.apiSource = result.source;
    state.confidence = result.confidence;
    state.path = result.path;
    state.current = result.path[result.path.length - 1];
    state.answerMapId = result.mapId || "login-auth";
    state.answerMapLabel = result.mapLabel || "ログイン・認証";
    state.generatedCurrent = state.answerMapId === state.generatedMap?.id ? state.current : "";
    await loadFlowMap(state.answerMapId, false);
    const needsFollowup = result.needsFollowup || (result.nextQuestion && result.confidence < 75);
    if (needsFollowup) alignCurrentToFollowupQuestion(result.nextQuestion);
    state.awaiting = Boolean(needsFollowup);
    state.pendingAnswer = needsFollowup ? result : null;
    state.lastAnswer = result;
    state.messages = [
      { role: "user", text: query },
      { role: "bot", kind: "match", text: `「${result.mapLabel}」マインドマップに一致しました（信頼度 ${result.confidence}%）。${result.rationale || ""}`, candidates: result.candidates || [] },
      needsFollowup
        ? { role: "bot", text: result.nextQuestion || "状況をもう少し確認してもよいですか？" }
        : { role: "bot", kind: "answer", cause: result.cause, answer: result.answer, evidence: result.evidence }
    ];
    if (result.source !== "openai") toast("OpenAI応答が使えなかったため、ローカル判定で継続しました。キーまたはモデル設定を確認できます。");
  } catch (error) {
    state.path = [];
    state.current = null;
    state.awaiting = false;
    state.messages = [
      { role: "user", text: query },
      { role: "bot", text: `回答の取得に失敗しました。通信状態を確認して、もう一度お試しください。${error.message ? `（${error.message}）` : ""}` }
    ];
    toast("回答の取得に失敗しました。");
  }
  renderAll();
}

function currentDecisionOptions() {
  const map = state.flowMap || fallbackFlowMap();
  return (map.edges || [])
    .filter((edge) => edge.from === state.current)
    .filter((edge) => String(edge.label || "").trim())
    .map((edge) => {
      const label = edge.label || "次へ";
      return { edge, label, positive: /^(はい|yes|true|ok)$/i.test(label) };
    });
}

function alignCurrentToFollowupQuestion(questionText = "") {
  const map = state.flowMap || fallbackFlowMap();
  const normalizedQuestion = normalizeInlineText(questionText);
  if (!normalizedQuestion) return;
  const askedNode = (map.nodes || []).find((node) => {
    const title = normalizeInlineText(node.title);
    const nextQuestion = normalizeInlineText(node.nextQuestion);
    return title === normalizedQuestion || nextQuestion === normalizedQuestion;
  });
  if (!askedNode) return;
  state.current = askedNode.id;
  if (!state.path.includes(askedNode.id)) state.path.push(askedNode.id);
}

function normalizeInlineText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function continuePath(edgeId) {
  const map = state.flowMap || fallbackFlowMap();
  const edge = (map.edges || []).find((item) => item.id === edgeId && item.from === state.current);
  if (!edge) {
    toast("このノードには選択できる分岐がありません。補足情報を入力してください。");
    state.awaiting = false;
    renderAll();
    return;
  }
  const next = edge.to;
  const nextNode = (map.nodes || []).find((node) => node.id === next);
  if (!nextNode) return;
  state.messages.push({ role: "user", text: edge.label || "次へ" });
  state.path.push(next);
  state.current = next;
  if (nextNode.type === "leaf") {
    state.awaiting = false;
    state.lastAnswer = {
      ...(state.lastAnswer || {}),
      mapId: map.id,
      mapLabel: map.label,
      path: state.path,
      cause: nextNode.rootCause || nextNode.title,
      answer: nextNode.answer || ""
    };
    state.messages.push({ role: "bot", kind: "answer", cause: nextNode.rootCause || nextNode.title, answer: nextNode.answer || "この原因に対応する回答案がまだ登録されていません。", evidence: nextNode.sourceQa || [] });
  } else {
    state.awaiting = true;
    state.messages.push({ role: "bot", text: nextNode.nextQuestion || nextNode.title });
  }
  renderAll();
}

function resetAnswer() {
  const mapId = state.flowMap?.id || state.maps[0]?.id || "login-auth";
  const mapLabel = state.flowMap?.label || state.maps[0]?.label || "ログイン・認証";
  Object.assign(state, { path: [], current: null, messages: [], query: "", awaiting: false, confidence: null, answerMapId: mapId, answerMapLabel: mapLabel, generatedCurrent: "", selectedFlowNodeId: "", selectedFlowEdgeId: "" });
  renderAll();
  loadFlowMap(mapId);
}

async function sendFeedback(outcome) {
  if (!state.lastAnswer) {
    toast("先に回答を生成してください。");
    return;
  }
  try {
    await postJson("/api/feedback", {
      outcome,
      reason: outcome === "unresolved" ? ($("#feedbackReason")?.value || state.feedbackReason) : "",
      mapId: state.lastAnswer.mapId,
      path: state.lastAnswer.path,
      cause: state.lastAnswer.cause,
      confidence: state.lastAnswer.confidence,
      source: state.apiSource
    });
    toast(outcome === "resolved" ? "解決フィードバックを記録しました。" : "未解決として改善キューに追加しました。");
  } catch (error) {
    toast(`フィードバックを記録できませんでした。${error.message || ""}`);
  }
}

function renderTrees() {
  renderTree($("#mindmap"), state.path, state.current, true, "mindmap");
  if (state.generatedMap) {
    renderGeneratedTree($("#mapOnly"), "mapOnly");
  } else {
    renderTree($("#mapOnly"), state.path, state.current, false, "mapOnly");
  }
  renderFlowToolbar();
  renderMapHeader();
}

function renderTree(container, path, current, showHint, zoomKey) {
  if (!container) return;
  const map = state.flowMap || fallbackFlowMap();
  const layout = layoutFlowMap(map);
  const nodes = layout.nodes;
  const edges = layout.edges;
  const started = path.length > 0;
  const inPath = (id) => path.includes(id);
  const pathPair = (edge) => inPath(edge.from) && inPath(edge.to) && path.indexOf(edge.to) === path.indexOf(edge.from) + 1;
  const zoom = state.zoom[zoomKey] || 1;
  container.style.setProperty("--map-zoom", zoom);
  container.classList.toggle("map-fullscreen", state.fullscreenMap === zoomKey);
  container.innerHTML = `
    <div class="map-content" style="width:${layout.width}px;height:${layout.height}px;">
      <svg viewBox="0 0 ${layout.width} ${layout.height}">
        <defs>
          <marker id="${zoomKey}ArrowNormal" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0 0 L6.5 3 L0 6 z" fill="#A0A6B0"></path></marker>
          <marker id="${zoomKey}ArrowPath" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0 0 L6.5 3 L0 6 z" fill="#4F46E5"></path></marker>
          <marker id="${zoomKey}ArrowSelected" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0 0 L6.5 3 L0 6 z" fill="#18181B"></path></marker>
        </defs>
        ${edges.map((edge) => {
          const selected = zoomKey === "mindmap" && state.selectedFlowEdgeId === edge.id;
          const pair = pathPair(edge);
          const marker = selected ? `${zoomKey}ArrowSelected` : pair ? `${zoomKey}ArrowPath` : `${zoomKey}ArrowNormal`;
          const stroke = selected ? "#18181B" : pair ? "#4F46E5" : "#A0A6B0";
          return `<path class="flow-edge ${selected ? "selected" : ""}" data-flow-edge="${escapeHtml(edge.id)}" d="${edge.d}" fill="none" stroke="${stroke}" stroke-width="${selected ? "3" : pair ? "2.4" : "1.5"}" marker-end="url(#${marker})" opacity="${started && !pair && !selected ? ".3" : "1"}"></path>`;
        }).join("")}
      </svg>
      ${edges.filter((edge) => edge.label).map((edge) => `<div class="edge-label ${edge.label === "はい" ? "yes" : ""} ${zoomKey === "mindmap" && state.selectedFlowEdgeId === edge.id ? "selected" : ""} ${started && !pathPair(edge) && state.selectedFlowEdgeId !== edge.id ? "dim" : ""}" data-flow-edge="${escapeHtml(edge.id)}" style="left:${edge.lx / layout.width * 100}%;top:${edge.ly / layout.height * 100}%;">${escapeHtml(edge.label)}</div>`).join("")}
      ${nodes.map((node) => `<div class="node ${node.cls || ""} ${current === node.id ? "active" : ""} ${zoomKey === "mindmap" && state.selectedFlowNodeId === node.id ? "selected" : ""} ${started && !inPath(node.id) ? "dim" : ""}" data-flow-node="${escapeHtml(node.id)}" style="left:${node.x / layout.width * 100}%;top:${node.y / layout.height * 100}%;width:${node.w / layout.width * 100}%;min-height:${node.h}px;">
        <span class="flow-handle in" aria-hidden="true"></span><span class="flow-handle out" aria-hidden="true"></span><button type="button" class="node-add" data-flow-add-node="${escapeHtml(node.id)}" title="右にノードを追加" aria-label="${escapeHtml(node.title)} の右にノードを追加">+</button>
        <span class="node-kind">${escapeHtml(node.kind)}</span><div class="node-title">${escapeHtml(node.title)}</div>${node.sub ? `<div class="node-sub">${escapeHtml(node.sub)}</div>` : ""}
      </div>`).join("")}
    </div>
    <div class="map-controls" aria-label="マップ表示倍率">
      <button class="zoom-button" data-zoom="${zoomKey}:out" title="ズームアウト">−</button>
      <span class="zoom-readout">${Math.round(zoom * 100)}%</span>
      <button class="zoom-button" data-zoom="${zoomKey}:in" title="ズームイン">+</button>
      <button class="zoom-button wide" data-zoom="${zoomKey}:reset" title="表示をリセット">100%</button>
      <button class="zoom-button full" data-zoom="${zoomKey}:fullscreen" title="${state.fullscreenMap === zoomKey ? "全画面を閉じる" : "全画面表示"}">${state.fullscreenMap === zoomKey ? "戻る" : "全画面"}</button>
    </div>
    ${showHint && !started ? `<div class="map-hint">質問を入力すると、ここを辿って回答します</div>` : ""}`;
  bindZoomControls(container, zoomKey);
  if (zoomKey === "mindmap") bindFlowSelection(container);
}

function fallbackFlowMap() {
  return {
    id: "login-auth",
    label: "ログイン・認証",
    nodes: tree.nodes.map((node) => ({ id: node.id, type: node.id === "root" ? "symptom" : node.id.startsWith("l") ? "leaf" : "question", title: node.title, answer: node.sub || "", status: "published" })),
    edges: tree.edges.map((edge, idx) => ({ id: `fallback-edge-${idx}`, from: edge.from, to: edge.to, label: edge.label || "" }))
  };
}

function layoutFlowMap(map) {
  const staticNodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const nodeRecords = map.nodes || [];
  const edges = (map.edges || []).filter((edge) => nodeRecords.some((node) => node.id === edge.from) && nodeRecords.some((node) => node.id === edge.to));
  const children = new Map();
  const hasParent = new Set();
  for (const edge of edges) {
    if (!children.has(edge.from)) children.set(edge.from, []);
    children.get(edge.from).push(edge.to);
    hasParent.add(edge.to);
  }
  const depth = new Map();
  const rootId = nodeRecords.some((node) => node.id === "root") ? "root" : nodeRecords[0]?.id;
  const queue = rootId ? [{ id: rootId, level: 0 }] : [];
  while (queue.length) {
    const item = queue.shift();
    if (depth.has(item.id)) continue;
    depth.set(item.id, item.level);
    for (const child of children.get(item.id) || []) queue.push({ id: child, level: item.level + 1 });
  }
  nodeRecords.forEach((node) => { if (!depth.has(node.id)) depth.set(node.id, Math.max(1, depth.size % 4)); });
  const autoPositions = new Map();
  let yCursor = 34;
  const assigned = new Set();
  const assignAutoPosition = (id, level) => {
    if (assigned.has(id)) return autoPositions.get(id);
    assigned.add(id);
    const childIds = (children.get(id) || []).filter((childId) => nodeRecords.some((node) => node.id === childId));
    const childPositions = childIds.map((childId) => assignAutoPosition(childId, level + 1)).filter(Boolean);
    const y = childPositions.length ? (childPositions[0].y + childPositions[childPositions.length - 1].y) / 2 : yCursor;
    if (!childPositions.length) yCursor += nodeHeight(nodeRecords.find((node) => node.id === id) || {}) + 28;
    const position = { x: 34 + level * 220, y };
    autoPositions.set(id, position);
    return position;
  };
  const roots = [
    ...new Set([
      rootId,
      ...nodeRecords.filter((node) => !hasParent.has(node.id)).map((node) => node.id),
      ...nodeRecords.map((node) => node.id)
    ].filter(Boolean))
  ];
  roots.forEach((id) => assignAutoPosition(id, depth.get(id) || 0));
  const positioned = nodeRecords.map((node) => {
    const staticNode = staticNodes.get(node.id);
    const level = depth.get(node.id) || 0;
    const w = staticNode?.w || 164;
    const h = nodeHeight(node);
    const auto = autoPositions.get(node.id) || { x: 34 + level * 220, y: 34 };
    const position = validPosition(node.position) ? node.position : null;
    const x = position?.x ?? auto.x;
    const y = position?.y ?? auto.y;
    return { ...node, x, y, w, h, kind: nodeKind(node), cls: nodeClass(node), sub: nodeSub(node) };
  });
  const width = Math.max(720, ...positioned.map((node) => node.x + node.w + 120));
  const height = Math.max(500, ...positioned.map((node) => node.y + node.h + 80));
  const byId = new Map(positioned.map((node) => [node.id, node]));
  const renderedEdges = edges.map((edge, idx) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    const forward = to.x >= from.x;
    const sx = forward ? from.x + from.w : from.x;
    const sy = from.y + from.h / 2;
    const tx = forward ? to.x : to.x + to.w;
    const ty = to.y + to.h / 2;
    const direction = forward ? 1 : -1;
    const curve = Math.max(58, Math.min(150, Math.abs(tx - sx) * 0.45));
    return {
      ...edge,
      id: edge.id || `edge-${idx}`,
      d: `M${sx} ${sy} C ${sx + direction * curve} ${sy}, ${tx - direction * curve} ${ty}, ${tx} ${ty}`,
      lx: (sx + tx) / 2 - 14,
      ly: (sy + ty) / 2 - 18
    };
  });
  return { width, height, nodes: positioned, edges: renderedEdges };
}

function validPosition(position) {
  return position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y));
}

function nodeHeight(node) {
  return nodeSub(node) ? 132 : 104;
}

function nodeKind(node) {
  if (node.type === "symptom") return "症状";
  if (node.type === "leaf") return "根本原因";
  return "判断";
}

function nodeClass(node) {
  if (node.type === "symptom") return "symptom";
  if (node.type !== "leaf") return "";
  if (node.status === "published") return "leaf green";
  if (node.status === "review") return "leaf amber";
  return "leaf red";
}

function nodeSub(node) {
  const type = normalizeNodeTypeClient(node.type);
  if (type === "symptom") return node.reason || "";
  if (type === "question") return node.nextQuestion || node.reason || "";
  if (node.answer) return node.answer.length > 28 ? `${node.answer.slice(0, 28)}...` : node.answer;
  return node.rootCause || "";
}

function bindFlowSelection(container) {
  container.querySelector(".map-content")?.addEventListener("click", () => {
    if (Date.now() < (state.flowSuppressClickUntil || 0)) return;
    state.selectedFlowNodeId = "";
    state.selectedFlowEdgeId = "";
    renderTrees();
  });
  container.querySelectorAll("[data-flow-node]").forEach((nodeEl) => {
    nodeEl.addEventListener("click", (event) => {
      event.stopPropagation();
      if (Date.now() < (state.flowSuppressClickUntil || 0)) return;
      state.selectedFlowNodeId = nodeEl.dataset.flowNode;
      state.selectedFlowEdgeId = "";
      renderTrees();
    });
    nodeEl.addEventListener("pointerdown", (event) => beginFlowNodeDrag(event, container, nodeEl));
    nodeEl.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      if (Date.now() < (state.flowSuppressClickUntil || 0)) return;
      state.selectedFlowNodeId = nodeEl.dataset.flowNode;
      openFlowNodeModal("edit");
    });
  });
  container.querySelectorAll("[data-flow-add-node]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const parentId = button.dataset.flowAddNode;
      state.selectedFlowNodeId = parentId;
      state.selectedFlowEdgeId = "";
      state.flowAddParentId = parentId;
      openFlowNodeModal("create", { type: "question", status: "review", title: "" });
    });
  });
  container.querySelectorAll("[data-flow-edge]").forEach((edgeEl) => {
    edgeEl.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedFlowEdgeId = edgeEl.dataset.flowEdge;
      state.selectedFlowNodeId = "";
      renderTrees();
    });
    edgeEl.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      state.selectedFlowEdgeId = edgeEl.dataset.flowEdge;
      openFlowEdgeModal("edit");
    });
  });
}

function beginFlowNodeDrag(event, container, nodeEl) {
  if (event.button !== 0 || event.target.closest(".node-add")) return;
  const map = state.flowMap;
  if (!map) return;
  const node = map.nodes.find((item) => item.id === nodeEl.dataset.flowNode);
  if (!node) return;
  event.preventDefault();
  event.stopPropagation();
  const layout = layoutFlowMap(map);
  const laidOut = layout.nodes.find((item) => item.id === node.id);
  state.flowDrag = {
    nodeId: node.id,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: laidOut?.x || 0,
    startY: laidOut?.y || 0,
    moved: false
  };
  state.selectedFlowNodeId = node.id;
  state.selectedFlowEdgeId = "";
  nodeEl.setPointerCapture?.(event.pointerId);
  const onMove = (moveEvent) => updateFlowNodeDrag(container, moveEvent);
  const onEnd = (endEvent) => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onEnd);
    document.removeEventListener("pointercancel", onEnd);
    finishFlowNodeDrag(endEvent);
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onEnd);
  document.addEventListener("pointercancel", onEnd);
}

function updateFlowNodeDrag(container, event) {
  const drag = state.flowDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const map = state.flowMap;
  const node = map?.nodes.find((item) => item.id === drag.nodeId);
  if (!node) return;
  const zoom = state.zoom.mindmap || 1;
  const dx = (event.clientX - drag.startClientX) / zoom;
  const dy = (event.clientY - drag.startClientY) / zoom;
  if (Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) > 3) drag.moved = true;
  node.position = {
    x: Math.max(8, Math.round(drag.startX + dx)),
    y: Math.max(8, Math.round(drag.startY + dy))
  };
  scheduleFlowRender();
}

function finishFlowNodeDrag(event) {
  const drag = state.flowDrag;
  state.flowDrag = null;
  if (!drag) return;
  if (drag.moved) {
    state.flowSuppressClickUntil = Date.now() + 250;
    persistNodePosition(drag.nodeId);
  }
}

function scheduleFlowRender() {
  if (flowRenderFrame) return;
  flowRenderFrame = requestAnimationFrame(() => {
    flowRenderFrame = 0;
    renderTrees();
  });
}

function persistNodePosition(nodeId) {
  window.clearTimeout(positionSaveTimer);
  positionSaveTimer = window.setTimeout(async () => {
    const map = state.flowMap;
    const node = map?.nodes.find((item) => item.id === nodeId);
    if (!map || !node?.position) return;
    try {
      await putJson(`/api/maps/${encodeURIComponent(map.id)}/nodes/${encodeURIComponent(nodeId)}`, { position: node.position });
    } catch (error) {
      toast(`ノード位置を保存できませんでした。${error.message || ""}`);
    }
  }, 180);
}

async function loadFlowMap(mapId = "login-auth", rerender = true) {
  try {
    const result = await getJson(`/api/maps/${encodeURIComponent(mapId)}`);
    state.flowMap = result.map;
    state.answerMapId = result.map.id;
    state.answerMapLabel = result.map.label;
    if (state.selectedFlowNodeId && !result.map.nodes.some((node) => node.id === state.selectedFlowNodeId)) state.selectedFlowNodeId = "";
    if (state.selectedFlowEdgeId && !result.map.edges.some((edge) => edge.id === state.selectedFlowEdgeId)) state.selectedFlowEdgeId = "";
    if (rerender) renderTrees();
  } catch (error) {
    toast(`マップを読み込めませんでした。${error.message || ""}`);
  }
}

async function loadWorkspaces() {
  try {
    const result = await getJson("/api/workspaces");
    state.workspaces = result.workspaces || [];
    const stored = localStorage.getItem("distill.workspaceId");
    const preferred = state.activeWorkspaceId || stored || result.activeWorkspaceId || "support";
    state.activeWorkspaceId = state.workspaces.some((workspace) => workspace.id === preferred) ? preferred : (state.workspaces[0]?.id || "support");
    renderWorkspaceControls();
    await loadMapWorkspace(true);
  } catch (error) {
    toast(`ワークスペースを読み込めませんでした。${error.message || ""}`);
  }
}

function renderWorkspaceControls() {
  document.querySelectorAll("[data-workspace-controls]").forEach((container) => {
    const workspaces = state.workspaces.length ? state.workspaces : [{ id: state.activeWorkspaceId, label: "サポート" }];
    container.innerHTML = `<select aria-label="ワークスペース" data-workspace-select>${workspaces.map((workspace) => `<option value="${escapeHtml(workspace.id)}" ${workspace.id === state.activeWorkspaceId ? "selected" : ""}>${escapeHtml(workspace.label)}</option>`).join("")}</select><button class="ghost" type="button" data-create-workspace>ワークスペース作成</button>`;
    container.querySelector("[data-workspace-select]")?.addEventListener("change", (event) => selectWorkspace(event.target.value));
    container.querySelector("[data-create-workspace]")?.addEventListener("click", openWorkspaceModal);
  });
}

async function selectWorkspace(workspaceId) {
  if (!workspaceId || workspaceId === state.activeWorkspaceId) return;
  state.activeWorkspaceId = workspaceId;
  localStorage.setItem("distill.workspaceId", workspaceId);
  Object.assign(state, { path: [], current: null, messages: [], query: "", awaiting: false, confidence: null, generatedMap: null, generatedCurrent: "", selectedFlowNodeId: "", selectedFlowEdgeId: "", flowMap: null, activeMap: null, selectedNodeId: "" });
  renderAll();
  await loadMapWorkspace(true);
  renderAll();
}

function openWorkspaceModal() {
  state.flowModal = { kind: "workspace", mode: "create", id: "" };
  openFlowModal("ワークスペース作成", `
    <div class="modal-grid">
      <div class="field full"><label>ワークスペース名</label><input id="workspaceLabel" placeholder="例：請求・課金サポート"></div>
      <div class="field full"><label>用途メモ</label><textarea id="workspaceDescription" rows="3" placeholder="このユースケースで扱う問い合わせ、部門、対象プロダクトなど"></textarea></div>
    </div>`);
}

function renderFlowToolbar() {
  const toolbar = $("#flowToolbar");
  if (!toolbar) return;
  const map = state.flowMap || fallbackFlowMap();
  const selectedNode = map.nodes.find((node) => node.id === state.selectedFlowNodeId);
  const selectedEdge = map.edges.find((edge) => edge.id === state.selectedFlowEdgeId);
  const selectedText = selectedNode ? `選択: ${selectedNode.title}` : selectedEdge ? `選択: ${selectedEdge.label || selectedEdge.id}` : "未選択";
  toolbar.innerHTML = `
    <span class="flow-selection">${escapeHtml(selectedText)}</span>
    <span class="flow-action-group">
      <button class="ghost" data-flow-action="add-node">+ ノード</button>
      <button class="ghost" data-flow-action="add-edge">+ 分岐</button>
    </span>
    <span class="flow-action-group">
      <button class="ghost" data-flow-action="edit" ${selectedNode || selectedEdge ? "" : "disabled"}>編集</button>
      <button class="ghost danger" data-flow-action="delete" ${selectedNode || selectedEdge ? "" : "disabled"}>削除</button>
      <button class="ghost" data-flow-action="manage">管理</button>
      <button class="ghost" data-flow-action="reload">更新</button>
    </span>`;
  toolbar.querySelectorAll("[data-flow-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.flowAction;
    if (action === "add-node") openFlowNodeModal("create");
    if (action === "add-edge") openFlowEdgeModal("create");
    if (action === "edit") {
      if (state.selectedFlowNodeId) openFlowNodeModal("edit");
      else if (state.selectedFlowEdgeId) openFlowEdgeModal("edit");
    }
    if (action === "delete") deleteSelectedFlowItem();
    if (action === "manage") {
      setView("maps");
      await selectMap((state.flowMap || fallbackFlowMap()).id);
    }
    if (action === "reload") loadFlowMap(state.answerMapId || "login-auth");
  }));
}

function openFlowNodeModal(mode, draft = null) {
  const map = state.flowMap || fallbackFlowMap();
  const node = mode === "edit" ? map.nodes.find((item) => item.id === state.selectedFlowNodeId) : null;
  if (mode === "edit" && !node) return toast("編集するノードを選択してください。");
  const values = { type: "question", status: "review", ...(node || {}), ...(draft || {}) };
  const type = normalizeNodeTypeClient(values.type);
  state.flowModal = { kind: "node", mode, id: node?.id || "" };
  openFlowModal(`${mode === "create" ? "ノード追加" : "ノード編集"}`, `
    <div class="modal-grid">
      <div class="field full"><label>${escapeHtml(nodeTitleLabel(type))}</label><input id="flowNodeTitle" value="${escapeHtml(values.title || "")}" placeholder="${escapeHtml(nodeTitlePlaceholder(type))}"><small>${escapeHtml(nodeTypeHelp(type))}</small></div>
      <div class="field"><label>種類</label><select id="flowNodeType">
        ${["symptom:症状", "question:判断", "leaf:根本原因"].map((item) => {
          const [value, label] = item.split(":");
          return `<option value="${value}" ${type === value ? "selected" : ""}>${label}</option>`;
        }).join("")}
      </select></div>
      <div class="field"><label>状態</label><select id="flowNodeStatus">
        ${["draft:下書き", "review:レビュー", "published:公開", "rejected:差し戻し"].map((item) => {
          const [value, label] = item.split(":");
          return `<option value="${value}" ${(values.status || "review") === value ? "selected" : ""}>${label}</option>`;
        }).join("")}
      </select></div>
      ${renderFlowNodeTypeFields(type, values)}
      ${mode === "create" ? `<div class="field"><label>接続元</label><select id="flowNodeParent"><option value="">接続しない</option>${map.nodes.map((item) => `<option value="${escapeHtml(item.id)}" ${(state.flowAddParentId || state.selectedFlowNodeId) === item.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}</select></div><div class="field"><label>分岐ラベル</label><input id="flowNodeEdgeLabel" value="追加"></div>` : ""}
    </div>`);
  $("#flowNodeType")?.addEventListener("change", () => openFlowNodeModal(mode, { ...collectFlowNodeDraft(), type: $("#flowNodeType").value }));
}

function renderFlowNodeTypeFields(type, node) {
  if (type === "symptom") {
    return `<div class="field full"><label>入口メモ</label><textarea id="flowNodeReason" rows="3" placeholder="例：ユーザーが最初に訴える症状、対象サービス、除外したいケース">${escapeHtml(node.reason || "")}</textarea></div>`;
  }
  if (type === "question") {
    return `
      <div class="field full"><label>判断基準</label><textarea id="flowNodeReason" rows="3" placeholder="例：エラー文が表示されている場合は「はい」、画面表示のみなら「いいえ」">${escapeHtml(node.reason || "")}</textarea></div>
      <div class="field full"><label>補足確認文</label><input id="flowNodeNextQuestion" value="${escapeHtml(node.nextQuestion || "")}" placeholder="回答中に追加で聞く場合のみ入力"></div>`;
  }
  return `
    <div class="field full"><label>根本原因</label><input id="flowNodeRootCause" value="${escapeHtml(node.rootCause || node.title || "")}" placeholder="例：認証コード未着"></div>
    <div class="field full"><label>回答案</label><textarea id="flowNodeAnswer" rows="5" placeholder="ユーザーへ返す案内文">${escapeHtml(node.answer || "")}</textarea></div>
    <div class="field full"><label>エスカレーション条件</label><textarea id="flowNodeEscalation" rows="2" placeholder="例：複数ユーザーで同時発生する場合">${escapeHtml(node.escalation || "")}</textarea></div>
    <div class="field full"><label>レビュー理由</label><textarea id="flowNodeReason" rows="2" placeholder="根拠、注意点、未解決フィードバックの要点">${escapeHtml(node.reason || "")}</textarea></div>`;
}

function collectFlowNodeDraft() {
  return {
    title: $("#flowNodeTitle")?.value || "",
    type: $("#flowNodeType")?.value || "question",
    status: $("#flowNodeStatus")?.value || "review",
    rootCause: $("#flowNodeRootCause")?.value || "",
    nextQuestion: $("#flowNodeNextQuestion")?.value || "",
    answer: $("#flowNodeAnswer")?.value || "",
    escalation: $("#flowNodeEscalation")?.value || "",
    reason: $("#flowNodeReason")?.value || ""
  };
}

function collectFlowNodePayload() {
  const draft = collectFlowNodeDraft();
  const type = normalizeNodeTypeClient(draft.type);
  const payload = {
    title: draft.title.trim(),
    type,
    status: draft.status
  };
  if (type === "symptom") payload.reason = draft.reason.trim();
  if (type === "question") {
    payload.nextQuestion = draft.nextQuestion.trim();
    payload.reason = draft.reason.trim();
  }
  if (type === "leaf") {
    payload.rootCause = (draft.rootCause || draft.title).trim();
    payload.answer = draft.answer.trim();
    payload.escalation = draft.escalation.trim();
    payload.reason = draft.reason.trim();
  }
  return payload;
}

function validateNodePayload(payload) {
  if (!payload.title) return "タイトルを入力してください。";
  if (payload.type === "leaf" && !payload.answer) return "根本原因ノードには回答案が必要です。";
  return "";
}

function normalizeNodeTypeClient(type) {
  return ["symptom", "question", "leaf"].includes(type) ? type : "question";
}

function nodeTypeLabel(type) {
  return ({ symptom: "症状", question: "判断", leaf: "根本原因" }[normalizeNodeTypeClient(type)] || "判断");
}

function nodeTitleLabel(type) {
  return ({ symptom: "起点症状", question: "判断質問", leaf: "原因名" }[normalizeNodeTypeClient(type)] || "タイトル");
}

function nodeTitlePlaceholder(type) {
  return ({
    symptom: "例：ログインできない",
    question: "例：エラーメッセージが表示される？",
    leaf: "例：認証コード未着"
  }[normalizeNodeTypeClient(type)] || "例：確認項目");
}

function nodeTypeHelp(type) {
  return ({
    symptom: "問い合わせの入口です。原因や回答案はここには持たせません。",
    question: "分岐のための確認項目です。根本原因や回答案は終端ノードに書きます。",
    leaf: "回答に使う終端ノードです。原因、回答案、エスカレーション条件を持ちます。"
  }[normalizeNodeTypeClient(type)] || "");
}

function openFlowEdgeModal(mode) {
  const map = state.flowMap || fallbackFlowMap();
  const edge = mode === "edit" ? map.edges.find((item) => item.id === state.selectedFlowEdgeId) : null;
  if (mode === "edit" && !edge) return toast("編集する分岐を選択してください。");
  state.flowModal = { kind: "edge", mode, id: edge?.id || "" };
  const options = map.nodes.map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.title)}</option>`).join("");
  openFlowModal(`${mode === "create" ? "分岐追加" : "分岐編集"}`, `
    <div class="modal-grid">
      <div class="field"><label>接続元ノード</label><select id="flowEdgeFrom">${options}</select></div>
      <div class="field"><label>接続先ノード</label><select id="flowEdgeTo">${options}</select></div>
      <div class="field full"><label>分岐ラベル</label><input id="flowEdgeLabel" value="${escapeHtml(edge?.label || "")}" placeholder="はい / いいえ / 該当する"></div>
      <div class="field full"><label>分岐条件</label><textarea id="flowEdgeCondition" rows="3">${escapeHtml(edge?.condition || "")}</textarea></div>
    </div>`);
  $("#flowEdgeFrom").value = edge?.from || state.selectedFlowNodeId || map.nodes[0]?.id || "";
  $("#flowEdgeTo").value = edge?.to || map.nodes.find((node) => node.id !== $("#flowEdgeFrom").value)?.id || "";
}

function openFlowModal(title, bodyHtml) {
  const modal = $("#flowModal");
  $("#flowModalTitle").textContent = title;
  $("#flowModalBody").innerHTML = bodyHtml;
  modal.hidden = false;
  modal.querySelector("input, select, textarea")?.focus();
}

function closeFlowModal() {
  const modal = $("#flowModal");
  if (!modal) return;
  modal.hidden = true;
  state.flowModal = null;
  state.flowAddParentId = "";
}

async function saveFlowModal() {
  const map = state.flowMap || fallbackFlowMap();
  const modal = state.flowModal;
  if (!modal) return;
  try {
    if (modal.kind === "workspace") {
      const label = ($("#workspaceLabel")?.value || "").trim();
      if (!label) return toast("ワークスペース名を入力してください。");
      const result = await postJson("/api/workspaces", { label, description: $("#workspaceDescription")?.value || "" });
      state.workspaces.push(result.workspace);
      state.activeWorkspaceId = result.workspace.id;
      localStorage.setItem("distill.workspaceId", state.activeWorkspaceId);
      Object.assign(state, { maps: [], activeMap: result.map, flowMap: result.map, answerMapId: result.map.id, answerMapLabel: result.map.label, path: [], current: null, messages: [], awaiting: false, confidence: null });
      closeFlowModal();
      await loadMapWorkspace(true);
      renderAll();
      toast("ワークスペースを作成しました。");
      return;
    }
    if (modal.kind === "node") {
      const payload = collectFlowNodePayload();
      const validation = validateNodePayload(payload);
      if (validation) return toast(validation);
      const parentId = $("#flowNodeParent")?.value || "";
      if (modal.mode === "create" && parentId) payload.position = newNodePosition(parentId);
      const result = modal.mode === "create"
        ? await postJson(`/api/maps/${encodeURIComponent(map.id)}/nodes`, { ...payload, parentId, edgeLabel: $("#flowNodeEdgeLabel")?.value || "追加" })
        : await putJson(`/api/maps/${encodeURIComponent(map.id)}/nodes/${encodeURIComponent(modal.id)}`, payload);
      state.selectedFlowNodeId = result.node.id;
      state.selectedFlowEdgeId = "";
      state.flowAddParentId = "";
    } else {
      const payload = {
        from: $("#flowEdgeFrom").value,
        to: $("#flowEdgeTo").value,
        label: $("#flowEdgeLabel").value,
        condition: $("#flowEdgeCondition").value
      };
      const result = modal.mode === "create"
        ? await postJson(`/api/maps/${encodeURIComponent(map.id)}/edges`, payload)
        : await putJson(`/api/maps/${encodeURIComponent(map.id)}/edges/${encodeURIComponent(modal.id)}`, payload);
      state.selectedFlowEdgeId = result.edge.id;
      state.selectedFlowNodeId = "";
    }
    closeFlowModal();
    await loadFlowMap(map.id);
    toast("マップを保存しました。");
  } catch (error) {
    toast(`保存できませんでした。${error.message || ""}`);
  }
}

function newNodePosition(parentId) {
  const map = state.flowMap || fallbackFlowMap();
  const layout = layoutFlowMap(map);
  const parent = layout.nodes.find((node) => node.id === parentId);
  if (!parent) return { x: 260, y: 120 };
  const x = parent.x + parent.w + 92;
  const occupied = layout.nodes.filter((node) => Math.abs(node.x - x) < 120).map((node) => node.y);
  let y = parent.y;
  while (occupied.some((usedY) => Math.abs(usedY - y) < 88)) y += 104;
  return { x: Math.round(x), y: Math.round(y) };
}

async function deleteSelectedFlowItem() {
  const map = state.flowMap || fallbackFlowMap();
  const edgeId = state.selectedFlowEdgeId;
  const nodeId = state.selectedFlowNodeId;
  if (!edgeId && !nodeId) return toast("削除するノードまたは分岐を選択してください。");
  const target = edgeId ? "分岐" : "ノード";
  if (!window.confirm(`${target}を削除します。よろしいですか？`)) return;
  try {
    const path = edgeId ? `edges/${encodeURIComponent(edgeId)}` : `nodes/${encodeURIComponent(nodeId)}`;
    await deleteJson(`/api/maps/${encodeURIComponent(map.id)}/${path}`);
    state.selectedFlowEdgeId = "";
    state.selectedFlowNodeId = "";
    await loadFlowMap(map.id);
    toast(`${target}を削除しました。`);
  } catch (error) {
    toast(`削除できませんでした。${error.message || ""}`);
  }
}

function bindZoomControls(container, zoomKey) {
  container.querySelectorAll("[data-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      const [, action] = button.dataset.zoom.split(":");
      updateZoom(zoomKey, action);
    });
  });
  container.onwheel = (event) => {
    if (!event.altKey && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    updateZoom(zoomKey, event.deltaY > 0 ? "out" : "in");
  };
}

function updateZoom(zoomKey, action) {
  if (action === "fullscreen") {
    state.fullscreenMap = state.fullscreenMap === zoomKey ? "" : zoomKey;
    renderTrees();
    return;
  }
  const current = state.zoom[zoomKey] || 1;
  const next = action === "reset" ? 1 : current + (action === "in" ? 0.12 : -0.12);
  state.zoom[zoomKey] = Math.max(0.5, Math.min(2.2, Number(next.toFixed(2))));
  renderTrees();
}

function renderGeneratedTree(container, zoomKey, activeNodeId = "") {
  if (!container) return;
  const zoom = state.zoom[zoomKey] || 1;
  const clusters = (state.generatedMap?.clusters || []).slice(0, 8);
  const root = { x: 34, y: 214, w: 158, title: state.generatedMap?.title || "CSV取り込みマップ" };
  const slots = [
    { x: 280, y: 34 }, { x: 280, y: 126 }, { x: 280, y: 218 }, { x: 280, y: 310 }, { x: 280, y: 402 },
    { x: 532, y: 80 }, { x: 532, y: 218 }, { x: 532, y: 356 }
  ];
  container.style.setProperty("--map-zoom", zoom);
  container.classList.toggle("map-fullscreen", state.fullscreenMap === zoomKey);
  container.innerHTML = `
    <div class="map-content">
      <svg viewBox="0 0 720 500">
        <defs>
          <marker id="${zoomKey}GeneratedArrow" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0 0 L6.5 3 L0 6 z" fill="#4F46E5"></path></marker>
        </defs>
        ${clusters.map((cluster, idx) => {
          const slot = slots[idx];
          const startX = root.x + root.w;
          const startY = root.y + 36;
          const endX = slot.x;
          const endY = slot.y + 36;
          return `<path d="M${startX} ${startY} C ${startX + 48} ${startY}, ${endX - 48} ${endY}, ${endX} ${endY}" fill="none" stroke="#4F46E5" stroke-width="1.8" marker-end="url(#${zoomKey}GeneratedArrow)" opacity=".78"></path>`;
        }).join("")}
      </svg>
      <div class="node symptom active" style="left:${root.x / 720 * 100}%;top:${root.y / 500 * 100}%;width:${root.w / 720 * 100}%;">
        <span class="node-kind">CSV MAP</span><div class="node-title">${escapeHtml(root.title)}</div><div class="node-sub">${clusters.length} クラスタを反映</div>
      </div>
      ${clusters.map((cluster, idx) => {
        const slot = slots[idx];
        const cls = cluster.action === "create" ? "leaf green" : "leaf amber";
        const kind = cluster.action === "create" ? "新規マップ" : "既存へ追加";
        return `<div class="node ${cls} ${activeNodeId === cluster.nodeId ? "active" : ""}" style="left:${slot.x / 720 * 100}%;top:${slot.y / 500 * 100}%;width:${166 / 720 * 100}%;">
          <span class="node-kind">${kind}</span><div class="node-title">${escapeHtml(cluster.title)}</div><div class="node-sub">${escapeHtml(cluster.target)} · ${Number(cluster.size || 1)}件</div>
        </div>`;
      }).join("")}
    </div>
    <div class="map-controls" aria-label="マップ表示倍率">
      <button class="zoom-button" data-zoom="${zoomKey}:out" title="ズームアウト">−</button>
      <span class="zoom-readout">${Math.round(zoom * 100)}%</span>
      <button class="zoom-button" data-zoom="${zoomKey}:in" title="ズームイン">+</button>
      <button class="zoom-button wide" data-zoom="${zoomKey}:reset" title="表示をリセット">100%</button>
      <button class="zoom-button full" data-zoom="${zoomKey}:fullscreen" title="${state.fullscreenMap === zoomKey ? "全画面を閉じる" : "全画面表示"}">${state.fullscreenMap === zoomKey ? "戻る" : "全画面"}</button>
    </div>`;
  bindZoomControls(container, zoomKey);
}

function renderMapHeader() {
  const title = $("#mapTitle");
  const subtitle = $("#mapSubtitle");
  if (!title || !subtitle) return;
  if (state.generatedMap) {
    const clusters = state.generatedMap.clusters || [];
    const qaCount = clusters.reduce((sum, cluster) => sum + Number(cluster.size || 0), 0);
    title.textContent = `マップ管理：${state.generatedMap.title}`;
    subtitle.textContent = `${clusters.length}クラスタ · ${qaCount}件のQ&Aから生成`;
    $("#exportActions")?.removeAttribute("hidden");
  } else {
    const map = state.flowMap || fallbackFlowMap();
    const published = map.nodes.filter((node) => node.status === "published").length;
    const review = map.nodes.filter((node) => node.status === "review").length;
    title.textContent = `マップ管理：${map.label || "未選択"}`;
    subtitle.textContent = `${map.nodes.length}ノード · ${published}公開 · ${review}レビュー待ち`;
    $("#exportActions")?.setAttribute("hidden", "");
  }
}

async function finalizeImport() {
  const approvedClusters = state.clusters.filter((cluster) => cluster.approved);
  const clusters = (approvedClusters.length ? approvedClusters : state.clusters).map((cluster) => ({ ...cluster }));
  try {
    const result = await postJson("/api/maps/import", {
      title: "CSV取り込みマップ",
      clusters,
      settings: state.extraction,
      mapping: state.mapping,
      workspaceId: state.activeWorkspaceId
    });
    state.generatedMap = mapFromServer(result.map, clusters);
    state.activeMap = result.map;
    state.flowMap = result.map;
    state.answerMapId = result.map.id;
    state.answerMapLabel = result.map.label;
    state.selectedNodeId = result.map.nodes.find((node) => node.type === "leaf")?.id || "root";
  } catch (error) {
    state.generatedMap = { id: `local-${Date.now()}`, title: "CSV取り込みマップ", clusters: clusters.map((cluster, idx) => ({ ...cluster, nodeId: `c${idx + 1}` })) };
    toast(`マップ保存APIが使えないため、画面内だけで生成しました。${error.message || ""}`);
  }
  state.importStep = 4;
  renderImport();
  renderTrees();
}

function mapFromServer(map, fallbackClusters = []) {
  const leaves = (map?.nodes || []).filter((node) => node.type === "leaf");
  return {
    id: map?.id || `local-${Date.now()}`,
    title: map?.label || "CSV取り込みマップ",
    clusters: leaves.map((node, idx) => ({
      nodeId: node.id,
      title: node.title,
      size: node.size || fallbackClusters[idx]?.size || 1,
      sample: node.sample || fallbackClusters[idx]?.sample || "",
      action: node.action || fallbackClusters[idx]?.action || "append",
      target: node.target || fallbackClusters[idx]?.target || "未分類",
      confidence: node.confidence || fallbackClusters[idx]?.confidence || 80,
      reason: node.reason || fallbackClusters[idx]?.reason || "",
      answer: node.answer || "",
      sourceQa: node.sourceQa || fallbackClusters[idx]?.sourceQa || []
    }))
  };
}

function renderImport() {
  if (state.view !== "import") return;
  renderStepper();
  const content = $("#importContent");
  if (state.importStep === 0) {
    content.innerHTML = `<div class="drop"><div class="drop-card"><div class="upload-icon">⇧</div><div style="font-size:15px;font-weight:700;margin-top:16px;">CSVファイルをドラッグ＆ドロップ</div><div style="font-size:12.5px;color:var(--faint);margin-top:6px;">またはクリックしてファイルを選択</div><button class="primary" id="pickFile" style="margin-top:18px;">ファイルを選択</button><div style="font:600 11px/1 'JetBrains Mono';color:var(--faint);margin-top:18px;">Q&Aのペアを含むCSV · UTF-8 · 最大 10MB</div></div><button class="linkish" id="sampleCsv" style="margin-top:12px;color:var(--brand);">サンプルCSVで試す →</button></div>`;
    $("#pickFile").addEventListener("click", () => $("#fileInput").click());
    $("#sampleCsv").addEventListener("click", loadSampleCsv);
    bindDropZone(content.querySelector(".drop-card"));
  } else if (state.importStep === 1) {
    renderMapping(content);
  } else if (state.importStep === 2) {
    renderPreview(content);
  } else if (state.importStep === 3) {
    renderRoutes(content);
  } else {
    renderDone(content);
  }
}

function renderStepper() {
  const labels = ["アップロード", "列マッピング", "プレビュー", "振り分け"];
  $("#stepper").innerHTML = labels.map((label, idx) => {
    const cls = state.importStep > idx ? "done" : state.importStep === idx ? "now" : "";
    return `<div class="step ${cls}"><span class="step-num">${state.importStep > idx ? "✓" : idx + 1}</span><span>${label}</span></div>${idx < labels.length - 1 ? `<span style="width:42px;height:2px;background:var(--line-strong);border-radius:2px;"></span>` : ""}`;
  }).join("");
}

function renderMapping(content) {
  const options = state.columns.map((col) => `<option>${escapeHtml(col)}</option>`).join("");
  content.innerHTML = `<div style="max-width:760px;margin:28px auto;padding:0 24px;">
    <div class="panel" style="display:flex;align-items:center;gap:11px;padding:12px 14px;"><div class="upload-icon" style="width:34px;height:34px;background:var(--green-soft);color:#1c6b4f;">✓</div><div><div style="font-size:13.5px;font-weight:700;">${escapeHtml(state.fileName || "support_qa_2024Q2.csv")}</div><div style="font:600 11px/1.4 'JetBrains Mono';color:var(--faint);">${state.rows.length.toLocaleString()} 行 · ${state.columns.length} 列</div></div><span class="tag create" style="margin-left:auto;">読み込み完了</span></div>
    <h2 style="font-size:14px;margin:22px 0 4px;">列のマッピング</h2><p style="font-size:12.5px;color:var(--muted);margin:0;">AIが各列の役割を自動判定しました。必要に応じて変更してください。</p>
    <div class="mapping-grid" style="margin-top:16px;">
      ${["question:質問（Q）", "answer:回答（A）", "category:カテゴリ（任意）"].map((item) => {
        const [key, label] = item.split(":");
        return `<div class="field"><label>${label}</label><select data-map="${key}">${options}</select></div>`;
      }).join("")}
    </div>
    <div class="panel table" style="margin-top:22px;">${renderRawRows()}</div>
    <div style="display:flex;gap:10px;margin-top:22px;"><button class="ghost" id="backUpload">戻る</button><button class="primary" id="toPreview" style="margin-left:auto;">プレビューへ進む</button></div>
  </div>`;
  document.querySelectorAll("[data-map]").forEach((select) => {
    select.value = state.mapping[select.dataset.map] || state.columns[0] || "";
    select.addEventListener("change", () => { state.mapping[select.dataset.map] = select.value; });
  });
  $("#backUpload").addEventListener("click", () => { state.importStep = 0; renderImport(); });
  $("#toPreview").addEventListener("click", () => { state.importStep = 2; renderImport(); });
}

function renderRawRows() {
  const cols = state.columns.slice(0, 6);
  const template = `repeat(${cols.length}, minmax(70px, 1fr))`;
  return `<div class="row head" style="grid-template-columns:${template};">${cols.map((col) => `<span>${escapeHtml(col)}</span>`).join("")}</div>` +
    state.rows.slice(0, 3).map((row) => `<div class="row" style="grid-template-columns:${template};">${cols.map((col) => `<span>${escapeHtml(row[col])}</span>`).join("")}</div>`).join("");
}

function renderPreview(content) {
  const q = state.mapping.question;
  const a = state.mapping.answer;
  const abstractionLabels = { low: "低", medium: "中", high: "高" };
  content.innerHTML = `<div class="preview-layout"><div><h2 style="font-size:14px;margin:0;">抽出対象のプレビュー</h2><p style="font-size:12px;color:var(--muted);margin:3px 0 14px;">マッピング結果のQ&Aペア</p>
    <div class="panel table"><div class="row head" style="grid-template-columns:34px 1fr 1fr;"><span>#</span><span>質問</span><span>回答</span></div>
    ${state.rows.slice(0, 5).map((row, idx) => `<div class="row" style="grid-template-columns:34px 1fr 1fr;"><span style="font-family:'JetBrains Mono';color:var(--faint);">${idx + 1}</span><span>${escapeHtml(row[q])}</span><span>${escapeHtml(row[a])}</span></div>`).join("")}
    <div style="padding:9px 12px;background:var(--panel-2);border-top:1px solid var(--line);font:600 11px/1 'JetBrains Mono';color:var(--faint);">${state.rows.length.toLocaleString()} 組のQ&Aペア</div></div></div>
    <div><h2 style="font-size:14px;margin:0;">抽出設定</h2><p style="font-size:12px;color:var(--muted);margin:3px 0 14px;">LLMでの抽象化・クラスタリング</p><div class="panel settings"><div style="font-size:12px;font-weight:600;">抽象化レベル</div><div class="seg">${Object.entries(abstractionLabels).map(([value, label]) => `<button type="button" class="${state.extraction.abstraction === value ? "selected" : ""}" data-abstraction="${value}">${label}</button>`).join("")}</div><div style="font-size:10.5px;color:var(--faint);margin-top:7px;line-height:1.5;">低は原文寄り、高は根本原因・論点寄りにまとめます。</div><button type="button" class="switch-row ${state.extraction.integrateExisting ? "on" : ""}" data-toggle-extraction="integrateExisting"><span>既存マップへの統合を試みる</span><span class="switch"></span></button><button type="button" class="switch-row ${state.extraction.dedupe ? "on" : ""}" data-toggle-extraction="dedupe"><span>重複Q&Aを除外</span><span class="switch"></span></button></div><button class="primary" id="startExtract" style="width:100%;margin-top:14px;">抽出を開始</button><button class="linkish" id="backMapping" style="width:100%;margin-top:6px;">戻る</button></div></div>`;
  content.querySelectorAll("[data-abstraction]").forEach((button) => button.addEventListener("click", () => {
    state.extraction.abstraction = button.dataset.abstraction;
    renderPreview(content);
  }));
  content.querySelectorAll("[data-toggle-extraction]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.toggleExtraction;
    state.extraction[key] = !state.extraction[key];
    renderPreview(content);
  }));
  $("#backMapping").addEventListener("click", () => { state.importStep = 1; renderImport(); });
  $("#startExtract").addEventListener("click", startExtract);
}

async function startExtract() {
  const content = $("#importContent");
  content.innerHTML = `<div class="processing"><div class="spinner"></div><div style="font-size:15px;font-weight:600;margin-top:20px;">AIがQ&Aを解析しています</div><div style="font-size:12.5px;color:var(--faint);margin-top:6px;">クラスタリング・抽象化し、既存マップと照合中…</div></div>`;
  try {
    const result = await postJson("/api/analyze-csv", { rows: state.rows, columns: state.columns, mapping: state.mapping, settings: state.extraction, totalRows: state.rows.length, workspaceId: state.activeWorkspaceId });
    state.mapping = result.mapping || state.mapping;
    state.clusters = (result.clusters || []).map((cluster) => ({ ...cluster, approved: false }));
    state.summary = result.summary || state.summary;
    state.apiSource = result.source;
    state.importStep = 3;
    if (result.source !== "openai") toast("OpenAI解析が使えなかったため、ローカル提案で継続しました。");
  } catch (error) {
    content.innerHTML = `<div class="processing"><div style="font-size:15px;font-weight:600;">CSV解析に失敗しました</div><div style="font-size:12.5px;color:var(--faint);line-height:1.6;margin-top:8px;">通信状態を確認して、もう一度お試しください。${escapeHtml(error.message || "")}</div><button class="primary" id="retryExtract" style="margin-top:18px;">もう一度解析する</button><button class="linkish" id="backToPreview" style="margin-top:8px;">プレビューに戻る</button></div>`;
    $("#retryExtract").addEventListener("click", startExtract);
    $("#backToPreview").addEventListener("click", () => { state.importStep = 2; renderImport(); });
    toast("CSV解析に失敗しました。");
    return;
  }
  renderImport();
}

function renderRoutes(content) {
  const approved = state.clusters.filter((cluster) => cluster.approved).length;
  content.innerHTML = `<div class="route-list"><div style="display:flex;align-items:flex-end;gap:14px;"><div><h2 style="font-size:15px;margin:0;">AIによる振り分け提案</h2><p style="font-size:12.5px;color:var(--muted);line-height:1.6;max-width:560px;">抽出したクラスタについて、既存マップへ追加するか新規作成するかをAIが提案しました。1件ずつ確認・承認してください。</p></div><span class="pill" style="margin-left:auto;">${approved} / ${state.clusters.length} 件 確認済み</span></div>
    ${state.clusters.map((cluster, idx) => `<div class="route-card"><div style="display:flex;gap:10px;align-items:flex-start;"><div style="flex:1;"><strong style="font-size:13.5px;">${escapeHtml(cluster.title)}</strong><span style="margin-left:9px;font:600 10.5px/1 'JetBrains Mono';background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:3px 7px;">${cluster.size || 1}件</span><div style="font-size:11.5px;color:var(--faint);margin-top:5px;">例：「${escapeHtml(cluster.sample || "")}」</div></div>${cluster.approved ? `<span class="tag create">承認済み</span>` : ""}</div><div class="route-proposal"><span class="mono-label" style="color:var(--faint);">AI提案</span> <span class="tag ${cluster.action === "append" ? "append" : "create"}">${cluster.action === "append" ? "既存マップに追加" : "新規マップを作成"}</span> <strong style="font-size:12.5px;color:${cluster.action === "append" ? "var(--brand-dark)" : "#1c6b4f"};">${escapeHtml(cluster.target)}</strong><span style="float:right;font:600 11px/1 'JetBrains Mono';color:var(--muted);">信頼度 ${cluster.confidence || 80}%</span><div style="font-size:11.5px;color:var(--muted);line-height:1.6;margin-top:9px;">${escapeHtml(cluster.reason)}</div></div>
      <div class="route-edit">
        <div class="field"><label>クラスタ名</label><input data-cluster-field="${idx}:title" value="${escapeHtml(cluster.title)}"></div>
        <div class="field"><label>追加先 / 新規名</label><input data-cluster-field="${idx}:target" value="${escapeHtml(cluster.target)}"></div>
        <div class="field"><label>追加先ノード</label><select data-cluster-field="${idx}:parentId">${renderParentNodeOptions(cluster.parentId || "root")}</select></div>
        <div class="field full"><label>回答案</label><textarea data-cluster-field="${idx}:answer" rows="3">${escapeHtml(cluster.answer || "")}</textarea></div>
        <div class="field full"><label>根拠・理由</label><textarea data-cluster-field="${idx}:reason" rows="2">${escapeHtml(cluster.reason || "")}</textarea></div>
      </div>
      ${cluster.sourceQa?.length ? `<div class="source-qa"><div class="mono-label" style="color:var(--faint);">元Q&A</div>${cluster.sourceQa.slice(0, 2).map((item) => `<div>Q. ${escapeHtml(item.question)}<br>A. ${escapeHtml(item.answer)}</div>`).join("")}</div>` : ""}
      ${!cluster.approved ? `<div style="display:flex;gap:9px;margin-top:13px;"><button class="primary" data-approve="${idx}" style="font-size:12.5px;padding:8px 16px;">この内容で承認</button><button class="ghost" data-toggle-route="${idx}" style="font-size:12.5px;padding:8px 16px;">追加／新規を切替</button></div>` : ""}</div>`).join("")}
    <div style="margin-top:20px;">${approved === state.clusters.length ? `<button class="primary" id="finishImport" style="width:100%;font-size:14px;padding:13px;">取り込みを完了する</button>` : `<div style="text-align:center;font-size:12px;color:var(--faint);padding:10px;">すべてのクラスタを承認すると取り込みを完了できます</div>`}</div></div>`;
  content.querySelectorAll("[data-cluster-field]").forEach((field) => field.addEventListener("input", () => {
    const [idx, key] = field.dataset.clusterField.split(":");
    state.clusters[Number(idx)][key] = field.value;
    state.clusters[Number(idx)].approved = false;
  }));
  content.querySelectorAll("[data-cluster-field]").forEach((field) => field.addEventListener("change", () => {
    const [idx, key] = field.dataset.clusterField.split(":");
    state.clusters[Number(idx)][key] = field.value;
    state.clusters[Number(idx)].approved = false;
  }));
  content.querySelectorAll("[data-approve]").forEach((button) => button.addEventListener("click", () => { state.clusters[Number(button.dataset.approve)].approved = true; renderImport(); }));
  content.querySelectorAll("[data-toggle-route]").forEach((button) => button.addEventListener("click", () => {
    const cluster = state.clusters[Number(button.dataset.toggleRoute)];
    cluster.action = cluster.action === "append" ? "create" : "append";
    cluster.target = cluster.action === "append" ? "ログイン・認証" : cluster.title.replace(/できない|ない/g, "").trim() || "新規マップ";
    renderImport();
  }));
  $("#finishImport")?.addEventListener("click", finalizeImport);
}

function renderParentNodeOptions(selectedId) {
  const map = state.flowMap || fallbackFlowMap();
  return map.nodes.map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === selectedId ? "selected" : ""}>${escapeHtml(node.title)}（${nodeTypeLabel(node.type)}）</option>`).join("");
}

function renderDone(content) {
  const appendCount = state.clusters.filter((cluster) => cluster.action === "append").length || state.summary.appendCount;
  const newCount = state.clusters.filter((cluster) => cluster.action === "create").length || state.summary.newCount;
  const total = state.clusters.reduce((sum, cluster) => sum + Number(cluster.size || 0), 0) || state.summary.reflectedQa;
  content.innerHTML = `<div class="done-screen"><div style="width:60px;height:60px;margin:0 auto;border-radius:50%;background:var(--green-soft);color:var(--green);display:grid;place-items:center;font-size:30px;">✓</div><h2 style="font-size:19px;margin:18px 0 0;">取り込みが完了しました</h2><p style="font-size:13px;color:var(--muted);line-height:1.6;">新しいQ&Aクラスタをレビュー待ちとして反映しました。回答アシスタントの思考プロセス上で編集・公開できます。</p><div class="stats"><div class="stat"><b>${appendCount}</b><span>既存へ追加</span></div><div class="stat"><b style="color:var(--green);">${newCount}</b><span>新規マップ</span></div><div class="stat"><b style="color:var(--ink);">${total}</b><span>反映Q&A</span></div></div><div style="display:flex;gap:10px;justify-content:center;margin-top:26px;flex-wrap:wrap;"><button class="primary" data-view-button-inline="answer">回答アシスタントで編集</button><button class="linkish" id="resetImport">別のCSVを取り込む</button></div></div>`;
  content.querySelectorAll("[data-view-button-inline]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewButtonInline)));
  $("#resetImport").addEventListener("click", () => { Object.assign(state, { importStep: 0, rows: [], columns: [], clusters: [] }); renderImport(); });
}

async function loadMapWorkspace(force = false) {
  if (state.maps.length && state.activeMap && !force) {
    renderMapWorkspace();
    return;
  }
  try {
    const [mapsResult, improvementsResult] = await Promise.all([getJson(`/api/maps?workspaceId=${encodeURIComponent(state.activeWorkspaceId)}`), getJson("/api/improvements")]);
    state.maps = mapsResult.maps || [];
    state.improvements = (improvementsResult.items || []).filter((item) => !item.workspaceId || item.workspaceId === state.activeWorkspaceId);
    renderSidebarMaps();
    const selectedId = state.activeMap && state.maps.some((map) => map.id === state.activeMap.id) ? state.activeMap.id : state.generatedMap?.id || state.maps[0]?.id || "login-auth";
    await selectMap(selectedId, false);
    if (!state.flowMap || !state.maps.some((map) => map.id === state.flowMap.id)) await loadFlowMap(selectedId, false);
    state.answerMapId = state.flowMap?.id || selectedId;
    state.answerMapLabel = state.flowMap?.label || state.maps.find((map) => map.id === selectedId)?.label || "マップ";
    renderWorkspaceControls();
  } catch (error) {
    toast(`マップ情報を読み込めませんでした。${error.message || ""}`);
  }
}

function renderSidebarMaps() {
  const list = $("#sidebarMapList");
  if (!list) return;
  const maps = state.maps.length ? state.maps : [{ id: "login-auth", label: "ログイン・認証", leafCount: 4, reviewCount: 0 }];
  list.innerHTML = maps.slice(0, 6).map((map) => `<button class="map-row ${state.activeMap?.id === map.id ? "active" : ""}" data-sidebar-map="${escapeHtml(map.id)}"><span class="dot"></span>${escapeHtml(map.label)}<span class="count">${map.leafCount || map.nodeCount || 0}</span></button>`).join("");
  list.querySelectorAll("[data-sidebar-map]").forEach((button) => button.addEventListener("click", async () => {
    setView("maps");
    await selectMap(button.dataset.sidebarMap);
  }));
}

async function selectMap(mapId, rerender = true) {
  if (!mapId) return;
  const result = await getJson(`/api/maps/${encodeURIComponent(mapId)}`);
  state.activeMap = result.map;
  state.flowMap = result.map;
  state.answerMapId = result.map.id;
  state.answerMapLabel = result.map.label;
  const preferred = state.selectedNodeId && state.activeMap.nodes.some((node) => node.id === state.selectedNodeId) ? state.selectedNodeId : "";
  state.selectedNodeId = preferred || state.activeMap.nodes.find((node) => node.type === "leaf")?.id || "root";
  renderSidebarMaps();
  if (rerender || state.view === "maps") renderMapWorkspace();
}

function renderMapWorkspace() {
  if (state.view !== "maps") return;
  const content = $("#mapsContent");
  if (!content) return;
  const map = state.activeMap;
  if ($("#mapTitle")) $("#mapTitle").textContent = `マップ管理：${map?.label || "未選択"}`;
  if ($("#mapSubtitle")) $("#mapSubtitle").textContent = map ? `${map.nodes.length}ノード · ${map.nodes.filter((node) => node.status === "published").length}公開 · ${map.nodes.filter((node) => node.status === "review").length}レビュー待ち` : "";
  if (map?.id && map.id !== "login-auth") $("#exportActions")?.removeAttribute("hidden");
  else $("#exportActions")?.setAttribute("hidden", "");
  const query = state.mapQuery.trim().toLowerCase();
  const maps = state.maps.filter((item) => !query || `${item.label} ${item.source}`.toLowerCase().includes(query));
  const selectedNode = map?.nodes?.find((node) => node.id === state.selectedNodeId);
  const nodeCount = map?.nodes?.length || 0;
  const publishedCount = map?.nodes?.filter((node) => node.status === "published").length || 0;
  const reviewCount = map?.nodes?.filter((node) => node.status === "review").length || 0;
  content.innerHTML = `<div class="map-workspace">
    <aside class="map-browser panel">
      <div class="field"><label>マップ検索</label><input id="mapSearch" value="${escapeHtml(state.mapQuery)}" placeholder="マップ名・領域で検索"></div>
      <div class="map-browser-list">${maps.map((item) => `<button class="map-browser-row ${map?.id === item.id ? "active" : ""}" data-map-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.label)}</strong><span>${item.publishedCount || 0} 公開 · ${item.reviewCount || 0} レビュー</span></button>`).join("")}</div>
      <div class="improvement-box"><div class="mono-label" style="color:var(--faint);">改善キュー</div>${state.improvements.slice(0, 5).map((item) => `<button class="improvement-item" data-improve-map="${escapeHtml(item.mapId)}" data-improve-node="${escapeHtml(item.nodeId)}"><strong>${escapeHtml(item.title)}</strong><span>${item.unresolvedCount || 0} 未解決 · ${statusLabel(item.status)}</span></button>`).join("") || `<div class="empty-note">未解決フィードバックはありません</div>`}</div>
    </aside>
    <section class="map-review">
      <div class="review-head"><div><h2>${escapeHtml(map?.label || "マップ")}</h2><p>${map ? `${map.nodes.length}ノード · ${map.nodes.filter((node) => node.status === "published").length}公開 · ${map.nodes.filter((node) => node.status === "review").length}レビュー待ち` : ""}</p></div><button class="ghost" id="reloadMaps">再読み込み</button></div>
      <div class="review-summary"><span><b>${nodeCount}</b>ノード</span><span><b>${publishedCount}</b>公開</span><span><b>${reviewCount}</b>レビュー</span></div>
      <div class="management-map">${renderManagementNodes(map)}</div>
    </section>
    <aside class="node-editor panel">${renderNodeEditor(selectedNode, map)}</aside>
  </div>`;
  $("#mapSearch").addEventListener("input", (event) => { state.mapQuery = event.target.value; renderMapWorkspace(); });
  $("#reloadMaps").addEventListener("click", () => loadMapWorkspace(true));
  content.querySelectorAll("[data-map-id]").forEach((button) => button.addEventListener("click", () => selectMap(button.dataset.mapId)));
  content.querySelectorAll("[data-node-id]").forEach((button) => button.addEventListener("click", () => {
    state.selectedNodeId = button.dataset.nodeId;
    renderMapWorkspace();
  }));
  content.querySelectorAll("[data-improve-map]").forEach((button) => button.addEventListener("click", async () => {
    await selectMap(button.dataset.improveMap, false);
    state.selectedNodeId = button.dataset.improveNode;
    renderMapWorkspace();
  }));
  $("#saveNode")?.addEventListener("click", () => saveSelectedNode());
  $("#publishNode")?.addEventListener("click", () => saveSelectedNode("published"));
  $("#reviewNode")?.addEventListener("click", () => saveSelectedNode("review"));
}

function renderManagementNodes(map) {
  if (!map) return `<div class="empty-note">マップを選択してください</div>`;
  return map.nodes.map((node) => `<button class="management-node ${node.id === state.selectedNodeId ? "active" : ""} ${node.status || ""}" data-node-id="${escapeHtml(node.id)}"><span>${statusLabel(node.status)} · ${nodeTypeLabel(node.type)}</span><strong>${escapeHtml(node.title)}</strong><small>${escapeHtml(nodeSummary(node))}</small></button>`).join("");
}

function renderNodeEditor(node, map) {
  if (!node) return `<div class="empty-note">ノードを選択してください</div>`;
  const sourceQa = node.sourceQa || [];
  const type = normalizeNodeTypeClient(node.type);
  return `<div class="node-editor-inner">
    <div class="editor-title"><div><span class="mono-label">NODE ${escapeHtml(node.id)} · ${nodeTypeLabel(type)}</span><h2>${escapeHtml(node.title)}</h2></div><span class="status-badge ${node.status === "published" ? "ready" : ""}">${statusLabel(node.status)}</span></div>
    <div class="editor-form">
      <div class="field"><label>${escapeHtml(nodeTitleLabel(type))}</label><input id="nodeTitle" value="${escapeHtml(node.title)}"><small>${escapeHtml(nodeTypeHelp(type))}</small></div>
      <div class="field"><label>状態</label><select id="nodeStatus"><option value="draft" ${node.status === "draft" ? "selected" : ""}>下書き</option><option value="review" ${node.status === "review" ? "selected" : ""}>レビュー中</option><option value="published" ${node.status === "published" ? "selected" : ""}>公開</option><option value="rejected" ${node.status === "rejected" ? "selected" : ""}>差し戻し</option></select></div>
      ${renderNodeEditorTypeFields(type, node)}
    </div>
    <div class="editor-actions"><button class="primary" id="saveNode">保存</button><button class="ghost" id="publishNode">公開</button><button class="ghost" id="reviewNode">レビューへ戻す</button></div>
    <div class="evidence-panel"><div class="mono-label" style="color:var(--faint);">根拠Q&A</div>${sourceQa.map((item) => `<div class="evidence-item">Q. ${escapeHtml(item.question)}<br>A. ${escapeHtml(item.answer)}${item.category ? `<br><span>${escapeHtml(item.category)}</span>` : ""}</div>`).join("") || `<div class="empty-note">根拠Q&Aはありません</div>`}</div>
    <div class="metric-row"><span>解決 ${Number(node.metrics?.resolved || 0)}</span><span>未解決 ${Number(node.metrics?.unresolved || 0)}</span><span>${escapeHtml(map?.label || "")}</span></div>
  </div>`;
}

function renderNodeEditorTypeFields(type, node) {
  if (type === "symptom") {
    return `<div class="field"><label>入口メモ</label><textarea id="nodeReason" rows="4" placeholder="対象サービス、初期症状、除外条件">${escapeHtml(node.reason || "")}</textarea></div>`;
  }
  if (type === "question") {
    return `
      <div class="field"><label>判断基準</label><textarea id="nodeReason" rows="4" placeholder="この判断で見る条件">${escapeHtml(node.reason || "")}</textarea></div>
      <div class="field"><label>補足確認文</label><input id="nodeNextQuestion" value="${escapeHtml(node.nextQuestion || "")}" placeholder="必要な場合のみ入力"></div>`;
  }
  return `
    <div class="field"><label>根本原因</label><input id="nodeRootCause" value="${escapeHtml(node.rootCause || node.title || "")}"></div>
    <div class="field"><label>回答案</label><textarea id="nodeAnswer" rows="5">${escapeHtml(node.answer || "")}</textarea></div>
    <div class="field"><label>エスカレーション条件</label><textarea id="nodeEscalation" rows="2">${escapeHtml(node.escalation || "")}</textarea></div>
    <div class="field"><label>レビュー理由</label><textarea id="nodeReason" rows="3">${escapeHtml(node.reason || "")}</textarea></div>`;
}

function nodeSummary(node) {
  const type = normalizeNodeTypeClient(node.type);
  if (type === "leaf") return node.rootCause || node.answer || "回答案未入力";
  if (type === "question") return node.reason || node.nextQuestion || "判断基準未入力";
  return node.reason || "入口ノード";
}

async function saveSelectedNode(forcedStatus = "") {
  const map = state.activeMap;
  const nodeId = state.selectedNodeId;
  const node = map?.nodes?.find((item) => item.id === nodeId);
  if (!map || !nodeId) return;
  const payload = collectNodeEditorPayload(node);
  const validation = validateNodePayload(payload);
  if (validation) return toast(validation);
  try {
    const result = await putJson(`/api/maps/${encodeURIComponent(map.id)}/nodes/${encodeURIComponent(nodeId)}`, { ...payload, status: forcedStatus || payload.status });
    state.activeMap = result.map;
    await loadMapWorkspace(true);
    state.selectedNodeId = nodeId;
    renderMapWorkspace();
    toast(forcedStatus === "published" ? "ノードを公開しました。" : "ノードを保存しました。");
  } catch (error) {
    toast(`ノードを保存できませんでした。${error.message || ""}`);
  }
}

function collectNodeEditorPayload(node) {
  const type = normalizeNodeTypeClient(node?.type);
  const payload = {
    title: ($("#nodeTitle")?.value || "").trim(),
    type,
    status: $("#nodeStatus")?.value || node?.status || "review"
  };
  if (type === "symptom") payload.reason = ($("#nodeReason")?.value || "").trim();
  if (type === "question") {
    payload.nextQuestion = ($("#nodeNextQuestion")?.value || "").trim();
    payload.reason = ($("#nodeReason")?.value || "").trim();
  }
  if (type === "leaf") {
    payload.rootCause = ($("#nodeRootCause")?.value || $("#nodeTitle")?.value || "").trim();
    payload.answer = ($("#nodeAnswer")?.value || "").trim();
    payload.escalation = ($("#nodeEscalation")?.value || "").trim();
    payload.reason = ($("#nodeReason")?.value || "").trim();
  }
  return payload;
}

function statusLabel(status = "") {
  return ({ draft: "下書き", review: "レビュー", published: "公開", rejected: "差戻し" }[status] || "未設定");
}

function renderSettings() {
  const form = $("#settingsForm");
  if (!form) return;
  if (!state.settings.loaded && !state.settings.loading) {
    loadSettings();
    return;
  }
  applyProviderVisibility(state.settings.provider);
  updateSettingsStatus();
}

async function loadSettings(force = false) {
  if (state.settings.loading) return;
  if (state.settings.loaded && !force) {
    renderSettings();
    return;
  }
  state.settings.loading = true;
  try {
    const settings = await getJson("/api/settings");
    Object.assign(state.settings, settings, { loaded: true, loading: false });
    populateSettingsForm();
    renderSettings();
  } catch (error) {
    state.settings.loading = false;
    toast(`設定の読み込みに失敗しました。${error.message || ""}`);
  }
}

function populateSettingsForm() {
  $("#openaiApiKey").value = "";
  $("#azureApiKey").value = "";
  $("#openaiBaseUrl").value = state.settings.openaiBaseUrl || "https://api.openai.com/v1";
  $("#azureBaseUrl").value = state.settings.azureBaseUrl || "";
  $("#azureApiVersion").value = state.settings.azureApiVersion || "preview";
  populateModelFields();
}

function populateModelFields() {
  const select = $("#modelSelect");
  const input = $("#modelCustom");
  if (!select || !input) return;
  const current = state.settings.model || "gpt-4o-mini";
  const options = [...new Set([current, ...(state.settings.modelOptions || [])])].filter(Boolean);
  select.innerHTML = options.map((model) => `<option value="${escapeHtml(model)}" ${model === current ? "selected" : ""}>${escapeHtml(model)}</option>`).join("");
  input.value = current;
}

function applyProviderVisibility(provider) {
  const selectedProvider = provider === "azure" ? "azure" : "openai";
  state.settings.provider = selectedProvider;
  document.querySelectorAll("[data-provider-option]").forEach((button) => {
    button.classList.toggle("active", button.dataset.providerOption === selectedProvider);
  });
  document.querySelectorAll("[data-provider-fields]").forEach((section) => {
    section.classList.toggle("active", section.dataset.providerFields === selectedProvider);
  });
}

function updateSettingsStatus() {
  const providerLabel = state.settings.provider === "azure" ? "Azure OpenAI" : "OpenAI";
  $("#settingsProvider").textContent = providerLabel;
  $("#settingsModel").textContent = state.settings.model || "-";
  updateKeyStatus("#openaiStatus", "#openaiKeyHint", state.settings.hasOpenAIKey);
  updateKeyStatus("#azureStatus", "#azureKeyHint", state.settings.hasAzureKey);
}

function updateKeyStatus(statusSelector, hintSelector, hasKey) {
  const status = $(statusSelector);
  const hint = $(hintSelector);
  status.textContent = hasKey ? "保存済み" : "未設定";
  status.classList.toggle("ready", hasKey);
  hint.textContent = hasKey ? "空欄のまま保存すると現在のキーを維持します" : "保存済みキーはありません";
}

async function saveSettings(event) {
  event.preventDefault();
  if (state.settings.saving) return;
  state.settings.saving = true;
  const saveButton = $("#settingsForm button[type='submit']");
  saveButton.disabled = true;
  saveButton.textContent = "保存中";
  const form = new FormData(event.currentTarget);
  try {
    const result = await putJson("/api/settings", {
      provider: state.settings.provider,
      model: (form.get("model") || form.get("modelSelect") || "").toString().trim(),
      openaiApiKey: form.get("openaiApiKey"),
      openaiBaseUrl: form.get("openaiBaseUrl"),
      azureApiKey: form.get("azureApiKey"),
      azureBaseUrl: form.get("azureBaseUrl"),
      azureApiVersion: form.get("azureApiVersion")
    });
    Object.assign(state.settings, result, { loaded: true });
    populateSettingsForm();
    renderSettings();
    toast("設定を保存しました。");
  } catch (error) {
    toast(`設定の保存に失敗しました。${error.message || ""}`);
  } finally {
    state.settings.saving = false;
    saveButton.disabled = false;
    saveButton.textContent = "保存";
  }
}

async function handleFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    toast("CSVは10MB以下にしてください。");
    return;
  }
  try {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (!parsed.columns.length || !parsed.rows.length) throw new Error("CSVにヘッダー行とデータ行が必要です。");
    state.fileName = file.name;
    state.columns = parsed.columns;
    state.rows = parsed.rows;
    state.mapping = detectMapping(parsed.columns);
    state.importStep = 1;
    renderImport();
  } catch (error) {
    toast(`CSVを読み込めませんでした。${error.message || ""}`);
  }
}

function bindDropZone(zone) {
  if (!zone) return;
  ["dragenter", "dragover"].forEach((eventName) => zone.addEventListener(eventName, (event) => {
    event.preventDefault();
    zone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((eventName) => zone.addEventListener(eventName, (event) => {
    event.preventDefault();
    zone.classList.remove("dragging");
  }));
  zone.addEventListener("drop", (event) => handleFile(event.dataTransfer?.files?.[0]));
}

function loadSampleCsv() {
  const text = `created_at,channel,customer_message,agent_reply,category,csat
2024-04-02,chat,パスワードが通りません,リセット手順をご案内します,認証,4
2024-04-02,email,請求額が高い気がします,ご利用明細を確認しました,課金,3
2024-04-03,chat,画面が真っ白で進めない,キャッシュ削除をご案内しました,認証,5
2024-04-04,chat,2段階認証コードが届かない,SMS再送をお試しいただきました,認証,4
2024-04-05,email,Webhookが発火しません,配信ログの確認方法をご案内しました,API,4`;
  const parsed = parseCsv(text);
  state.fileName = "support_qa_2024Q2.csv";
  state.columns = parsed.columns;
  state.rows = parsed.rows;
  state.mapping = detectMapping(parsed.columns);
  state.importStep = 1;
  renderImport();
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  const columns = rows.shift()?.map((cell) => cell.trim()) || [];
  return { columns, rows: rows.map((cells) => Object.fromEntries(columns.map((col, idx) => [col, cells[idx] || ""]))) };
}

function detectMapping(columns) {
  const find = (patterns, fallback = "") => columns.find((col) => patterns.some((pattern) => pattern.test(col))) || fallback || columns[0] || "";
  return {
    question: find([/question/i, /customer/i, /message/i, /質問/, /問い合わせ/]),
    answer: find([/answer/i, /reply/i, /agent/i, /回答/], columns[1]),
    category: find([/category/i, /カテゴリ/, /種別/], "")
  };
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (payload.error) message = `${message}: ${payload.error}`;
    } catch {}
    throw new Error(message);
  }
  return response.json();
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
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (payload.error) message = `${message}: ${payload.error}`;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function exportGeneratedMap(format) {
  const mapId = state.activeMap?.id || state.generatedMap?.id;
  const mapLabel = state.activeMap?.label || state.generatedMap?.title || "map";
  if (!mapId || mapId.startsWith("local-")) {
    toast("サーバに保存済みの生成マップがないため、まだエクスポートできません。");
    return;
  }
  const response = await fetch(`/api/maps/${encodeURIComponent(mapId)}/export?format=${encodeURIComponent(format)}`);
  if (!response.ok) {
    toast(`エクスポートに失敗しました（HTTP ${response.status}）。`);
    return;
  }
  const blob = await response.blob();
  const names = { json: `${mapId}.json`, csv: `${mapId}.csv`, skill: `${mapLabel}.SKILL.md` };
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = names[format] || `${mapId}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast(`${link.download} をエクスポートしました。`);
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3800);
}

function renderAll() {
  renderWorkspaceControls();
  renderChat();
  renderComposer();
  renderWorkflowRail();
  renderTrees();
}

document.querySelectorAll("[data-view-button]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewButton)));
document.querySelectorAll("[data-export-format]").forEach((button) => button.addEventListener("click", () => exportGeneratedMap(button.dataset.exportFormat)));
document.querySelectorAll("[data-provider-option]").forEach((button) => button.addEventListener("click", () => {
  applyProviderVisibility(button.dataset.providerOption);
  updateSettingsStatus();
}));
$("#closeFlowModal")?.addEventListener("click", closeFlowModal);
$("#cancelFlowModal")?.addEventListener("click", closeFlowModal);
$("#saveFlowModal")?.addEventListener("click", saveFlowModal);
$("#flowModal")?.addEventListener("click", (event) => {
  if (event.target.id === "flowModal") closeFlowModal();
});
$("#settingsForm").addEventListener("submit", saveSettings);
$("#reloadSettings").addEventListener("click", () => loadSettings(true));
$("#modelSelect")?.addEventListener("change", (event) => {
  const input = $("#modelCustom");
  if (input) input.value = event.target.value;
});
$("#resetAnswer").addEventListener("click", resetAnswer);
$("#backToAnswer")?.addEventListener("click", () => setView("answer"));
$("#fileInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) handleFile(file);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.flowModal) {
    closeFlowModal();
    return;
  }
  if (event.key === "Escape" && state.fullscreenMap) {
    state.fullscreenMap = "";
    renderTrees();
  }
});

renderAll();
loadWorkspaces();
