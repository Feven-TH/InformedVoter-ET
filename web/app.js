const state = {
  registry: null,
  parties: [],
  topics: [],
  selectedTopicId: null,
  selectedTopicEntries: [],
  selectedPartySlug: null,
  search: "",
  activeView: "topics",
  isSidebarOpen: true,
  sidebarWidth: 320,
  mobileDetailMode: null,
  expandedCards: new Set(),
};

const els = {
  appShell: document.querySelector("#appShell"),
  sidebar: document.querySelector("#sidebar"),
  sidebarWordmark: document.querySelector(".brand--sidebar .brand-wordmark"),
  sidebarResizer: document.querySelector("#sidebarResizer"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  sidebarBackdrop: document.querySelector("#sidebarBackdrop"),
  topicList: document.querySelector("#topicList"),
  topicCards: document.querySelector("#topicCards"),
  selectedTopicTitle: document.querySelector("#selectedTopicTitle"),
  topicsView: document.querySelector("#topicsView"),
  topicsDetailColumn: document.querySelector("#topicsDetailColumn"),
  subTopicFilter: document.querySelector("#subTopicFilter"),
  partyList: document.querySelector("#partyList"),
  selectedPartyTitle: document.querySelector("#selectedPartyTitle"),
  partiesView: document.querySelector("#partiesView"),
  partiesDetailColumn: document.querySelector("#partiesDetailColumn"),
  partyProfile: document.querySelector("#partyProfile"),
  globalSearch: document.querySelector("#globalSearch"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  chatLog: document.querySelector("#chatLog"),
  viewTitle: document.querySelector("#viewTitle"),
  viewEyebrow: document.querySelector("#viewEyebrow"),
  topbarBrand: document.querySelector("#topbarBrand"),
};

async function api(path, options) {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
  });
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
  renderTopics();
  renderParties();
  syncLayoutState();
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 767px)").matches;
}

function setMobileDetailMode(mode) {
  state.mobileDetailMode = mode;
  const isMobile = isMobileViewport();
  const isTopicDetail = isMobile && mode === "topics";
  const isPartyDetail = isMobile && mode === "parties";
  els.appShell.classList.toggle("mobile-detail-open", isTopicDetail || isPartyDetail);
  els.topicsView.classList.toggle("mobile-detail-open", isTopicDetail);
  els.partiesView.classList.toggle("mobile-detail-open", isPartyDetail);

  const activeDetailColumn = mode === "topics" ? els.topicsDetailColumn : mode === "parties" ? els.partiesDetailColumn : null;
  if ((isTopicDetail || isPartyDetail) && activeDetailColumn) {
    activeDetailColumn.scrollTop = 0;
  }
}

function getSidebarWidthBounds() {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  let min = 220;
  const max = Math.min(420, Math.max(260, Math.round(viewportWidth * 0.3)));

  if (els.sidebar && els.sidebarWordmark) {
    const sidebarStyle = window.getComputedStyle(els.sidebar);
    const paddingLeft = Number.parseFloat(sidebarStyle.paddingLeft) || 24;
    const paddingRight = Number.parseFloat(sidebarStyle.paddingRight) || 24;
    const titleWidth = Math.ceil(els.sidebarWordmark.scrollWidth);
    const minForTitle = titleWidth + paddingLeft + paddingRight + 12;
    min = Math.max(min, minForTitle);
  }

  return { min, max };
}

function matchesSearch(...values) {
  const query = state.search.trim().toLowerCase();
  if (!query) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(query));
}

function getPartyMetadata(slug, fallbackName = "") {
  return state.registry?.parties?.[slug] || { name: fallbackName || slug, name_am: "" };
}

function renderPartyName(nameAm, nameEn) {
  const amharicName = escapeHtml(nameAm || "");
  const englishName = escapeHtml(nameEn || "");
  
  // If we have both Amharic and English names and they're different
  if (amharicName && englishName && nameAm !== nameEn) {
    return `<strong class="party-name-amharic">${amharicName}</strong> <span class="party-name-english">${englishName}</span>`;
  }
  
  // If we only have one name
  if (amharicName) {
    return `<strong class="party-name-amharic">${amharicName}</strong>`;
  }
  
  if (englishName) {
    return `<strong>${englishName}</strong>`;
  }
  
  return "";
}

