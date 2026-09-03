const $ = (selector) => document.querySelector(selector);
let currentState = null;
let toastTimer = null;
let lastErrorToast = "";

const STATUS_LABELS = {
  waiting: "Waiting",
  syncing: "Syncing",
  success: "Synced",
  error: "Failed",
  paused: "Paused",
  idle: "Waiting"
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&#039;", "'": "&#039;"
  }[character]));
}

function showToast(message, type = "info") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function friendlyError(error = "") {
  const text = String(error);
  if (text.includes("No paired destination") || text.includes("请先连接 Mac")) return "请先连接 Mac 设备";
  if (text.includes("timed out") || text.includes("ECONNREFUSED") || text.includes("fetch failed")) return "Mac 暂时离线，网络恢复后会自动重试";
  if (text.includes("Project Folder")) return "请选择一个存在的项目文件夹";
  if (text.includes("Source Folder")) return "请先选择一个存在的 Source Folder";
  if (text.includes("Pairing token")) return "配对信息已失效，请重新连接设备";
  if (text.includes("Mirror is paused")) return "这个同步文件夹已暂停";
  return text;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function folderNameFromPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/\/+$/, "").split("/").filter(Boolean).at(-1) || "";
}

function renderConnection(state) {
  const connection = state.connection;
  const status = $("#connection-status");
  const device = $("#connection-device");
  const card = $("#connection-card");
  card.classList.toggle("is-online", connection.isOnline);
  card.classList.toggle("is-offline", Boolean(state.config.pairedDevice || state.config.pairedSource) && !connection.isOnline);
  if (connection.isOnline) {
    status.textContent = "对方设备在线";
    device.textContent = connection.device?.deviceName || "已连接设备";
  } else if (state.config.pairedDevice || state.config.pairedSource) {
    status.textContent = "等待对方上线";
    device.textContent = state.config.pairedDevice?.deviceName || state.config.pairedSource?.deviceName || "已连接设备";
  } else {
    status.textContent = "等待连接";
    device.textContent = "先连接一台附近的设备";
  }
  $("#connection-role").textContent = state.device.role.toUpperCase();
  $("#advanced-port").textContent = state.device.httpPort;
}

function renderSettings(state) {
  if (document.activeElement !== $("#device-name")) $("#device-name").value = state.device.name || "";
  if (document.activeElement !== $("#mybridge-root")) $("#mybridge-root").value = state.config.mybridgeRoot || "";
  if (document.activeElement !== $("#ignore-rules")) $("#ignore-rules").value = (state.config.ignoreRules || []).join("\n");
  if (document.activeElement !== $("#source-folder")) $("#source-folder").value = state.config.sourceFolder || "";
  if (document.activeElement !== $("#destination-folder")) $("#destination-folder").value = state.config.destinationFolder || "";
}

function renderDevices(state) {
  const list = $("#device-list");
  const pairedId = state.config.pairedDevice?.deviceId;
  const devices = state.discoveredDevices || [];
  if (!devices.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-orbit"></span><p>没有发现新的设备</p><small>确认两台电脑在同一个局域网</small></div>`;
    return;
  }
  list.innerHTML = devices.map((device) => `
    <div class="device-row ${device.deviceId === pairedId ? "is-paired" : ""}">
      <span class="device-signal ${device.isOnline ? "is-online" : ""}"></span>
      <div class="device-info"><strong>${escapeHtml(device.deviceName)}</strong><span>${escapeHtml(device.role === "destination" ? "Mac 目标设备" : device.role === "source" ? "Windows 源设备" : "MyBridge 设备")}</span></div>
      <button class="button button-small pair-button" data-url="${escapeHtml(device.baseUrl)}" data-id="${escapeHtml(device.deviceId)}" data-name="${escapeHtml(device.deviceName)}" type="button">${device.deviceId === pairedId ? "已连接" : "连接"}</button>
    </div>`).join("");
  list.querySelectorAll(".pair-button").forEach((button) => button.addEventListener("click", () => pairDevice(button.dataset)));
}

function mirrorStatus(mirror) {
  return STATUS_LABELS[mirror.status] || (mirror.enabled ? "Waiting" : "Paused");
}

function mirrorStatusClass(mirror) {
  return mirror.status === "success" ? "is-success" : mirror.status === "error" ? "is-failed" : mirror.status === "syncing" ? "is-syncing" : mirror.status === "paused" || !mirror.enabled ? "is-paused" : "";
}

