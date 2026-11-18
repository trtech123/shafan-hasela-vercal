import assets from "./assets.json" with { type: "json" };
import { isValidRegistrationUrl } from "./registration-link.js";

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

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200e\u200f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isMainMenuCommand(content, input = {}) {
  return [input.optionId, input.text].some((value) => {
    const text = normalize(value);
    return /^0(?:\uFE0F?\u20E3)?$/u.test(text)
      || text === "0️⃣ חזרה לתפריט הראשי"
      || content.profile.global_commands.main_menu.some((command) => normalize(command) === text);
  });
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
  const siteMenus = { acre: "acre_extreme_park", acre_groups: "acre_extreme_park", berko_topics: "berko_360_tiberias" };
  const resetsTopic = ["main", "activities_sites", "corporate_topics", "team_customer_type", "price_park"].includes(menuId) || Object.hasOwn(siteMenus, menuId);
  const collectedFields = { ...session.collectedFields };
  if (resetsTopic) {
    delete collectedFields.requested_activity;
    delete collectedFields.requested_site;
    if (menuId === "main" || menuId === "team_customer_type") {
      delete collectedFields.customer_type;
      delete collectedFields.budget_range;
    }
    if (menuId === "main" || menuId === "price_park") {
      delete collectedFields.price_park;
      delete collectedFields.price_audience;
    }
    if (siteMenus[menuId]) collectedFields.requested_site = siteMenus[menuId];
  }
  return {
    ...session,
    currentState: `menu.${menuId}`,
    parentState,
    ...(resetsTopic ? { selectedSite: siteMenus[menuId] ?? null, selectedActivity: null, collectedFields } : {}),
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
  if (optionId) return menu.options.find((option) => option.id === optionId) ?? null;
  return menu.options.find((option) => (
    text === String(option.number)
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

function followTransition(content, session, input, option, registrationUrl) {
  const target = option.next_state;
  if (target.startsWith("asset.")) {
    const asset = assets.find((item) => item.id === target.slice(6) && item.enabled);
    if (!asset) return beginHandoff(session, input, "document_unavailable");
    if (asset.id === "clubs_schedule") {
      return { session, actions: [{ type: "send_attachment", assetId: asset.id }] };
    }
    return {
      session: {
        ...enterMenu(session, "corporate_group_size", session.currentState),
        selectedSite: asset.site,
        selectedActivity: asset.topic,
        collectedFields: { ...session.collectedFields, requested_site: asset.site, requested_activity: asset.topic },
      },
      actions: [{ type: "send_attachment", assetId: asset.id }, send("menu.corporate_group_size")],
    };
  }
  if (target === "flow.berko") {
    return {
      session: enterMenu(session, "berko_topics", session.currentState),
      actions: [send("site.berko_360_tiberias.overview"), send("menu.berko_topics")],
    };
  }
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
      session: enterMenu(session, "team_customer_type", session.currentState),
      actions: [send("policy.corporate.overview"), send("menu.team_customer_type")],
    };
  }

  if (target === "flow.pricing") {
    return {
      session: enterMenu(session, "price_park", session.currentState),
      actions: [send("policy.pricing"), send("menu.price_park")],
    };
  }

  if (target.startsWith("flow.team_type.")) {
    const customerType = target.slice("flow.team_type.".length);
    return {
      session: {
        ...enterMenu(session, `team_${customerType}`, session.currentState),
        collectedFields: { ...session.collectedFields, customer_type: customerType },
      },
      actions: [send(`menu.team_${customerType}`)],
    };
  }

  if (target === "capture.team_budget") {
    const collectedFields = { ...session.collectedFields, budget_range: option.id };
    const nextSession = { ...session, collectedFields };
    const summary = `customer_type=${collectedFields.customer_type ?? "unknown"}; budget=${option.id}`;
    return beginHandoff(nextSession, { text: summary }, "quote_request");
  }

  if (target === "capture.clubs_subject") {
    return { session: { ...session, currentState: "capture.clubs_subject", parentState: session.currentState }, actions: [send("policy.clubs_subject_prompt")] };
  }

  if (target === "flow.clubs_trial") {
    if (!isValidRegistrationUrl(registrationUrl)) {
      return beginHandoff(session, input, "clubs_registration_link_unavailable", "normal", "policy.clubs_registration_pending");
    }
    return { session, actions: [{ type: "send_text", body: `קישור ההרשמה והתשלום לחודש הנוכחי: ${registrationUrl}` }] };
  }

  if (target === "blocked.clubs_trial" || target === "blocked.clubs_schedule") {
    return { session: { ...session, currentState: target, parentState: session.currentState }, actions: [send("policy.clubs_unavailable")] };
  }

  if (target === "blocked.activity") {
    if (option.activity_id === "extreme_premium") {
      const nextSession = { ...session, collectedFields: { ...session.collectedFields, requested_activity: "extreme_premium" } };
      return beginHandoff(nextSession, { text: "activity=extreme_premium" }, "activity_leaflet_unavailable", "normal", "policy.activity_details_handoff");
    }
    return { session, actions: [send("policy.activity_unavailable")] };
  }

  if (target.startsWith("flow.price_park.")) {
    const park = target.slice("flow.price_park.".length);
    return {
      session: {
        ...enterMenu(session, "price_audience", session.currentState),
        selectedSite: park === "acre" ? "acre_extreme_park" : "berko_360_tiberias",
        collectedFields: { ...session.collectedFields, price_park: park },
      },
      actions: [send("menu.price_audience")],
    };
  }

  if (target.startsWith("flow.price_audience.")) {
    const audience = target.slice("flow.price_audience.".length);
    const nextSession = { ...session, collectedFields: { ...session.collectedFields, price_audience: audience } };
    // Group sheets require their own explicit approval. A combined direct price
    // sheet does not establish that it is the separately supplied group asset.
    const priceAssets = {
      acre: { private: null, group: null },
      berko: { private: "berko_direct_prices", group: null },
    };
    const assetId = priceAssets[session.collectedFields.price_park]?.[audience] ?? null;
    if (!assetId || !assets.some((asset) => asset.id === assetId && asset.enabled)) {
      if (audience === "group") {
        return beginHandoff(nextSession, { text: `price_park=${session.collectedFields.price_park}; audience=group` },
          "group_price_document_unavailable", "normal", "policy.price_group_handoff");
      }
      return { session: nextSession, actions: [send("policy.price_asset_unavailable")] };
    }
    if (audience === "group") {
      return {
        session: enterMenu(nextSession, "price_group_quote", session.currentState),
        actions: [{ type: "send_attachment", assetId }, send("menu.price_group_quote")],
      };
    }
    return {
      session: nextSession,
      actions: [{ type: "send_attachment", assetId }],
    };
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

export function advance({ content, session, input, registrationUrl = null }) {
  if (LOCKED_STATUSES.has(session.status)) return { session, actions: [] };

  if (isMainMenuCommand(content, input)) {
    return {
      session: {
        ...session,
        currentState: "menu.main", parentState: null,
        selectedSite: null, selectedActivity: null, collectedFields: {},
      },
      actions: [send("menu.main")],
    };
  }

  if (session.currentState === "start") {
    const mainSession = enterMenu(session, "main", null);
    const firstResult = advance({ content, session: mainSession, input, registrationUrl });
    return {
      session: firstResult.session,
      actions: firstResult.actions[0]?.responseId === "policy.welcome"
        ? firstResult.actions : [send("policy.welcome"), ...firstResult.actions],
    };
  }

  const text = normalize(input.text);
  const commands = content.profile.global_commands;

  if (commands.back.includes(text)) {
    const target = session.parentState && menuFor(content, session.parentState) ? session.parentState : "menu.main";
    return renderMenu(content, session, target.slice(5), null);
  }
  if (commands.human.includes(text)) return beginHandoff(session, input, "explicit_human_request");

  if (session.currentState === "capture.clubs_subject") {
    if (!text) return { session, actions: [send("policy.clubs_subject_prompt")] };
    const nextSession = { ...session, collectedFields: { ...session.collectedFields, clubs_request_subject: text } };
    return beginHandoff(nextSession, { text: `clubs_request_subject=${text}` }, "clubs_existing_participant");
  }

  const menu = menuFor(content, session.currentState);
  const option = menu ? resolveMenuOption(menu, input) : null;
  if (option) return followTransition(content, session, input, option, registrationUrl);

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

  // An invalid choice is not a request for a human or a new package selection.
  if (menu && menu.id !== "main") {
    return { session, actions: [send("policy.invalid_selection"), send(`menu.${menu.id}`)] };
  }
  return {
    session: enterMenu(session, "main", null),
    actions: [send("policy.welcome"), send("menu.main")],
  };
}
