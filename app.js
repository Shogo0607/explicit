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
  apiSource: "",
  zoom: { mindmap: 1.18, mapOnly: 1.42 },
  fullscreenMap: "",
  generatedMap: null,
  answerMapId: "login-auth",
  answerMapLabel: "ログイン・認証",
  generatedCurrent: ""
};

const samples = [
  "パスワードを何度入れてもログインできません",
  "ログイン画面が真っ白で進めません",
  "社員全員が急にログインできなくなりました"
];

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
  document.querySelectorAll("[data-view-button]").forEach((btn) => btn.classList.toggle("active", btn.dataset.viewButton === view));
  renderImport();
  if (view === "answer") {
    renderChat();
    renderComposer();
  }
  renderTrees();
}

function renderChat() {
  const chat = $("#chatScroll");
  const visibleSamples = state.generatedMap ? [...samples, "Webhookが発火しません"] : samples;
  const start = state.messages.length === 0 ? `
    <div class="msg"><div class="bot-badge">D</div><div class="bubble">サポートに届いた質問を入力してください。<strong>「ログイン・認証」マップ</strong>を辿って、根本原因と回答案をご提案します。</div></div>
    <div class="samples">
      <div class="mono-label" style="color:var(--faint);">サンプル質問</div>
      ${visibleSamples.map((text) => `<button class="sample" data-sample="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("")}
    </div>` : "";
  chat.innerHTML = start + state.messages.map((message) => {
    if (message.role === "user") return `<div class="msg user"><div class="bubble">${escapeHtml(message.text)}</div></div>`;
    if (message.kind === "answer") {
      return `<div class="msg"><div class="bot-badge">D</div><div class="answer-card">
        <header><div class="mono-label">根本原因 / ROOT CAUSE</div><h2>${escapeHtml(message.cause)}</h2></header>
        <div style="padding:12px 14px;"><div class="mono-label" style="color:var(--faint);">回答案</div><p>${escapeHtml(message.answer)}</p>
        <div style="display:flex;gap:8px;margin-top:12px;"><button class="primary" data-copy-answer="${escapeHtml(message.answer)}" style="font-size:12px;padding:7px 13px;">回答をコピー</button><button class="ghost">テンプレに保存</button></div></div>
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
  chat.scrollTop = chat.scrollHeight;

  $("#matchMeta").hidden = state.messages.length === 0;
  $("#matchText").textContent = `${state.answerMapLabel || "ログイン・認証"} マップ · 一致 ${state.confidence || 96}%`;
  $("#treeStatus").textContent = state.current ? (state.current.startsWith("l") ? "根本原因に到達" : `確認 ${Math.max(1, state.path.length - 1)} 件目`) : "待機中";
}

function renderComposer() {
  const composer = $("#composer");
  if (state.awaiting) {
    composer.innerHTML = `<div><div style="font-size:11px;color:var(--faint);text-align:center;margin-bottom:9px;">この質問に回答してください</div>
      <div class="decision-buttons"><button class="yes" id="yesBtn">はい</button><button id="noBtn">いいえ</button></div>
      <button class="linkish" id="startOver" style="width:100%;font-size:11.5px;color:var(--faint);margin-top:6px;">最初からやり直す</button></div>`;
    $("#yesBtn").addEventListener("click", () => continuePath("yes"));
    $("#noBtn").addEventListener("click", () => continuePath("no"));
    $("#startOver").addEventListener("click", resetAnswer);
  } else {
    composer.innerHTML = `<div class="composer-box"><input id="queryInput" value="${escapeHtml(state.query)}" placeholder="サポートに来た質問を入力…"><button class="send" id="sendBtn">➤</button></div>`;
    $("#queryInput").addEventListener("input", (event) => { state.query = event.target.value; });
    $("#queryInput").addEventListener("keydown", (event) => { if (event.key === "Enter") submitQuestion(state.query); });
    $("#sendBtn").addEventListener("click", () => submitQuestion(state.query));
  }
}