function renderMirrors(state) {
  const list = $("#mirror-list");
  const addButton = $("#add-mirror-button");
  const mirrors = state.mirrors || [];
  const sourceMode = state.device.role === "source";
  addButton.classList.toggle("is-hidden", !sourceMode);
  if (!mirrors.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-orbit"></span><p>${sourceMode ? "还没有同步文件夹" : "等待 Windows 添加同步文件夹"}</p><small>${sourceMode ? "点击“添加文件夹”，选择一个 Windows 项目目录" : "Windows 添加后，Mac 会自动创建镜像目录"}</small></div>`;
    return;
  }
  list.innerHTML = mirrors.map((mirror) => {
    const progress = mirror.total > 0 && mirror.status === "syncing" ? `<span class="mirror-progress mono">${mirror.completed || 0} / ${mirror.total}</span>` : "";
    const targetPath = mirror.targetPath || `MyBridge / ${mirror.targetFolderName}`;
    const sourcePath = mirror.sourcePath || "Windows Project Folder";
    return `<article class="mirror-card ${mirrorStatusClass(mirror)}">
      <div class="mirror-card-top"><div><span class="panel-index">FOLDER MIRROR</span><h3>${escapeHtml(mirror.name)}</h3></div><span class="mirror-status">${mirrorStatus(mirror)}</span></div>
      <div class="mirror-route"><div class="mirror-endpoint"><small>WINDOWS PROJECT FOLDER</small><strong title="${escapeHtml(sourcePath)}">${escapeHtml(sourcePath)}</strong></div><span class="mirror-arrow">→</span><div class="mirror-endpoint"><small>MAC MIRROR FOLDER</small><strong title="${escapeHtml(targetPath)}">${escapeHtml(targetPath)}</strong></div></div>
      <div class="mirror-meta"><span>${mirror.currentFile ? `最近文件：${escapeHtml(mirror.currentFile)}` : mirror.status === "error" && mirror.lastError ? escapeHtml(friendlyError(mirror.lastError)) : mirror.status === "success" ? `最近同步 ${formatTime(mirror.lastSyncAt)}` : "等待文件变化"}</span>${progress || `<span>${mirror.fileCount ? `${mirror.fileCount} 个文件` : "递归保持目录结构"}</span>`}</div>
      <div class="mirror-actions">${mirror.targetPath ? `<button class="text-button" data-action="open" data-path="${escapeHtml(mirror.targetPath)}" type="button">在 Finder 中打开 ↗</button>` : ""}<span class="mirror-action-spacer"></span><button class="button button-small" data-action="toggle" data-id="${escapeHtml(mirror.id)}" type="button">${mirror.enabled ? "暂停" : "恢复"}</button><button class="text-button danger-button" data-action="remove" data-id="${escapeHtml(mirror.id)}" data-name="${escapeHtml(mirror.name)}" type="button">移除</button></div>
    </article>`;
  }).join("");
  list.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleMirrorAction(button.dataset)));
}

function activityLabel(item) {
  if (item.type === "pair") return "设备连接";
  if (item.type === "settings") return "本机设置";
  if (item.type === "mirror") return "镜像设置";
  return item.direction === "in" ? "文件抵达" : "文件发送";
}

function renderActivity(state) {
  const list = $("#activity-list");
  if (!state.activity?.length) {
    list.innerHTML = `<div class="empty-activity">添加文件夹后，这里会显示每一次文件抵达的记录。</div>`;
    return;
  }
  list.innerHTML = state.activity.slice(0, 12).map((item) => `
    <div class="activity-row">
      <span class="activity-status ${item.status === "success" ? "is-success" : "is-failed"}">${item.status === "success" ? "完成" : "失败"}</span>
      <span class="activity-file"><strong>${escapeHtml(item.mirrorName || activityLabel(item))}</strong><small>${escapeHtml(item.path || item.error || "")}</small></span>
      <span class="activity-time mono">${formatTime(item.at)}</span>
    </div>`).join("");
}

function renderSync(state) {
  const sync = state.sync;
  const card = $("#connection-card");
  card.dataset.sync = sync.status;
  $("#sync-status-label").textContent = STATUS_LABELS[sync.status] || "Waiting";
  $("#pause-button").textContent = sync.paused ? "恢复全部" : "暂停全部";
  $("#pause-button").title = sync.paused ? "恢复所有文件夹同步" : "暂停所有文件夹同步";
  $("#pause-button").disabled = !(state.mirrors?.length || state.config.sourceFolder);
  if (sync.status === "error" && sync.lastError && sync.lastError !== lastErrorToast) {
    lastErrorToast = sync.lastError;
    showToast(friendlyError(sync.lastError), "error");
  }
}

function render(state) {
  currentState = state;
  renderConnection(state);
  renderSettings(state);
  renderDevices(state);
  renderMirrors(state);
  renderActivity(state);
  renderSync(state);
}

async function refresh(showError = false) {
  try {
    render(await api(`/api/state?at=${Date.now()}`, { headers: {} }));
  } catch (error) {
    if (showError) showToast(friendlyError(error.message), "error");
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("#settings-message").textContent = "保存中…";
  try {
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        deviceName: $("#device-name").value,
        mybridgeRoot: $("#mybridge-root").value,
        ignoreRules: $("#ignore-rules").value,
        sourceFolder: $("#source-folder").value,
        destinationFolder: $("#destination-folder").value
      })
    });
    if (window.mybridge?.setAutoLaunch && $("#auto-launch")) await window.mybridge.setAutoLaunch($("#auto-launch").checked);
    $("#settings-message").textContent = "已保存";
    showToast("本机设置已保存", "success");
    await refresh();
  } catch (error) {
    $("#settings-message").textContent = error.message;
    showToast(friendlyError(error.message), "error");
  } finally {
    button.disabled = false;
  }
}

