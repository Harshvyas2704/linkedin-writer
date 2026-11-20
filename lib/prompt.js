export const LIMITS = { note: 300 };

const GOALS = {
  referral: "Ask if they would be open to referring me, or pointing me to the right person, for a relevant role at their company.",
  roles: "Ask whether they are hiring for roles that fit my background, and offer to share my resume.",
  network: "Introduce myself and connect. No direct job ask, just open a door for a future conversation.",
  followup: "I already applied (or am about to) for a role at their company. Mention it and ask if they can take a look or tell me who handles it.",
};

const TONES = {
  friendly: "Warm and relaxed, like a message to a senior person you respect. Contractions are fine.",
  professional: "Polite and to the point. No slang.",
  direct: "Short and confident. State who I am and the ask in as few words as possible.",
};

const BANNED = [
  "I came across your profile",
  "I hope this message finds you well",
  "I hope you are doing well",
  "I am reaching out",
  "impressive profile",
  "I would love to pick your brain",
  "synergy",
  "passionate",
  "dynamic",
];

export function formatTarget(p) {
  if (!p) return "";
  if (p.fallback) return `Name: ${p.name}\n\nPage text:\n${p.fallback}`;
  return [
    `Name: ${p.name}`,
    p.topCard && `Top of profile (headline, company, location):\n${p.topCard}`,
    p.about && `About:\n${p.about}`,
    p.activity && `Recent activity / posts:\n${p.activity}`,
    p.experience && `Experience:\n${p.experience}`,
    p.education && `Education:\n${p.education}`,
    p.skills && `Skills:\n${p.skills}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatMe(me) {
  return [
    me.myName && `Name: ${me.myName}`,
    me.myRole && `Current role: ${me.myRole}`,
    me.myBio && `Background:\n${me.myBio}`,
    me.myGoal && `What I'm looking for:\n${me.myGoal}`,
    me.myLinks && `Links I can share: ${me.myLinks}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildMessagePrompt({ me, targetText, opts }) {
  const isNote = opts.type === "note";
  const goal = opts.goal === "custom" ? opts.customGoal : GOALS[opts.goal];

  const system = `You write LinkedIn outreach messages for a job seeker. They are sent by a real person, so they must read like that person typed them.

Rules:
- ${isNote
    ? `This is a CONNECTION REQUEST NOTE. Each message must be at most ${LIMITS.note} characters including spaces. Aim for 200 to 280.`
    : "This is a DIRECT MESSAGE. Each message must be 50 to 120 words, in 2 or 3 short paragraphs."}
- Start with "Hi <their first name>," and nothing before it.
- Personalize with at least one SPECIFIC detail from their profile: a recent post, a team or product they work on, a career move, a shared skill, school, city or past company. Pick the detail that best connects to the sender.
- Link that detail to ONE concrete point about the sender (a skill, project, or result), not a list of everything.
- End with one clear, low-pressure ask that matches the goal.
- Only use facts that appear in the two profiles. Never invent numbers, shared connections, or past conversations.
- Plain conversational English. No em dashes. No emojis. No hashtags. No subject line. Do not sign off with the sender's name in a connection note.
- Never use these phrases: ${BANNED.map((b) => `"${b}"`).join(", ")}.
- Each of the 3 variants must use a different angle or hook, not the same message reworded.

Return ONLY JSON in this shape:
{"hooks": ["short note on each profile detail you used"], "messages": [{"label": "2-4 word angle name", "text": "the message"}]}
Give exactly 3 messages.`;

  const user = `SENDER (me):
${formatMe(me) || "(sender did not fill in their profile)"}
${me.mySample ? `\nA message I wrote before, match this voice:\n${me.mySample}\n` : ""}
RECIPIENT (the profile I'm looking at):
${targetText}

GOAL: ${goal || GOALS.network}
${opts.role ? `Role / job I'm interested in: ${opts.role}` : ""}
TONE: ${TONES[opts.tone] || TONES.friendly}
${opts.extra ? `Extra context from me: ${opts.extra}` : ""}`;

  return { system, user };
}

export function buildShortenPrompt(text, limit) {
  return {
    system: `Rewrite the LinkedIn message so it is at most ${limit} characters including spaces. Keep the greeting, the personal detail and the ask. Keep the same voice. No em dashes. Return only the message text.`,
    user: text,
  };
}

export function buildBioPrompt(profileText) {
  return {
    system: `Summarize this LinkedIn profile as the owner's own background notes, written in first person, for use in outreach messages. 80 to 140 words. Include years of experience, main tech stack, notable projects or results, and companies. Plain text, no headings, no em dashes. Return only the text.`,
    user: profileText,
  };
}