function renderPartyLabelFromSlug(slug, fallbackName = "") {
  const meta = getPartyMetadata(slug, fallbackName);
  return renderPartyName(meta.name_am, meta.name);
}

function renderTopics() {
  const topics = state.topics.filter((topic) =>
    matchesSearch(topic.display_name, topic.id, topic.sub_topics.map((item) => item.name).join(" "))
  );
  els.topicList.innerHTML = topics.map((topic) => `
    <button class="list-item ${topic.id === state.selectedTopicId ? "active" : ""}" data-topic-id="${topic.id}" type="button">
      <strong>${escapeHtml(topic.display_name)}</strong>
      <span>Explore related evidence and sub-topics</span>
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
  if (isMobileViewport()) {
    setSidebarOpen(false);
    setMobileDetailMode("topics");
  }
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
    matchesSearch(party.name, party.name_am, party.slug, party.ideology)
  );
  els.partyList.innerHTML = parties.map((party) => `
    <button class="list-item ${party.slug === state.selectedPartySlug ? "active" : ""}" data-party-slug="${party.slug}" type="button">
      ${renderPartyName(party.name_am, party.name)}
      <span>Open indexed positions and stance summaries</span>
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
  els.selectedPartyTitle.innerHTML = renderPartyName(party.name_am, party.name || slug);
  renderPartyProfile(party);
  if (isMobileViewport()) {
    setSidebarOpen(false);
    setMobileDetailMode("parties");
  }
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
    const toggleIcon = `
      <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <path d="M7 13L12 18L17 13M7 6L12 11L17 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    return `
      <article class="stance-block">
        <h4>${escapeHtml(categoryName)}</h4>
        <div class="subtopic-row">${chips}</div>
        <p class="stance-text">${escapeHtml(stance.position || "")}</p>
        <div class="stance-footer">
          ${video}
          <button type="button" class="read-more-toggle" aria-label="Toggle full stance">${toggleIcon}</button>
        </div>
      </article>
    `;
  }).join("");
  
  // Add Read More functionality to stance blocks
  document.querySelectorAll(".stance-block").forEach((block, idx) => {
    const p = block.querySelector("p.stance-text");
    const readMoreBtn = block.querySelector(".read-more-toggle");
    if (!p || !readMoreBtn) return;

    const stanceId = `stance-${idx}`;
    const isExpanded = state.expandedCards.has(stanceId);
    if (isExpanded) {
      p.classList.add("expanded");
    }
    readMoreBtn.classList.toggle("is-expanded", isExpanded);
    readMoreBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (state.expandedCards.has(stanceId)) {
        state.expandedCards.delete(stanceId);
        p.classList.remove("expanded");
        readMoreBtn.classList.remove("is-expanded");
      } else {
        state.expandedCards.add(stanceId);
        p.classList.add("expanded");
        readMoreBtn.classList.add("is-expanded");
      }
    });
    
    // Check if text is truncated
    setTimeout(() => {
      if (p.scrollHeight > p.clientHeight) {
        readMoreBtn.style.display = "flex";
      } else {
        readMoreBtn.style.display = "none";
      }
    }, 0);
  });
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
    title.innerHTML = renderPartyLabelFromSlug(entry.party_slug, entry.party_name);
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
    pending.innerHTML = renderAnswerCard(result.answer || "");
  } catch (error) {
    pending.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

function renderAnswerCard(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let inList = false;
  let hasContent = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  const pushHeading = (level, text) => {
    closeList();
    hasContent = true;
    if (level === 3) {
      html.push(`<div class="response-card__badge">${renderInlineMarkdown(text)}</div>`);
      return;
    }
    html.push(`<h4 class="response-card__party">${renderPartyHeading(text)}</h4>`);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    if (line.startsWith("#### ")) {
      pushHeading(4, line.slice(5));
      continue;
    }

    if (line.startsWith("### ")) {
      pushHeading(3, line.slice(4));
      continue;
    }

    if (line.startsWith("* ") || line.startsWith("- ")) {
      if (!inList) {
        html.push('<ul class="response-card__bullets">');
        inList = true;
      }
      hasContent = true;
      html.push(`<li>${renderInlineMarkdown(line.slice(2))}</li>`);
      continue;
    }

    closeList();
    hasContent = true;
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeList();
  return `<div class="response-card${hasContent ? "" : " response-card--empty"}">${html.join("")}</div>`;
}

function renderInlineMarkdown(value) {
  const text = String(value || "");
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let html = "";
  let lastIndex = 0;
  let match;

  while ((match = linkPattern.exec(text)) !== null) {
    html += renderBold(escapeHtml(text.slice(lastIndex, match.index)));
    html += `<a href="${escapeAttribute(match[2])}" target="_blank" rel="noreferrer">${renderBold(escapeHtml(match[1]))}</a>`;
    lastIndex = linkPattern.lastIndex;
  }

  html += renderBold(escapeHtml(text.slice(lastIndex)));
  return html;
}

function renderPartyHeading(text) {
  const headingText = String(text || "").trim();
  const partyMatch = Object.values(state.registry?.parties || {}).find((party) =>
    party && (party.name === headingText || party.name_am === headingText)
  );

  if (partyMatch) {
    return renderPartyName(partyMatch.name_am, partyMatch.name);
  }

  return renderInlineMarkdown(headingText);
}

function renderBold(value) {
  return value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function setView(viewName) {
  state.activeView = viewName;
  setMobileDetailMode(null);
  document.querySelectorAll(".nav-link").forEach((button) => {
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

function setSidebarOpen(isOpen) {
  state.isSidebarOpen = isOpen;
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  els.appShell.classList.toggle("sidebar-open", isOpen);
  els.appShell.classList.toggle("sidebar-closed", !isOpen);
  els.appShell.style.setProperty("--sidebar-width", `${isOpen ? state.sidebarWidth : 0}px`);
  els.sidebarBackdrop.classList.toggle("visible", isOpen && isMobile);
  els.topbarBrand.classList.toggle("visible", !isOpen);
  els.sidebar.setAttribute("aria-hidden", String(!isOpen && isMobile));
}

function syncLayoutState() {
  const isMobile = isMobileViewport();
  if (isMobile && state.isSidebarOpen) {
    state.isSidebarOpen = false;
  }
  els.appShell.style.setProperty("--sidebar-width", `${state.isSidebarOpen && !isMobile ? state.sidebarWidth : 0}px`);
  els.sidebarResizer.hidden = isMobile;
  setSidebarOpen(state.isSidebarOpen);
  setMobileDetailMode(state.mobileDetailMode);
}

function setSidebarWidth(width) {
  const { min, max } = getSidebarWidthBounds();
  state.sidebarWidth = Math.min(max, Math.max(min, Math.round(width)));
  if (state.isSidebarOpen) {
    els.appShell.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  }
}

function startSidebarResize(event) {
  if (window.matchMedia("(max-width: 767px)").matches) return;
  event.preventDefault();
  state.isResizingSidebar = true;
  document.body.classList.add("is-resizing-sidebar");

  const onMove = (moveEvent) => {
    const nextWidth = moveEvent.clientX;
    setSidebarWidth(nextWidth);
  };

  const stopResize = () => {
    state.isResizingSidebar = false;
    document.body.classList.remove("is-resizing-sidebar");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
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

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => {
    setView(button.dataset.view);
    setSidebarOpen(false);
  });
});

els.sidebarToggle.addEventListener("click", () => {
  if (isMobileViewport() && state.mobileDetailMode) {
    setMobileDetailMode(null);
    setSidebarOpen(true);
    return;
  }

  setSidebarOpen(!state.isSidebarOpen);
});
els.sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));
els.sidebarResizer.addEventListener("pointerdown", startSidebarResize);

window.addEventListener("resize", () => {
  setSidebarWidth(state.sidebarWidth);
  syncLayoutState();
});

const openMobileSearchResults = () => {
  if (!isMobileViewport()) return;
  setMobileDetailMode(null);
  setSidebarOpen(true);
};

els.globalSearch.addEventListener("focus", openMobileSearchResults);
els.globalSearch.addEventListener("input", () => {
  state.search = els.globalSearch.value;
  openMobileSearchResults();
  renderTopics();
  renderParties();
  renderTopicCards();
});

els.subTopicFilter.addEventListener("change", renderTopicCards);
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

setView("topics");
setSidebarOpen(true);
