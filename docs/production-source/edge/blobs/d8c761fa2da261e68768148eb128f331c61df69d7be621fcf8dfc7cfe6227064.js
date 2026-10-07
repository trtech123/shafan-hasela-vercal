const LOCKED_STATUSES = new Set(["awaiting_human", "human_active"]);

const guardedPatterns = [
  { reason: "complaint_or_problem", priority: "high", pattern: /(?:תלונ|בעיה|תקלה|נפגע|פציע)/u },
  { reason: "specific_price", priority: "normal", pattern: /(?:כמה\s+(?:זה\s+)?עולה|מחיר|עלות|הצעת\s+מחיר)/u },
  { reason: "complex_or_custom_package", priority: "normal", pattern: /(?:מותאמת\s+אישית|בהתאמה\s+אישית|חבילה\s+מותאמת|אירוע\s+מיוחד)/u },
];

const safetyPatterns = [
  { responseId: "safety.weight", pattern: /(?:משקל|קילו)/u },
  { responseId: "safety.health", pattern: /(?:הריון|בהריון|גב|צוואר)/u },
  { responseId: "safety.age", pattern: /(?:גיל|בן\s+כמה|בת\s+כמה)/u },
  { responseId: "safety.equipment", pattern: /(?:ציוד\s+בטיחות|רתמה)/u },
  { responseId: "safety.conduct", pattern: /(?:כללי\s+(?:ה)?התנהגות|מסטיק|עישון|להשתולל)/u },
];