async function submitQuestion(text) {
  const query = String(text || "").trim();
  if (!query) return;
  state.messages = [{ role: "user", text: query }, { role: "bot", text: "OpenAIで既存マップとの一致と回答経路を判定しています…" }];
  state.path = ["root", "q1"];
  state.current = "q1";
  state.awaiting = false;
  state.query = "";
  renderAll();
  try {
    const result = await postJson("/api/answer", { query, history: state.messages });
    state.apiSource = result.source;
    state.confidence = result.confidence;
    state.path = result.path;
    state.current = result.path[result.path.length - 1];
    state.answerMapId = result.mapId || "login-auth";
    state.answerMapLabel = result.mapLabel || "ログイン・認証";
    state.generatedCurrent = state.answerMapId === state.generatedMap?.id ? state.current : "";
    state.awaiting = false;
    state.messages = [
      { role: "user", text: query },
      { role: "bot", text: `「${result.mapLabel}」マインドマップに一致しました（信頼度 ${result.confidence}%）。${result.rationale || ""}` },
      { role: "bot", kind: "answer", cause: result.cause, answer: result.answer }
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

function continuePath(answer) {
  const transitions = { q1: { yes: "q2", no: "q3" }, q2: { yes: "l1", no: "l2" }, q3: { yes: "l3", no: "l4" } };
  const leafAnswers = {
    l1: ["パスワード失念", "パスワードをお忘れの可能性が高いです。サインイン画面の「パスワードを忘れた方」からリセット用メールを送信いただくよう案内してください。"],
    l2: ["アカウントロック", "試行回数の超過による一時ロックです。30分ほど待ってから再試行いただくか、管理コンソールからロックを解除してください。"],
    l3: ["キャッシュ／Cookie不整合", "ブラウザのキャッシュ／Cookieが原因の可能性が高いです。シークレットウィンドウでの再試行、または該当サイトのキャッシュ削除をご案内ください。"],
    l4: ["SSO／IdP障害", "SSO／IdP側の障害が疑われます。同時刻に複数ユーザーで発生していないかを確認し、管理者へエスカレーションしてください。"]
  };
  const next = transitions[state.current]?.[answer];
  if (!next) return;
  state.messages.push({ role: "user", text: answer === "yes" ? "はい" : "いいえ" });
  state.path.push(next);
  state.current = next;
  if (leafAnswers[next]) {
    state.awaiting = false;
    state.messages.push({ role: "bot", kind: "answer", cause: leafAnswers[next][0], answer: leafAnswers[next][1] });
  } else {
    state.awaiting = true;
    state.messages.push({ role: "bot", text: tree.nodes.find((node) => node.id === next).title });
  }
  renderAll();
}

function resetAnswer() {
  Object.assign(state, { path: [], current: null, messages: [], query: "", awaiting: false, confidence: null, answerMapId: "login-auth", answerMapLabel: "ログイン・認証", generatedCurrent: "" });
  renderAll();
}

function renderTrees() {
  if (state.generatedMap && state.answerMapId === state.generatedMap.id) {
    renderGeneratedTree($("#mindmap"), "mindmap", state.generatedCurrent);
  } else {
    renderTree($("#mindmap"), state.path, state.current, true, "mindmap");
  }
  if (state.generatedMap) {
    renderGeneratedTree($("#mapOnly"), "mapOnly");
  } else {
    renderTree($("#mapOnly"), state.path, state.current, false, "mapOnly");
  }
  renderMapHeader();
}

function renderTree(container, path, current, showHint, zoomKey) {
  if (!container) return;
  const started = path.length > 0;
  const inPath = (id) => path.includes(id);
  const pathPair = (edge) => inPath(edge.from) && inPath(edge.to) && path.indexOf(edge.to) === path.indexOf(edge.from) + 1;
  const zoom = state.zoom[zoomKey] || 1;
  container.style.setProperty("--map-zoom", zoom);
  container.classList.toggle("map-fullscreen", state.fullscreenMap === zoomKey);
  container.innerHTML = `
    <div class="map-content">
      <svg viewBox="0 0 720 500">
        <defs>
          <marker id="${zoomKey}ArrowNormal" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0 0 L6.5 3 L0 6 z" fill="#A0A6B0"></path></marker>
          <marker id="${zoomKey}ArrowPath" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0 0 L6.5 3 L0 6 z" fill="#4F46E5"></path></marker>
        </defs>
        ${tree.edges.map((edge) => `<path d="${edge.d}" fill="none" stroke="${pathPair(edge) ? "#4F46E5" : "#A0A6B0"}" stroke-width="${pathPair(edge) ? "2.4" : "1.5"}" marker-end="url(#${pathPair(edge) ? `${zoomKey}ArrowPath` : `${zoomKey}ArrowNormal`})" opacity="${started && !pathPair(edge) ? ".3" : "1"}"></path>`).join("")}
      </svg>
      ${tree.edges.filter((edge) => edge.label).map((edge) => `<div class="edge-label ${edge.label === "はい" ? "yes" : ""} ${started && !pathPair(edge) ? "dim" : ""}" style="left:${edge.lx / 720 * 100}%;top:${edge.ly / 500 * 100}%;">${edge.label}</div>`).join("")}
      ${tree.nodes.map((node) => `<div class="node ${node.cls || ""} ${current === node.id ? "active" : ""} ${started && !inPath(node.id) ? "dim" : ""}" style="left:${node.x / 720 * 100}%;top:${node.y / 500 * 100}%;width:${node.w / 720 * 100}%;">
        <span class="node-kind">${node.kind}</span><div class="node-title">${node.title}</div>${node.sub ? `<div class="node-sub">${node.sub}</div>` : ""}
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
    title.textContent = `マインドマップ：${state.generatedMap.title}`;
    subtitle.textContent = `${clusters.length}クラスタ · ${qaCount}件のQ&Aから生成`;
    $("#exportActions")?.removeAttribute("hidden");
  } else {
    title.textContent = "マインドマップ：ログイン・認証";
    subtitle.textContent = "412件のQ&Aから生成された判断木";
    $("#exportActions")?.setAttribute("hidden", "");
  }
}

async function finalizeImport() {
  const approvedClusters = state.clusters.filter((cluster) => cluster.approved);
  const clusters = (approvedClusters.length ? approvedClusters : state.clusters).map((cluster) => ({ ...cluster }));
  try {
    const result = await postJson("/api/maps/import", { title: "CSV取り込みマップ", clusters });
    state.generatedMap = mapFromServer(result.map, clusters);
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
      answer: node.answer || ""
    }))
  };
}

function renderImport() {
  if (state.view !== "import") return;
  renderStepper();
  const content = $("#importContent");
  if (state.importStep === 0) {
    content.innerHTML = `<div class="drop"><div class="drop-card"><div class="upload-icon">⇧</div><div style="font-size:15px;font-weight:600;margin-top:16px;">CSVファイルをドラッグ＆ドロップ</div><div style="font-size:12.5px;color:var(--faint);margin-top:6px;">またはクリックしてファイルを選択</div><button class="primary" id="pickFile" style="margin-top:18px;">ファイルを選択</button><div style="font:500 11px/1 'IBM Plex Mono';color:#c4c4c9;margin-top:18px;">Q&Aのペアを含むCSV · UTF-8 · 最大 10MB</div></div><button class="linkish" id="sampleCsv" style="margin-top:12px;color:var(--brand);">サンプルCSVで試す →</button></div>`;
    $("#pickFile").addEventListener("click", () => $("#fileInput").click());
    $("#sampleCsv").addEventListener("click", loadSampleCsv);
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
    return `<div class="step ${cls}"><span class="step-num">${state.importStep > idx ? "✓" : idx + 1}</span><span>${label}</span></div>${idx < labels.length - 1 ? `<span style="width:42px;height:2px;background:#e4e4e7;border-radius:2px;"></span>` : ""}`;
  }).join("");
}

function renderMapping(content) {
  const options = state.columns.map((col) => `<option>${escapeHtml(col)}</option>`).join("");
  content.innerHTML = `<div style="max-width:760px;margin:28px auto;padding:0 24px;">
    <div class="panel" style="display:flex;align-items:center;gap:11px;padding:12px 14px;"><div class="upload-icon" style="width:34px;height:34px;background:var(--green-soft);color:#1c6b4f;">✓</div><div><div style="font-size:13.5px;font-weight:600;">${escapeHtml(state.fileName || "support_qa_2024Q2.csv")}</div><div style="font:500 11px/1.4 'IBM Plex Mono';color:var(--faint);">${state.rows.length.toLocaleString()} 行 · ${state.columns.length} 列</div></div><span class="tag create" style="margin-left:auto;">読み込み完了</span></div>
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
  content.innerHTML = `<div class="preview-layout"><div><h2 style="font-size:14px;margin:0;">抽出対象のプレビュー</h2><p style="font-size:12px;color:var(--muted);margin:3px 0 14px;">マッピング結果のQ&Aペア</p>
    <div class="panel table"><div class="row head" style="grid-template-columns:34px 1fr 1fr;"><span>#</span><span>質問</span><span>回答</span></div>
    ${state.rows.slice(0, 5).map((row, idx) => `<div class="row" style="grid-template-columns:34px 1fr 1fr;"><span style="font-family:'IBM Plex Mono';color:var(--faint);">${idx + 1}</span><span>${escapeHtml(row[q])}</span><span>${escapeHtml(row[a])}</span></div>`).join("")}
    <div style="padding:9px 12px;background:#fbfbfc;border-top:1px solid #ececee;font:500 11px/1 'IBM Plex Mono';color:var(--faint);">${state.rows.length.toLocaleString()} 組のQ&Aペア</div></div></div>
    <div><h2 style="font-size:14px;margin:0;">抽出設定</h2><p style="font-size:12px;color:var(--muted);margin:3px 0 14px;">LLMでの抽象化・クラスタリング</p><div class="panel settings"><div style="font-size:12px;font-weight:600;">抽象化レベル</div><div class="seg"><span>低</span><span class="selected">中</span><span>高</span></div><div style="font-size:10.5px;color:var(--faint);margin-top:7px;line-height:1.5;">個別の言い回しをまとめ、本質的な論点でグループ化します。</div><div class="switch-row"><span>既存マップへの統合を試みる</span><span class="switch"></span></div><div class="switch-row"><span>重複Q&Aを除外</span><span class="switch"></span></div></div><button class="primary" id="startExtract" style="width:100%;margin-top:14px;">抽出を開始</button><button class="linkish" id="backMapping" style="width:100%;margin-top:6px;">戻る</button></div></div>`;
  $("#backMapping").addEventListener("click", () => { state.importStep = 1; renderImport(); });
  $("#startExtract").addEventListener("click", startExtract);
}

async function startExtract() {
  const content = $("#importContent");
  content.innerHTML = `<div class="processing"><div class="spinner"></div><div style="font-size:15px;font-weight:600;margin-top:20px;">AIがQ&Aを解析しています</div><div style="font-size:12.5px;color:var(--faint);margin-top:6px;">クラスタリング・抽象化し、既存マップと照合中…</div></div>`;
  try {
    const result = await postJson("/api/analyze-csv", { rows: state.rows, columns: state.columns, totalRows: state.rows.length });
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
    ${state.clusters.map((cluster, idx) => `<div class="route-card"><div style="display:flex;gap:10px;align-items:flex-start;"><div style="flex:1;"><strong style="font-size:13.5px;">${escapeHtml(cluster.title)}</strong><span style="margin-left:9px;font:500 10.5px/1 'IBM Plex Mono';background:#f4f4f5;border-radius:5px;padding:3px 7px;">${cluster.size || 1}件</span><div style="font-size:11.5px;color:var(--faint);margin-top:5px;">例：「${escapeHtml(cluster.sample || "")}」</div></div>${cluster.approved ? `<span class="tag create">承認済み</span>` : ""}</div><div class="route-proposal"><span class="mono-label" style="color:#8a8a93;">AI提案</span> <span class="tag ${cluster.action === "append" ? "append" : "create"}">${cluster.action === "append" ? "既存マップに追加" : "新規マップを作成"}</span> <strong style="font-size:12.5px;color:${cluster.action === "append" ? "var(--brand-dark)" : "#1c6b4f"};">${escapeHtml(cluster.target)}</strong><span style="float:right;font:500 11px/1 'IBM Plex Mono';color:var(--muted);">信頼度 ${cluster.confidence || 80}%</span><div style="font-size:11.5px;color:var(--muted);line-height:1.6;margin-top:9px;">${escapeHtml(cluster.reason)}</div></div>${!cluster.approved ? `<div style="display:flex;gap:9px;margin-top:13px;"><button class="primary" data-approve="${idx}" style="font-size:12.5px;padding:8px 16px;">この提案で承認</button><button class="ghost" data-toggle-route="${idx}" style="font-size:12.5px;padding:8px 16px;">追加／新規を切替</button></div>` : ""}</div>`).join("")}
    <div style="margin-top:20px;">${approved === state.clusters.length ? `<button class="primary" id="finishImport" style="width:100%;font-size:14px;padding:13px;">取り込みを完了する</button>` : `<div style="text-align:center;font-size:12px;color:var(--faint);padding:10px;">すべてのクラスタを承認すると取り込みを完了できます</div>`}</div></div>`;
  content.querySelectorAll("[data-approve]").forEach((button) => button.addEventListener("click", () => { state.clusters[Number(button.dataset.approve)].approved = true; renderImport(); }));
  content.querySelectorAll("[data-toggle-route]").forEach((button) => button.addEventListener("click", () => {
    const cluster = state.clusters[Number(button.dataset.toggleRoute)];
    cluster.action = cluster.action === "append" ? "create" : "append";
    cluster.target = cluster.action === "append" ? "ログイン・認証" : cluster.title.replace(/できない|ない/g, "").trim() || "新規マップ";
    renderImport();
  }));
  $("#finishImport")?.addEventListener("click", finalizeImport);
}

function renderDone(content) {
  const appendCount = state.clusters.filter((cluster) => cluster.action === "append").length || state.summary.appendCount;
  const newCount = state.clusters.filter((cluster) => cluster.action === "create").length || state.summary.newCount;
  const total = state.clusters.reduce((sum, cluster) => sum + Number(cluster.size || 0), 0) || state.summary.reflectedQa;
  content.innerHTML = `<div class="done-screen"><div style="width:60px;height:60px;margin:0 auto;border-radius:50%;background:var(--green-soft);color:var(--green);display:grid;place-items:center;font-size:30px;">✓</div><h2 style="font-size:19px;margin:18px 0 0;">取り込みが完了しました</h2><p style="font-size:13px;color:var(--muted);line-height:1.6;">新しいQ&Aクラスタをマインドマップに反映しました。回答アシスタントから利用できます。</p><div class="stats"><div class="stat"><b>${appendCount}</b><span>既存へ追加</span></div><div class="stat"><b style="color:var(--green);">${newCount}</b><span>新規マップ</span></div><div class="stat"><b style="color:var(--ink);">${total}</b><span>反映Q&A</span></div></div><div style="display:flex;gap:10px;justify-content:center;margin-top:26px;flex-wrap:wrap;"><button class="primary" data-view-button-inline="maps">マップを見る</button><button class="ghost" data-view-button-inline="answer">回答アシスタントを試す</button><button class="linkish" id="resetImport">別のCSVを取り込む</button></div></div>`;
  content.querySelectorAll("[data-view-button-inline]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewButtonInline)));
  $("#resetImport").addEventListener("click", () => { Object.assign(state, { importStep: 0, rows: [], columns: [], clusters: [] }); renderImport(); });
}

async function handleFile(file) {
  const text = await file.text();
  const parsed = parseCsv(text);
  state.fileName = file.name;
  state.columns = parsed.columns;
  state.rows = parsed.rows;
  state.mapping = detectMapping(parsed.columns);
  state.importStep = 1;
  renderImport();
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

async function exportGeneratedMap(format) {
  if (!state.generatedMap?.id || state.generatedMap.id.startsWith("local-")) {
    toast("サーバに保存済みの生成マップがないため、まだエクスポートできません。");
    return;
  }
  const response = await fetch(`/api/maps/${encodeURIComponent(state.generatedMap.id)}/export?format=${encodeURIComponent(format)}`);
  if (!response.ok) {
    toast(`エクスポートに失敗しました（HTTP ${response.status}）。`);
    return;
  }
  const blob = await response.blob();
  const names = { json: `${state.generatedMap.id}.json`, csv: `${state.generatedMap.id}.csv`, skill: "SKILL.md" };
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = names[format] || `${state.generatedMap.id}.json`;
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
  renderChat();
  renderComposer();
  renderTrees();
}

document.querySelectorAll("[data-view-button]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewButton)));
document.querySelectorAll("[data-export-format]").forEach((button) => button.addEventListener("click", () => exportGeneratedMap(button.dataset.exportFormat)));
$("#resetAnswer").addEventListener("click", resetAnswer);
$("#fileInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) handleFile(file);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.fullscreenMap) {
    state.fullscreenMap = "";
    renderTrees();
  }
});

renderAll();
