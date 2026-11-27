import { scrapeProfile } from "./lib/scrape.js";
import { callGemini, parseJson, DEFAULT_MODEL } from "./lib/gemini.js";
import {
  buildMessagePrompt,
  buildShortenPrompt,
  buildBioPrompt,
  formatTarget,
  LIMITS,
} from "./lib/prompt.js";

const $ = (s) => document.querySelector(s);
const state = { target: null, type: "note" };

// ---------- helpers ----------
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

function status(msg, kind = "info") {
  const el = $("#status");
  if (!msg) return (el.hidden = true);
  el.textContent = msg;
  el.className = `status ${kind === "error" ? "error" : ""}`;
  el.hidden = false;
}

async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    await fn();
  } catch (e) {
    status(e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scanActiveProfile() {
  const tab = await activeTab();
  if (!/linkedin\.com\/in\//.test(tab?.url || "")) {
    throw new Error(
      "Open a LinkedIn profile page (linkedin.com/in/...) first.",
    );
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapeProfile,
  });
  console.log("[scan]", result);
  if (!result)
    throw new Error(
      "Scan returned nothing. Reload the LinkedIn tab and try again.",
    );
  const hasText =
    result.fallback || result.about || result.experience || result.topCard;
  if (!hasText) {
    throw new Error(
      `Couldn't read any profile text. Debug: ${JSON.stringify(result.debug)}`,
    );
  }
  if (!result.name) result.name = "(name not found, edit below)";
  return result;
}

async function settings() {
  const s = await chrome.storage.local.get(SAVED);
  if (!s.apiKey) throw new Error("Add your Gemini API key in Settings first.");
  s.model = s.model || DEFAULT_MODEL;
  return s;
}

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".tab")
      .forEach((b) => b.classList.toggle("active", b === btn));
    document
      .querySelectorAll(".view")
      .forEach((v) => (v.hidden = v.id !== btn.dataset.view));
    status("");
  }),
);

// ---------- persisted fields ----------
const SAVED = [
  "apiKey",
  "model",
  "myName",
  "myRole",
  "myBio",
  "myGoal",
  "myLinks",
  "mySample",
  "goal",
  "customGoal",
  "tone",
];

async function loadSaved() {
  const s = await chrome.storage.local.get([...SAVED, "type"]);
  SAVED.forEach((f) => {
    if (s[f] != null) $("#" + f).value = s[f];
  });
  if (!s.model) $("#model").value = DEFAULT_MODEL;
  if (s.type) setType(s.type);
  $("#customGoal").hidden = $("#goal").value !== "custom";
  if (!s.apiKey || !s.myBio) {
    status("First time? Add your Gemini key in Settings and fill My profile.");
  }
}

SAVED.forEach((f) => {
  const el = $("#" + f);
  const save = () => chrome.storage.local.set({ [f]: el.value });
  el.addEventListener("input", debounce(save, 300));
  el.addEventListener("change", save);
});

$("#goal").addEventListener("change", () => {
  $("#customGoal").hidden = $("#goal").value !== "custom";
});

function setType(val) {
  state.type = val;
  document
    .querySelectorAll("#type button")
    .forEach((b) => b.classList.toggle("on", b.dataset.val === val));
  chrome.storage.local.set({ type: val });
}
document.querySelectorAll("#type button").forEach((b) =>
  b.addEventListener("click", (e) => {
    e.preventDefault();
    setType(b.dataset.val);
  }),
);

// ---------- scan ----------
$("#scanBtn").addEventListener("click", () =>
  busy($("#scanBtn"), "Scanning…", async () => {
    status("");
    const p = await scanActiveProfile();
    state.target = p;
    const found = ["about", "activity", "experience", "education", "skills"]
      .map((k) => `${k} ${p[k] ? "✓" : "✗"}`)
      .join(" · ");
    $("#targetName").textContent = p.name;
    $("#targetFound").textContent = p.fallback ? "Used full page text" : found;
    $("#targetText").value = formatTarget(p);
    $("#targetBox").hidden = false;
    $("#genBtn").disabled = false;
    $("#results").innerHTML = "";
    $("#hooks").hidden = true;
  }),
);

