const $ = (selector) => document.querySelector(selector);
let currentState = null;
let toastTimer = null;
let lastErrorToast = "";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
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
  if (text.includes("No paired destination")) return "还没有连接目标设备";
  if (text.includes("timed out") || text.includes("ECONNREFUSED") || text.includes("fetch failed")) return "对方暂时离线，网络恢复后会自动重试";
  if (text.includes("Destination Folder")) return "请先在 Mac 上选择 Destination Folder";
  if (text.includes("Source Folder")) return "请先选择一个存在的 Source Folder";
  if (text.includes("Pairing token")) return "配对信息已失效，请重新连接设备";
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

function renderConnection(state) {
  const connection = state.connection;
  const status = $("#connection-status");
  const device = $("#connection-device");
  const card = $("#connection-card");
  card.classList.toggle("is-online", connection.isOnline);
  card.classList.toggle("is-offline", Boolean(state.config.pairedDevice || state.config.pairedSource) && !connection.isOnline);
  if (connection.isOnline) {
    status.textContent = "对方设备在线";
    device.textContent = connection.device?.deviceName || "已配对设备";
  } else if (state.config.pairedDevice || state.config.pairedSource) {
    status.textContent = "等待对方上线";
    device.textContent = state.config.pairedDevice?.deviceName || state.config.pairedSource?.deviceName || "已配对设备";
  } else {
    status.textContent = "等待配对";
    device.textContent = "先在下方选择一台设备";
  }
  $("#connection-role").textContent = state.device.role.toUpperCase();
  $("#advanced-port").textContent = state.device.httpPort;
}

function renderPaths(state) {
  const source = state.config.sourceFolder;
  const destination = state.config.destinationFolder;
  $("#source-path").textContent = source || "还没有选择 Source Folder";
  $("#destination-path").textContent = destination || "还没有选择 Destination Folder";
  $("#source-state").textContent = source ? "监听中" : "未配置";
  $("#destination-state").textContent = destination ? "已就绪" : "未配置";
  $("#source-state").className = `state-badge ${source ? "is-ready" : ""}`;
  $("#destination-state").className = `state-badge ${destination ? "is-ready" : ""}`;
}

function renderSettings(state) {
  if (document.activeElement !== $("#device-name")) $("#device-name").value = state.device.name || "";
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
      <button class="button button-small pair-button" data-url="${escapeHtml(device.baseUrl)}" data-id="${escapeHtml(device.deviceId)}" data-name="${escapeHtml(device.deviceName)}" type="button">${device.deviceId === pairedId ? "已配对" : "连接"}</button>
    </div>`).join("");
  list.querySelectorAll(".pair-button").forEach((button) => button.addEventListener("click", () => pairDevice(button.dataset)));
}

function activityLabel(item) {
  if (item.type === "pair") return "设备配对";
  if (item.type === "settings") return "本机配置";
  return item.direction === "in" ? "文件抵达" : "文件发送";
}

function renderActivity(state) {
  const list = $("#activity-list");
  if (!state.activity?.length) {
    list.innerHTML = `<div class="empty-activity">完成配对后，这里会显示每一次文件抵达的记录。</div>`;
    return;
  }
  list.innerHTML = state.activity.slice(0, 12).map((item) => `
    <div class="activity-row">
      <span class="activity-status ${item.status === "success" ? "is-success" : "is-failed"}">${item.status === "success" ? "完成" : "失败"}</span>
      <span class="activity-file"><strong>${escapeHtml(activityLabel(item))}</strong><small>${escapeHtml(item.path || item.error || "")}</small></span>
      <span class="activity-time mono">${formatTime(item.at)}</span>
    </div>`).join("");
}

function renderSync(state) {
  const sync = state.sync;
  const card = $("#connection-card");
  card.dataset.sync = sync.status;
  const labels = { waiting: "WAITING", syncing: "SYNCING", success: "SYNCED", error: "FAILED", paused: "PAUSED", idle: "WAITING" };
  const descriptions = { waiting: "等待开始", syncing: "正在同步", success: "最近已同步", error: "同步失败", paused: "同步已暂停", idle: "等待开始" };
  $("#sync-status-label").textContent = labels[sync.status] || "WAITING";
  $("#pause-button").textContent = sync.paused ? "恢复同步" : "暂停同步";
  $("#pause-button").title = descriptions[sync.status] || "同步控制";
  $("#pause-button").disabled = !state.config.sourceFolder;
  if (sync.status === "error" && sync.lastError && sync.lastError !== lastErrorToast) {
    lastErrorToast = sync.lastError;
    showToast(friendlyError(sync.lastError), "error");
  }
}

function render(state) {
  currentState = state;
  renderConnection(state);
  renderPaths(state);
  renderSettings(state);
  renderDevices(state);
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
        sourceFolder: $("#source-folder").value,
        destinationFolder: $("#destination-folder").value
      })
    });
    if (window.mybridge?.setAutoLaunch && $("#auto-launch")) await window.mybridge.setAutoLaunch($("#auto-launch").checked);
    $("#settings-message").textContent = "已保存";
    showToast("本机配置已保存", "success");
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
    showToast(`已与 ${data.name} 配对`, "success");
    await refresh();
  } catch (error) {
    showToast(`连接失败：${friendlyError(error.message)}`, "error");
  }
}

async function manualPair() {
  const url = $("#manual-address").value.trim();
  if (!url) return showToast("请输入对方的 http 地址", "error");
  await pairDevice({ url, name: "手动添加的设备" });
}

async function pickFolder(inputId) {
  if (!window.mybridge?.pickFolder) return showToast("请直接在输入框填写文件夹路径", "info");
  const input = $(inputId);
  const folder = await window.mybridge.pickFolder(input.value);
  if (folder) input.value = folder;
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
$("#manual-pair-button").addEventListener("click", manualPair);
$("#refresh-button").addEventListener("click", () => refresh(true));
$("#resync-button").addEventListener("click", resync);
$("#pick-source").addEventListener("click", () => pickFolder("#source-folder"));
$("#pick-destination").addEventListener("click", () => pickFolder("#destination-folder"));
$("#pause-button").addEventListener("click", togglePause);
if (!window.mybridge) document.querySelectorAll(".native-only").forEach((element) => element.classList.add("is-hidden"));
if (window.mybridge?.getAutoLaunch) window.mybridge.getAutoLaunch().then((enabled) => { $("#auto-launch").checked = Boolean(enabled); });
setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false }); }, 1000);
setInterval(() => refresh(false), 2500);
refresh(true);
