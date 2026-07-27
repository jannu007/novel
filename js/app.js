const STORAGE_APPS = "ccam_apps_v1";
const STORAGE_SETTINGS = "ccam_settings_v1";

const STATUS_LABELS = {
  unclassified: "未分類",
  in_progress: "開発中",
  completed: "完成",
  paused: "一時停止",
  archived: "アーカイブ",
};

let apps = loadApps();
let settings = loadSettings();
let state = { status: "all", search: "", sort: "updated_desc" };

function loadApps() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_APPS)) || [];
  } catch {
    return [];
  }
}

function saveApps() {
  localStorage.setItem(STORAGE_APPS, JSON.stringify(apps));
}

function loadSettings() {
  try {
    return (
      JSON.parse(localStorage.getItem(STORAGE_SETTINGS)) || {
        username: "",
        token: "",
        onlyTopic: false,
        topicName: "claude-code",
      }
    );
  } catch {
    return { username: "", token: "", onlyTopic: false, topicName: "claude-code" };
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function relativeTime(iso) {
  if (!iso) return "更新日時不明";
  const diffMs = Date.now() - new Date(iso).getTime();
  const day = 86400000;
  const days = Math.floor(diffMs / day);
  if (days <= 0) return "今日";
  if (days === 1) return "1日前";
  if (days < 30) return `${days}日前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}ヶ月前`;
  return `${Math.floor(months / 12)}年前`;
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add("hidden"), 3200);
}

// ---------- Rendering ----------

function getFilteredSortedApps() {
  let list = apps;
  if (state.status !== "all") {
    list = list.filter((a) => a.status === state.status);
  }
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    list = list.filter((a) => {
      const hay = [a.name, a.description, ...(a.tags || [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }
  list = [...list];
  switch (state.sort) {
    case "updated_asc":
      list.sort((a, b) => new Date(a.lastUpdated || 0) - new Date(b.lastUpdated || 0));
      break;
    case "name_asc":
      list.sort((a, b) => a.name.localeCompare(b.name, "ja"));
      break;
    default:
      list.sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0));
  }
  return list;
}

function render() {
  const grid = document.getElementById("app-grid");
  const empty = document.getElementById("empty-state");
  const list = getFilteredSortedApps();

  grid.innerHTML = "";

  if (apps.length === 0) {
    empty.classList.remove("hidden");
    empty.textContent = "";
    empty.innerHTML =
      "まだ登録されたアプリがありません。<br>「設定」からGitHubアカウントを連携して同期するか、「＋ 手動で追加」から登録してください。";
    return;
  }
  empty.classList.add("hidden");

  if (list.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = "条件に一致するアプリがありません。";
    grid.appendChild(p);
    return;
  }

  for (const app of list) {
    grid.appendChild(buildCard(app));
  }
}

function buildCard(app) {
  const card = document.createElement("div");
  card.className = "app-card";
  card.addEventListener("click", () => openEditModal(app.id));

  const head = document.createElement("div");
  head.className = "app-card-head";

  const name = document.createElement("div");
  name.className = "app-name";
  name.textContent = app.name;

  const badge = document.createElement("span");
  badge.className = `badge badge-${app.status}`;
  badge.textContent = STATUS_LABELS[app.status] || app.status;

  head.append(name, badge);

  const desc = document.createElement("div");
  desc.className = "app-desc";
  desc.textContent = app.description || "説明なし";

  const tags = document.createElement("div");
  tags.className = "app-tags";
  for (const tag of app.tags || []) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    tags.appendChild(chip);
  }

  const foot = document.createElement("div");
  foot.className = "app-card-foot";

  const updated = document.createElement("span");
  updated.className = app.source === "github" ? "source-github" : "";
  updated.textContent = relativeTime(app.lastUpdated);

  const link = document.createElement("a");
  if (app.url) {
    link.href = app.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "開く ↗";
    link.addEventListener("click", (e) => e.stopPropagation());
  }

  foot.append(updated, link);

  card.append(head, desc, tags, foot);
  return card;
}

// ---------- Edit modal ----------

const editModal = document.getElementById("edit-modal");
const editForm = document.getElementById("edit-form");

function openEditModal(id) {
  const app = id ? apps.find((a) => a.id === id) : null;

  document.getElementById("edit-modal-title").textContent = app ? "アプリを編集" : "アプリを追加";
  document.getElementById("f-id").value = app ? app.id : "";
  document.getElementById("f-source").value = app ? app.source : "manual";
  document.getElementById("f-repo-full-name").value = app ? app.repoFullName || "" : "";
  document.getElementById("f-name").value = app ? app.name : "";
  document.getElementById("f-description").value = app ? app.description || "" : "";
  document.getElementById("f-status").value = app ? app.status : "unclassified";
  document.getElementById("f-url").value = app ? app.url || "" : "";
  document.getElementById("f-tags").value = app ? (app.tags || []).join(", ") : "";
  document.getElementById("f-notes").value = app ? app.notes || "" : "";
  document.getElementById("btn-delete").classList.toggle("hidden", !app);

  editModal.showModal();
}

editForm.addEventListener("submit", (e) => {
  const id = document.getElementById("f-id").value;
  const tags = document
    .getElementById("f-tags")
    .value.split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const data = {
    name: document.getElementById("f-name").value.trim(),
    description: document.getElementById("f-description").value.trim(),
    status: document.getElementById("f-status").value,
    url: document.getElementById("f-url").value.trim(),
    tags,
    notes: document.getElementById("f-notes").value.trim(),
  };

  if (id) {
    const app = apps.find((a) => a.id === id);
    Object.assign(app, data);
  } else {
    apps.push({
      id: uid(),
      source: "manual",
      repoFullName: null,
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      ...data,
    });
  }
  saveApps();
  render();
});

document.getElementById("btn-cancel").addEventListener("click", () => editModal.close());

document.getElementById("btn-delete").addEventListener("click", () => {
  const id = document.getElementById("f-id").value;
  if (!id) return;
  if (confirm("このアプリの登録を削除しますか？（GitHub同期対象の場合、次回同期で再登録されます）")) {
    apps = apps.filter((a) => a.id !== id);
    saveApps();
    render();
    editModal.close();
  }
});

document.getElementById("btn-add").addEventListener("click", () => openEditModal(null));

// ---------- Settings modal ----------

const settingsModal = document.getElementById("settings-modal");

document.getElementById("btn-settings").addEventListener("click", () => {
  document.getElementById("s-username").value = settings.username || "";
  document.getElementById("s-token").value = settings.token || "";
  document.getElementById("s-only-topic").checked = !!settings.onlyTopic;
  document.getElementById("s-topic-name").value = settings.topicName || "claude-code";
  settingsModal.showModal();
});

document.getElementById("btn-settings-cancel").addEventListener("click", () => settingsModal.close());

document.getElementById("settings-form").addEventListener("submit", () => {
  settings = {
    username: document.getElementById("s-username").value.trim(),
    token: document.getElementById("s-token").value.trim(),
    onlyTopic: document.getElementById("s-only-topic").checked,
    topicName: document.getElementById("s-topic-name").value.trim() || "claude-code",
  };
  saveSettings();
  showToast("設定を保存しました");
});

document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(apps, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `claude-code-apps-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("import-file").click();
});

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported)) throw new Error("invalid format");
    let added = 0;
    for (const item of imported) {
      const key = item.repoFullName;
      const exists = key ? apps.find((a) => a.repoFullName === key) : apps.find((a) => a.id === item.id);
      if (!exists) {
        apps.push({ ...item, id: item.id || uid() });
        added++;
      }
    }
    saveApps();
    render();
    showToast(`${added}件のアプリをインポートしました`);
  } catch (err) {
    showToast("インポートに失敗しました：ファイル形式を確認してください");
  } finally {
    e.target.value = "";
  }
});

// ---------- GitHub sync ----------

function parseLinkHeader(header) {
  if (!header) return {};
  const links = {};
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) links[match[2]] = match[1];
  }
  return links;
}

async function fetchAllRepos() {
  const headers = { Accept: "application/vnd.github+json" };
  if (settings.token) headers.Authorization = `Bearer ${settings.token}`;

  let url = settings.token
    ? "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner"
    : `https://api.github.com/users/${encodeURIComponent(settings.username)}/repos?per_page=100&sort=updated`;

  const results = [];
  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub API エラー (${res.status}): ${body.slice(0, 200)}`);
    }
    const page = await res.json();
    results.push(...page);
    const links = parseLinkHeader(res.headers.get("Link"));
    url = links.next || null;
  }
  return results;
}

async function syncGithub() {
  if (!settings.username && !settings.token) {
    showToast("先に「設定」でGitHubユーザー名またはトークンを入力してください");
    settingsModal.showModal();
    return;
  }

  const btn = document.getElementById("btn-sync");
  btn.disabled = true;
  btn.textContent = "同期中…";

  try {
    let repos = await fetchAllRepos();

    if (settings.onlyTopic && settings.topicName) {
      const headers = { Accept: "application/vnd.github.mercy-preview+json" };
      if (settings.token) headers.Authorization = `Bearer ${settings.token}`;
      const withTopics = [];
      for (const repo of repos) {
        try {
          const tRes = await fetch(`https://api.github.com/repos/${repo.full_name}/topics`, { headers });
          const tData = tRes.ok ? await tRes.json() : { names: [] };
          if ((tData.names || []).includes(settings.topicName)) withTopics.push(repo);
        } catch {
          // skip repo if topic lookup fails
        }
      }
      repos = withTopics;
    }

    let added = 0;
    let updated = 0;

    for (const repo of repos) {
      const existing = apps.find((a) => a.repoFullName === repo.full_name);
      if (existing) {
        existing.description = repo.description || existing.description;
        existing.lastUpdated = repo.pushed_at;
        existing.url = repo.html_url;
        updated++;
      } else {
        apps.push({
          id: uid(),
          source: "github",
          repoFullName: repo.full_name,
          name: repo.name,
          description: repo.description || "",
          status: "unclassified",
          url: repo.html_url,
          tags: repo.language ? [repo.language] : [],
          notes: "",
          lastUpdated: repo.pushed_at,
          createdAt: new Date().toISOString(),
        });
        added++;
      }
    }

    saveApps();
    render();
    showToast(`同期完了：新規 ${added}件 / 更新 ${updated}件`);
    settingsModal.close();
  } catch (err) {
    showToast(err.message || "同期に失敗しました");
  } finally {
    btn.disabled = false;
    btn.textContent = "GitHubと同期";
  }
}

document.getElementById("btn-sync").addEventListener("click", syncGithub);

// ---------- Toolbar events ----------

document.getElementById("search").addEventListener("input", (e) => {
  state.search = e.target.value;
  render();
});

document.getElementById("sort").addEventListener("change", (e) => {
  state.sort = e.target.value;
  render();
});

document.getElementById("status-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  state.status = btn.dataset.status;
  render();
});

render();