const orderConfirmationPatterns = [
  "שלחו לי את אישור ההזמנה",
  "אני רוצה את אישור ההזמנה שלי",
];
const greetings = new Set(["", "שלום", "היי", "אהלן", "בוקר טוב", "ערב טוב"]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200e\u200f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function send(responseId) {
  return { type: "send", responseId };
}

function menuIdFromState(state) {
  return state?.startsWith("menu.") ? state.slice(5) : null;
}

function menuFor(content, state) {
  const menuId = menuIdFromState(state);
  return content.menus.menus.find((menu) => menu.id === menuId) ?? null;
}

function enterMenu(session, menuId, parentState = session.currentState) {
  return {
    ...session,
    currentState: `menu.${menuId}`,
    parentState,
  };
}

function beginHandoff(session, input, reason, priority = "normal", responseId = "handoff.transfer", extraActions = []) {
  return {
    session: { ...session, status: "awaiting_human" },
    actions: [
      ...extraActions,
      ...(responseId ? [send(responseId)] : []),
      {
        type: "handoff",
        reason,
        priority,
        summary: normalize(input.text) || "customer_selected_menu_option",
      },
    ],
  };
}

function renderMenu(content, session, menuId, parentState) {
  const exists = content.menus.menus.some((menu) => menu.id === menuId);
  if (!exists) return beginHandoff(session, {}, "handoff_only_content");
  return {
    session: enterMenu(session, menuId, parentState),
    actions: [send(`menu.${menuId}`)],
  };
}

function resolveMenuOption(menu, input) {
  const optionId = normalize(input.optionId);
  const text = normalize(input.text);
  return menu.options.find((option) => (
    (optionId && option.id === optionId)
    || text === String(option.number)
    || text === normalize(option.label)
    || text === option.id
  )) ?? null;
}

function responseForAnswer(target) {
  const parts = target.split(".");
  if (parts[1] === "activity") return `activity.${parts.slice(2).join(".")}`;
  if (parts[1] === "safety") return `safety.${parts.slice(2).join(".")}`;
  if (parts[1] === "faq") return `faq.${parts.slice(2).join(".")}`;
  if (parts[1] === "site") {
    const mapping = {
      berko_overview: "site.berko_360_tiberias.overview",
      field_overview: "site.field_activities.overview",
      acre_directions: "site.acre_extreme_park.directions",
      berko_directions: "site.berko_360_tiberias.directions",
    };
    return mapping[parts.slice(2).join(".")] ?? null;
  }
  return null;
}

function followTransition(content, session, input, option) {
  const target = option.next_state;
  if (target.startsWith("menu.")) {
    return renderMenu(content, session, target.slice(5), session.currentState);
  }

  if (target.startsWith("answer.")) {
    const responseId = responseForAnswer(target);
    if (!responseId) return beginHandoff(session, input, "handoff_only_content");
    const actions = [send(responseId)];
    if (responseId === "faq.parent") {
      return beginHandoff(session, input, "handoff_only_content", "normal", "handoff.transfer", actions);
    }
    return { session, actions };
  }

  if (target === "flow.corporate") {
    return {
      session: enterMenu(session, "corporate_group_size", session.currentState),
      actions: [send("policy.corporate.overview"), send("policy.corporate.offerings"), send("menu.corporate_group_size")],
    };
  }

  if (target === "flow.pricing") {
    return beginHandoff(session, input, "quote_request", "normal", "handoff.transfer", [send("policy.pricing")]);
  }

  if (target === "flow.clubs_handoff") {
    return beginHandoff(session, input, "handoff_only_content");
  }

  if (target === "handoff.missing_content") {
    return beginHandoff(session, input, "handoff_only_content");
  }

  if (target === "capture.corporate_lead") {
    const groupSizeBucket = option.id;
    const nextSession = {
      ...session,
      collectedFields: { ...session.collectedFields, group_size_bucket: groupSizeBucket },
    };
    return beginHandoff(
      nextSession,
      input,
      groupSizeBucket === "large" ? "event_over_50" : "quote_request",
      "normal",
      "policy.corporate.after_group_selection",
    );
  }

  return beginHandoff(session, input, "handoff_only_content");
}

function matchesEventOverFifty(text) {
  const match = text.match(/(\d{2,4})\s*(?:משתתפים|אנשים)/u);
  return match ? Number(match[1]) > 50 : false;
}

export function createSession() {
  return {
    status: "automated",
    currentState: "start",
    parentState: null,
    selectedSite: null,
    selectedActivity: null,
    collectedFields: {},
  };
}

export function advance({ content, session, input }) {
  if (LOCKED_STATUSES.has(session.status)) return { session, actions: [] };

  if (session.currentState === "start") {
    const mainSession = enterMenu(session, "main", null);
    if (!input.optionId && greetings.has(normalize(input.text))) {
      return {
        session: mainSession,
        actions: [send("policy.welcome"), send("menu.main")],
      };
    }
    const firstResult = advance({ content, session: mainSession, input });
    return {
      session: firstResult.session,
      actions: [send("policy.welcome"), ...firstResult.actions],
    };
  }

  const text = normalize(input.text);
  const commands = content.profile.global_commands;

  if (commands.main_menu.includes(text)) return renderMenu(content, session, "main", null);
  if (commands.back.includes(text)) {
    const target = session.parentState && menuFor(content, session.parentState) ? session.parentState : "menu.main";
    return renderMenu(content, session, target.slice(5), null);
  }
  if (commands.human.includes(text)) return beginHandoff(session, input, "explicit_human_request");

  const menu = menuFor(content, session.currentState);
  const option = menu ? resolveMenuOption(menu, input) : null;
  if (option) return followTransition(content, session, input, option);

  if (orderConfirmationPatterns.includes(text)) {
    return beginHandoff(session, input, "order_confirmation_unavailable", "normal", "handoff.transfer", [{
      type: "request_secure_action",
      actionId: "resend_order_confirmation",
      availability: "handoff_only",
    }]);
  }

  if (matchesEventOverFifty(text)) return beginHandoff(session, input, "event_over_50");

  for (const guarded of guardedPatterns) {
    if (guarded.pattern.test(text)) return beginHandoff(session, input, guarded.reason, guarded.priority);
  }

  for (const safety of safetyPatterns) {
    if (safety.pattern.test(text)) return { session, actions: [send(safety.responseId)] };
  }

  return beginHandoff(session, input, "unknown_question");
}
