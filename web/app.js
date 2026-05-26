const state = {
  registry: null,
  parties: [],
  topics: [],
  selectedTopicId: null,
  selectedTopicEntries: [],
  selectedPartySlug: null,
  search: "",
};

const els = {
  stats: document.querySelector("#stats"),
  topicList: document.querySelector("#topicList"),
  topicCards: document.querySelector("#topicCards"),
  topicCount: document.querySelector("#topicCount"),
  selectedTopicTitle: document.querySelector("#selectedTopicTitle"),
  subTopicFilter: document.querySelector("#subTopicFilter"),
  partyList: document.querySelector("#partyList"),
  partyCount: document.querySelector("#partyCount"),
  selectedPartyTitle: document.querySelector("#selectedPartyTitle"),
  partyProfile: document.querySelector("#partyProfile"),
  globalSearch: document.querySelector("#globalSearch"),
  refreshButton: document.querySelector("#refreshButton"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  chatLog: document.querySelector("#chatLog"),
  viewTitle: document.querySelector("#viewTitle"),
  viewEyebrow: document.querySelector("#viewEyebrow"),
};

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = payload.detail || message;
    } catch {
      // Keep the HTTP status text.
    }
    throw new Error(message);
  }
  return response.json();
}

async function loadData() {
  const [registry, parties, topics] = await Promise.all([
    api("/api/registry"),
    api("/api/parties"),
    api("/api/topics"),
  ]);
  state.registry = registry;
  state.parties = parties;
  state.topics = topics;
  state.selectedTopicId = state.selectedTopicId || topics[0]?.id || null;
  state.selectedPartySlug = state.selectedPartySlug || parties[0]?.slug || null;
  renderAll();
  if (state.selectedTopicId) {
    await selectTopic(state.selectedTopicId);
  }
  if (state.selectedPartySlug) {
    await selectParty(state.selectedPartySlug);
  }
}

function renderAll() {
  renderStats();
  renderTopics();
  renderParties();
}

function renderStats() {
  const entryCount = state.topics.reduce((total, topic) => total + topic.entry_count, 0);
  els.stats.innerHTML = `
    <div class="stat-row"><span>Parties</span><strong>${state.parties.length}</strong></div>
    <div class="stat-row"><span>Categories</span><strong>${state.topics.length}</strong></div>
    <div class="stat-row"><span>Evidence cards</span><strong>${entryCount}</strong></div>
  `;
}

function matchesSearch(...values) {
  const query = state.search.trim().toLowerCase();
  if (!query) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(query));
}

function renderTopics() {
  const topics = state.topics.filter((topic) =>
    matchesSearch(topic.display_name, topic.id, topic.sub_topics.map((item) => item.name).join(" "))
  );
  els.topicCount.textContent = topics.length;
  els.topicList.innerHTML = topics.map((topic) => `
    <button class="list-item ${topic.id === state.selectedTopicId ? "active" : ""}" data-topic-id="${topic.id}" type="button">
      <strong>${escapeHtml(topic.display_name)}</strong>
      <span>${topic.entry_count} cards · ${topic.party_count} parties · ${topic.sub_topics.length} sub-topics</span>
    </button>
  `).join("") || `<div class="empty">No categories match the search.</div>`;

  els.topicList.querySelectorAll("[data-topic-id]").forEach((button) => {
    button.addEventListener("click", () => selectTopic(button.dataset.topicId));
  });
}

async function selectTopic(topicId) {
  state.selectedTopicId = topicId;
  renderTopics();
  const topic = state.topics.find((item) => item.id === topicId);
  els.selectedTopicTitle.textContent = topic?.display_name || topicId;
  state.selectedTopicEntries = await api(`/api/topics/${encodeURIComponent(topicId)}`);
  renderSubTopicFilter();
  renderTopicCards();
}

