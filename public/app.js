const $ = (selector) => document.querySelector(selector);
let currentState = null;
let toastTimer = null;

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
  $("#connection-port").textContent = `PORT ${state.device.httpPort}`;
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
  $("#device-name").value = state.device.name || "";
  $("#source-folder").value = state.config.sourceFolder || "";
  $("#destination-folder").value = state.config.destinationFolder || "";
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
      <div class="device-info"><strong>${escapeHtml(device.deviceName)}</strong><span>${escapeHtml(device.role)} · ${escapeHtml(device.baseUrl)}</span></div>
      <button class="button button-small pair-button" data-url="${escapeHtml(device.baseUrl)}" data-id="${escapeHtml(device.deviceId)}" data-name="${escapeHtml(device.deviceName)}" type="button">${device.deviceId === pairedId ? "已配对" : "Pair"}</button>
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
  if (sync.status === "error" && sync.lastError) {
    showToast(sync.lastError, "error");
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
    if (showError) showToast(error.message, "error");
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
    $("#settings-message").textContent = "已保存";
    showToast("本机配置已保存", "success");
    await refresh();
  } catch (error) {
    $("#settings-message").textContent = error.message;
    showToast(error.message, "error");
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
    showToast(`配对失败：${error.message}`, "error");
  }
}

async function manualPair() {
  const url = $("#manual-address").value.trim();
  if (!url) return showToast("请输入对方的 http 地址", "error");
  await pairDevice({ url, name: "手动添加的设备" });
}

async function resync() {
  const button = $("#resync-button");
  button.disabled = true;
  try {
    await api("/api/resync", { method: "POST", body: "{}" });
    showToast("全量扫描已完成", "success");
    await refresh();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

$("#settings-form").addEventListener("submit", saveSettings);
$("#manual-pair-button").addEventListener("click", manualPair);
$("#refresh-button").addEventListener("click", () => refresh(true));
$("#resync-button").addEventListener("click", resync);
setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false }); }, 1000);
setInterval(() => refresh(false), 2500);
refresh(true);