async function pairDevice(data) {
  if (currentState?.config?.pairedDevice?.deviceId === data.id) return;
  try {
    await api("/api/pair", { method: "POST", body: JSON.stringify({ baseUrl: data.url, deviceId: data.id, deviceName: data.name }) });
    showToast(`已与 ${data.name} 连接`, "success");
    await refresh();
  } catch (error) {
    showToast(`连接失败：${friendlyError(error.message)}`, "error");
  }
}

async function manualPair() {
  const url = $("#manual-address").value.trim();
  if (!url) return showToast("请输入对方设备地址", "error");
  await pairDevice({ url, name: "手动添加的设备" });
}

async function pickFolder(inputId) {
  if (!window.mybridge?.pickFolder) return showToast("请直接在输入框填写文件夹路径", "info");
  const input = $(inputId);
  const folder = await window.mybridge.pickFolder(input.value);
  if (folder) input.value = folder;
}

function openMirrorDialog() {
  const dialog = $("#mirror-dialog");
  $("#mirror-name").value = "";
  $("#mirror-source").value = "";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else showToast("请在浏览器中直接填写项目目录", "info");
}

async function submitMirror(event) {
  event.preventDefault();
  const button = event.submitter;
  const sourcePath = $("#mirror-source").value.trim();
  const name = $("#mirror-name").value.trim() || folderNameFromPath(sourcePath);
  if (!sourcePath) return showToast("请选择一个项目文件夹", "error");
  button.disabled = true;
  try {
    await api("/api/mirrors", { method: "POST", body: JSON.stringify({ sourcePath, name }) });
    $("#mirror-dialog").close();
    showToast(`${name} 已开始同步`, "success");
    await refresh();
  } catch (error) {
    showToast(friendlyError(error.message), "error");
  } finally {
    button.disabled = false;
  }
}

async function handleMirrorAction(data) {
  if (data.action === "open") {
    if (!window.mybridge?.openPath) return showToast(data.path, "info");
    const error = await window.mybridge.openPath(data.path);
    if (error) showToast(`无法打开目录：${error}`, "error");
    return;
  }
  if (data.action === "remove") {
    if (!window.confirm(`移除“${data.name}”？\n\n这只会停止同步关系，不会删除 Windows 或 Mac 上的文件。`)) return;
    try {
      await api(`/api/mirrors/${encodeURIComponent(data.id)}/remove`, { method: "POST", body: "{}" });
      showToast("同步关系已移除，文件不会被删除", "success");
      await refresh();
    } catch (error) {
      showToast(friendlyError(error.message), "error");
    }
    return;
  }
  if (data.action === "toggle") {
    const mirror = currentState?.mirrors?.find((item) => item.id === data.id);
    if (!mirror) return;
    try {
      await api(`/api/mirrors/${encodeURIComponent(data.id)}/${mirror.enabled ? "pause" : "resume"}`, { method: "POST", body: "{}" });
      await refresh();
    } catch (error) {
      showToast(friendlyError(error.message), "error");
    }
  }
}

async function togglePause() {
  const paused = !currentState?.sync?.paused;
  try {
    if (window.mybridge?.setPaused) await window.mybridge.setPaused(paused);
    else await api("/api/pause", { method: "POST", body: JSON.stringify({ paused }) });
    await refresh();
  } catch (error) {
    showToast(friendlyError(error.message), "error");
  }
}

async function resync() {
  const button = $("#resync-button");
  button.disabled = true;
  try {
    await api("/api/resync", { method: "POST", body: "{}" });
    showToast("全量扫描已完成", "success");
    await refresh();
  } catch (error) {
    showToast(friendlyError(error.message), "error");
  } finally {
    button.disabled = false;
  }
}

$("#settings-form").addEventListener("submit", saveSettings);
$("#mirror-form").addEventListener("submit", submitMirror);
$("#add-mirror-button").addEventListener("click", openMirrorDialog);
$("#cancel-mirror-button").addEventListener("click", () => $("#mirror-dialog").close());
$("#refresh-button").addEventListener("click", () => refresh(true));
$("#manual-pair-button").addEventListener("click", manualPair);
$("#resync-button").addEventListener("click", resync);
$("#pick-mirror-source").addEventListener("click", async () => {
  if (!window.mybridge?.pickFolder) return showToast("请直接在输入框填写项目目录", "info");
  const folder = await window.mybridge.pickFolder($("#mirror-source").value);
  if (folder) {
    $("#mirror-source").value = folder;
    if (!$("#mirror-name").value) $("#mirror-name").value = folderNameFromPath(folder);
  }
});
$("#pause-button").addEventListener("click", togglePause);
if (!window.mybridge) document.querySelectorAll(".native-only").forEach((element) => element.classList.add("is-hidden"));
if (window.mybridge?.getAutoLaunch) window.mybridge.getAutoLaunch().then((enabled) => { $("#auto-launch").checked = Boolean(enabled); });
setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false }); }, 1000);
setInterval(() => refresh(false), 2500);
refresh(true);
