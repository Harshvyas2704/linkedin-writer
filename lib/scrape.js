// Runs INSIDE the LinkedIn tab via chrome.scripting.executeScript.
// It must be fully self-contained: no imports, no outside variables.
//
// Notes on the current LinkedIn layout (checked Nov 2026):
// - There is no <h1>. The name is the first <h2> in the top card.
// - The window does not scroll. Scrolling happens inside <main id="workspace">.
// - Sections below About (Experience, Education, Skills...) lazy-load on scroll.
// - Each card sits in <div id="com.linkedin.sdui.profile.card.ref<urn><Key>">, where
//   <Key> is Topcard, About, Activity, ExperienceTopLevelSection, EducationTopLevelSection,
//   Skills... Class names and `componentkey` attributes are random, so don't use them.
// - Card headings are <h2> with plain text ("About", "Experience", "Skills (34)").
export async function scrapeProfile() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const main = document.querySelector("main") || document.body;

  // ---------- 1. scroll to trigger lazy-loading ----------
  // Check the window, main and main's ancestors, plus a few big inner containers.
  const isScrollable = (el) =>
    el && el.scrollHeight > el.clientHeight + 200 &&
    (el === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(el).overflowY));
  const candidates = [document.scrollingElement || document.documentElement];
  for (let el = main; el && el !== document.documentElement; el = el.parentElement) candidates.push(el);
  main.querySelectorAll(":scope > div, :scope > div > div").forEach((el) => candidates.push(el));
  const scrollers = [...new Set(candidates)].filter(isScrollable).slice(0, 4);

  const scrollAll = async (step, wait) => {
    for (const sc of scrollers) {
      const start = sc.scrollTop;
      for (let y = 0; y < Math.min(sc.scrollHeight, 20000); y += step) {
        sc.scrollTop = y;
        await sleep(wait);
      }
      sc.scrollTop = start;
    }
  };
  const textLen = () => main.innerText.length;
  const before = textLen();
  await scrollAll(700, 200);
  await sleep(400);
  // A second, faster pass picks up cards that appeared during the first one.
  await scrollAll(1000, 100);
  await sleep(300);

  // ---------- 2. text helpers ----------
  const NOISE = /^(show all.*|see more|…\s?see more|\.\.\.\s?see more|…\s?more|show more|show less|follow|following|message|connect|more|pending|endorse|send profile in a message|save to pdf|·|•)$/i;
  const clean = (s = "", extra) =>
    s
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !NOISE.test(l))
      .filter((l) => !extra || !extra(l))
      // LinkedIn renders screen-reader copies, so the same line often shows twice in a row
      .filter((l, i, arr) => l !== arr[i - 1])
      .join("\n");

  // Drop the heading line ("About", "Skills (34)") since formatTarget adds its own label.
  const dropHeading = (text, re) => {
    const lines = text.split("\n");
    return re.test(lines[0] || "") ? lines.slice(1).join("\n") : text;
  };

  // ---------- 3. find sections ----------
  const cards = [...document.querySelectorAll('[id^="com.linkedin.sdui.profile.card"]')];
  const cardKey = (el) => el.id.match(/([A-Z][A-Za-z]+)$/)?.[1] || "";

  // Each spec: card-id suffixes to try, a heading regex, and the old anchor id.
  const SPECS = {
    topcard: { keys: ["Topcard"], heading: null, legacy: null },
    about: { keys: ["About"], heading: /^about$/i, legacy: "about" },
    activity: { keys: ["Activity"], heading: /^activity$/i, legacy: "content_collections" },
    experience: { keys: ["ExperienceTopLevelSection", "Experience"], heading: /^experience$/i, legacy: "experience" },
    education: { keys: ["EducationTopLevelSection", "Education"], heading: /^education$/i, legacy: "education" },
    skills: { keys: ["Skills", "SkillsTopLevelSection"], heading: /^skills(\s*\(\d+\))?$/i, legacy: "skills" },
  };

  const found = {};
  const findSection = (name) => {
    const spec = SPECS[name];
    // a) card wrapper id suffix (exact key match, so "VolunteerExperience..." never matches)
    for (const k of spec.keys) {
      const card = cards.find((c) => cardKey(c) === k || c.id.endsWith(k) && !/Volunteer/.test(c.id));
      const el = card && (card.querySelector("section") || card);
      if (el && el.innerText.trim()) return (found[name] = "id"), el;
    }
    // b) heading text -> nearest enclosing <section>
    if (spec.heading) {
      const h = [...main.querySelectorAll("h2, h3")].find((x) => spec.heading.test(x.innerText.trim()));
      const el = h && (h.closest("section") || h.parentElement?.parentElement);
      if (el && el.innerText.trim()) return (found[name] = "heading"), el;
    }
    // c) older layout: <div id="about"> anchor inside the section
    if (spec.legacy) {
      const el = document.getElementById(spec.legacy)?.closest("section");
      if (el && el.innerText.trim()) return (found[name] = "legacy-id"), el;
    }
    found[name] = "";
    return null;
  };

  const sectionText = (name, max, extra) => {
    const el = findSection(name);
    if (!el) return "";
    const text = clean(el.innerText, extra);
    return SPECS[name].heading ? dropHeading(text, SPECS[name].heading).slice(0, max) : text.slice(0, max);
  };

  // ---------- 4. name ----------
  const stripTitle = (t = "") => t.replace(/^\(\d+\+?\)\s*/, "").split("|")[0].trim();
  const tidyName = (n = "") => n.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim();
  const topEl = findSection("topcard");
  const fromTop = topEl?.querySelector("h2, h1")?.innerText.trim();
  const fromH1 = main.querySelector("h1")?.innerText.trim();
  const fromTitle = stripTitle(document.title);
  const fromMeta = stripTitle(document.querySelector('meta[property="og:title"]')?.content || "");
  const fromHeading = [...main.querySelectorAll("h1, h2")]
    .map((h) => h.innerText.trim())
    .find((t) => t && t.length < 60 && !/notification|messag|linkedin/i.test(t));
  const name = tidyName(
    fromTop || fromH1 || (fromTitle && !/^linkedin$/i.test(fromTitle) ? fromTitle : "") || fromMeta || fromHeading || ""
  );

  // ---------- 5. top card: headline, location, company ----------
  const TOP_NOISE = /^(verify.*|contact info|open to|open to work.*|add section|enhance profile|add profile section|show details|resources|profile enhanced with premium|view my (newsletter|blog|website|portfolio)|visit my .*|\d[\d,.]*\+? (connections?|followers?)|followed by .*|.*mutual connections?.*|• ?(1st|2nd|3rd\+?)|(1st|2nd|3rd\+?)|\(?(he|she|they)\/(him|her|them)\)?|https?:\/\/\S+|\S+\.\S+\/\S*)$/i;
  const topLines = clean(topEl ? topEl.innerText : "").split("\n");
  const rawName = topLines[0] || "";
  const contactIdx = topLines.findIndex((l) => /^contact info$/i.test(l));
  const topUseful = topLines.slice(1).filter((l) => !TOP_NOISE.test(l) && l !== rawName);
  const headline = topUseful[0] || "";
  let place = "";
  let topCompany = "";
  if (contactIdx > 0) {
    place = topLines.slice(1, contactIdx).filter((l) => !TOP_NOISE.test(l) && l !== headline).pop() || "";
    topCompany = (topLines.slice(contactIdx + 1).find((l) => !TOP_NOISE.test(l)) || "").replace(/\s*\+\s*\d+\s+more$/i, "");
  }

  // ---------- 6. sections ----------
  const about = sectionText("about", 2500);
  // Dates show as "2020 – Present" followed by a lone screen-reader "Present" line.
  const experience = sectionText("experience", 3000, (l) => /^present$/i.test(l));
  const education = sectionText("education", 1000);
  // The profile page shows only the top skills, each with "Role at Company" / "N endorsements" lines.
  const skills = sectionText("skills", 800, (l) => / at /.test(l) || /^\d+\s+endorsements?$/i.test(l) || /^\d+ experiences? across/i.test(l));

  // Activity: split posts on the "2d •" timestamp line and drop repeated author info.
  const ACT_NOISE = new RegExp(
    "^(" + [
      "\\d[\\d,.]*\\s*(followers?|impressions?|comments?|reposts?|reactions?)",
      "\\d[\\d,.]*", "create a post", "posts", "comments", "videos", "images", "articles",
      "newsletters", "documents", "events", "reactions", "view analytics",
      "view my (newsletter|blog|website|portfolio)", "visit my .*", "• ?(you|1st|2nd|3rd\\+?)",
      "edited", "promoted", "show all posts", "show all activity",
    ].join("|") + ")$", "i"
  );
  const isRepeatedAuthor = (l) => l === rawName || tidyName(l) === name || (headline && l === headline);
  let activity = sectionText("activity", 4000, (l) => ACT_NOISE.test(l) || isRepeatedAuthor(l));
  activity = activity
    .replace(/^.*\b\d+\s?(s|m|h|d|w|mo|yr|y)\s*•.*$/gim, "---")
    .replace(/(\n?---\n?)+/g, "\n---\n")
    .replace(/^\n?---\n?|\n?---\n?$/g, "")
    .trim()
    .slice(0, 2000);

  // Current company: first Experience entry is the most reliable, top card as backup.
  // Layout A: "Title / Company · Full-time / dates". Layout B (grouped): "Company / Full-time · 3 yrs / Title...".
  let company = "";
  const expLines = experience.split("\n");
  if (expLines.length >= 2) {
    const [l0, l1] = expLines;
    const DUR = /\b\d+\s*(yrs?|mos?)\b/i;
    const DATES = /\b(19|20)\d{2}\b|present/i;
    if (DUR.test(l1) && !DATES.test(l1)) company = l0;
    else if (!DATES.test(l1)) company = l1.split(" · ")[0];
  }
  company = company || topCompany;

  const topCard = [
    headline && `Headline: ${headline}`,
    company && `Current company: ${company}`,
    place && `Location: ${place}`,
    topCompany && topCompany !== company && `Also shown on profile: ${topCompany}`,
  ].filter(Boolean).join("\n") ||
    clean(topEl?.innerText || main.querySelector("section")?.innerText || "").slice(0, 1200);

  const data = {
    url: location.href,
    name,
    headline,
    company,
    location: place,
    topCard,
    about,
    activity,
    experience,
    education,
    skills,
    fallback: "",
  };

  const foundSections = ["about", "activity", "experience"].filter((k) => data[k]).length;
  if (foundSections === 0) {
    data.fallback = clean(main.innerText || document.body.innerText).slice(0, 8000);
  }

  // Debug info, visible in the side panel and its DevTools console.
  data.debug = {
    title: document.title,
    hasMain: !!document.querySelector("main"),
    h1Count: document.querySelectorAll("h1").length,
    scrollers: scrollers.map((s) => s.tagName.toLowerCase() + (s.id ? "#" + s.id : "")),
    lazyTextGrowth: textLen() - before,
    cardKeys: cards.filter((c) => c.innerText.trim()).map(cardKey),
    foundBy: found,
    bodyTextLength: document.body.innerText.length,
  };
  return data;
}