// Clear the scanned profile when the user moves to another page.
chrome.tabs.onActivated.addListener(resetTarget);
chrome.tabs.onUpdated.addListener((_, info, tab) => {
  if (
    info.url &&
    tab.active &&
    state.target &&
    info.url.split("?")[0] !== state.target.url.split("?")[0]
  ) {
    resetTarget();
  }
});
function resetTarget() {
  if (!state.target) return;
  state.target = null;
  $("#targetBox").hidden = true;
  $("#genBtn").disabled = true;
  $("#results").innerHTML = "";
  $("#hooks").hidden = true;
}

// ---------- generate ----------
$("#genBtn").addEventListener("click", () =>
  busy($("#genBtn"), "Generating message...", async () => {
    status("");
    const s = await settings();
    if (!s.myBio && !s.myRole) {
      status(
        "Tip: fill My profile details soo the messages talk about you.",
        "info",
      );
    }
    const opts = {
      type: state.type,
      goal: $("#goal").value,
      customGoal: $("#customGoal").value,
      tone: $("#tone").value,
      role: $("#role").value.trim(),
      extra: $("#extra").value.trim(),
    };
    const { system, user } = buildMessagePrompt({
      me: s,
      targetText: $("#targetText").value,
      opts,
    });
    const raw = await callGemini({
      apiKey: s.apiKey,
      model: s.model,
      system,
      user,
      json: true,
    });
    const data = parseJson(raw);
    renderResults(data, opts.type);
  }),
);

function renderResults(data, type) {
  const limit = type === "note" ? LIMITS.note : null;

  const hooks = data.hooks || [];
  $("#hooks").textContent = hooks.length
    ? `Picked up: ${hooks.join(" · ")}`
    : "";
  $("#hooks").hidden = !hooks.length;

  const box = $("#results");
  box.innerHTML = "";
  (data.messages || []).forEach((m) => {
    const card = document.createElement("div");
    card.className = "card result";
    card.innerHTML = `
      <div class="result-head">
        <span class="result-label"></span>
        <span class="count"></span>
      </div>
      <textarea rows="${type === "note" ? 6 : 10}"></textarea>
      <div class="result-actions">
        <button class="copy">Copy Message</button>
        ${limit ? '<button class="shorten">Shorten</button>' : ""}
      </div>`;
    const ta = card.querySelector("textarea");
    const count = card.querySelector(".count");
    card.querySelector(".result-label").textContent = m.label || "Draft";
    ta.value = (m.text || "").replace(/—/g, ", "); // safety net: no em dashes

    const updateCount = () => {
      const n = ta.value.length;
      count.textContent = limit
        ? `${n}/${limit}`
        : `${ta.value.trim().split(/\s+/).length} words`;
      count.classList.toggle("over", !!limit && n > limit);
    };
    ta.addEventListener("input", updateCount);
    updateCount();

    card.querySelector(".copy").addEventListener("click", async (e) => {
      await navigator.clipboard.writeText(ta.value);
      e.target.textContent = "Copied ✓";
      setTimeout(() => (e.target.textContent = "Copy"), 1500);
    });

    card.querySelector(".shorten")?.addEventListener("click", (e) =>
      busy(e.target, "Shortening…", async () => {
        const s = await settings();
        const { system, user } = buildShortenPrompt(ta.value, limit);
        ta.value = await callGemini({
          apiKey: s.apiKey,
          model: s.model,
          system,
          user,
        });
        updateCount();
      }),
    );

    box.appendChild(card);
  });
}

// ---------- import my own profile ----------
$("#importBtn").addEventListener("click", () =>
  busy($("#importBtn"), "Reading your profile…", async () => {
    status("");
    const s = await settings();
    const p = await scanActiveProfile();
    const { system, user } = buildBioPrompt(formatTarget(p));
    const bio = await callGemini({
      apiKey: s.apiKey,
      model: s.model,
      system,
      user,
    });
    $("#myBio").value = bio;
    if (!$("#myName").value && !p.name.startsWith("("))
      $("#myName").value = p.name;
    await chrome.storage.local.set({ myBio: bio, myName: $("#myName").value });
    status("Background filled. Edit it if anything is off.");
  }),
);

loadSaved();