function renderSubTopicFilter() {
  const seen = new Map();
  for (const entry of state.selectedTopicEntries) {
    if (entry.sub_topic_id && entry.sub_topic_name) {
      seen.set(entry.sub_topic_id, entry.sub_topic_name);
    }
  }
  els.subTopicFilter.innerHTML = `<option value="">All sub-topics</option>` + [...seen.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
    .join("");
}

function renderTopicCards() {
  const selectedSubTopic = els.subTopicFilter.value;
  const entries = state.selectedTopicEntries.filter((entry) =>
    (!selectedSubTopic || entry.sub_topic_id === selectedSubTopic) &&
    matchesSearch(entry.party_name, entry.summary, entry.sub_topic_name)
  );
  renderEvidenceCards(els.topicCards, entries);
}

function renderParties() {
  const parties = state.parties.filter((party) =>
    matchesSearch(party.name, party.slug, party.ideology)
  );
  els.partyCount.textContent = parties.length;
  els.partyList.innerHTML = parties.map((party) => `
    <button class="list-item ${party.slug === state.selectedPartySlug ? "active" : ""}" data-party-slug="${party.slug}" type="button">
      <strong>${escapeHtml(party.name)}</strong>
      <span>${party.stance_count} indexed categories</span>
    </button>
  `).join("") || `<div class="empty">No parties match the search.</div>`;

  els.partyList.querySelectorAll("[data-party-slug]").forEach((button) => {
    button.addEventListener("click", () => selectParty(button.dataset.partySlug));
  });
}

async function selectParty(slug) {
  state.selectedPartySlug = slug;
  renderParties();
  const party = await api(`/api/parties/${encodeURIComponent(slug)}`);
  els.selectedPartyTitle.textContent = party.name || slug;
  renderPartyProfile(party);
}

function renderPartyProfile(party) {
  const stances = Object.entries(party.stances || {});
  if (!stances.length) {
    els.partyProfile.innerHTML = `<div class="empty">No indexed stances for this party.</div>`;
    return;
  }

  const ideology = party.ideology ? `
    <div class="stance-block">
      <h4>Ideology</h4>
      <p>${escapeHtml(party.ideology)}</p>
    </div>
  ` : "";

  els.partyProfile.innerHTML = ideology + stances.map(([categoryId, stance]) => {
    const categoryName = state.registry?.topics?.[categoryId] || categoryId;
    const chips = Array.isArray(stance.sub_topics)
      ? stance.sub_topics.map((item) => `<span class="chip">${escapeHtml(item.name || item.id)}</span>`).join("")
      : "";
    const video = stance.video_url
      ? `<a class="video-link" href="${escapeAttribute(stance.video_url)}" target="_blank" rel="noreferrer">Open citation</a>`
      : "";
    return `
      <article class="stance-block">
        <h4>${escapeHtml(categoryName)}</h4>
        <div class="subtopic-row">${chips}</div>
        <p>${escapeHtml(stance.position || "")}</p>
        ${video}
      </article>
    `;
  }).join("");
}

function renderEvidenceCards(container, entries) {
  if (!entries.length) {
    container.innerHTML = `<div class="empty">No evidence cards match the current filters.</div>`;
    return;
  }
  container.innerHTML = "";
  const template = document.querySelector("#evidenceCardTemplate");
  for (const entry of entries) {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".evidence-card");
    const thumbLink = node.querySelector(".thumb-link");
    const thumb = node.querySelector(".thumb");
    const subTopic = node.querySelector(".sub-topic");
    const title = node.querySelector("h4");
    const summary = node.querySelector("p");
    const videoLink = node.querySelector(".video-link");

    const videoId = getYoutubeId(entry.video_url);
    if (videoId) {
      thumb.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      thumb.alt = `${entry.party_name} citation thumbnail`;
    } else {
      thumb.remove();
      thumbLink.classList.add("empty-thumb");
    }
    thumbLink.href = entry.video_url || "#";
    subTopic.textContent = entry.sub_topic_name || entry.category_name || "Evidence";
    title.textContent = entry.party_name || entry.party_slug;
    summary.textContent = entry.summary || "";
    videoLink.href = entry.video_url || "#";
    if (!entry.video_url) videoLink.remove();

    card.dataset.party = entry.party_slug || "";
    container.appendChild(node);
  }
}

function getYoutubeId(url) {
  if (!url) return "";
  const match = String(url).match(/[?&]v=([^&]+)/);
  return match ? match[1] : "";
}

function addMessage(role, html) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  message.innerHTML = html;
  els.chatLog.appendChild(message);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

async function sendChat(message) {
  addMessage("user", `<p>${escapeHtml(message)}</p>`);
  const pending = document.createElement("div");
  pending.className = "message assistant";
  pending.textContent = "Thinking...";
  els.chatLog.appendChild(pending);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;

  try {
    const result = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const references = (result.references || []).map((url) =>
      `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`
    );
    pending.innerHTML = `
      <p>${escapeHtml(result.answer || "")}</p>
      ${references.length ? `<div class="subtopic-row">${references.map((link) => `<span class="chip">${link}</span>`).join("")}</div>` : ""}
    `;
  } catch (error) {
    pending.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

function setView(viewName) {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${viewName}View`);
  });
  const labels = {
    topics: ["Topic Comparison", "Browse Evidence by Category"],
    parties: ["Party Profiles", "Inspect Indexed Stances"],
    chat: ["AI Router", "Ask Evidence-Bounded Questions"],
  };
  els.viewEyebrow.textContent = labels[viewName][0];
  els.viewTitle.textContent = labels[viewName][1];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

els.globalSearch.addEventListener("input", () => {
  state.search = els.globalSearch.value;
  renderTopics();
  renderParties();
  renderTopicCards();
});

els.subTopicFilter.addEventListener("change", renderTopicCards);
els.refreshButton.addEventListener("click", loadData);
els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = els.chatInput.value.trim();
  if (!message) return;
  els.chatInput.value = "";
  sendChat(message);
});

loadData().catch((error) => {
  document.body.innerHTML = `<main class="empty">${escapeHtml(error.message)}</main>`;
});
