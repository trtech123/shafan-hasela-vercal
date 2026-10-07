const REQUIRED_SECTIONS = [
  "profile",
  "menus",
  "sites",
  "activities",
  "policies",
  "safety",
  "faq",
  "handoff",
];

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid chatbot content: ${message}`);
}

export function validateContentBundle(bundle) {
  for (const section of REQUIRED_SECTIONS) {
    assert(bundle?.[section], `missing ${section}`);
  }

  const versions = new Set(REQUIRED_SECTIONS.map((section) => bundle[section].content_version));
  assert(versions.size === 1 && !versions.has(undefined), "content versions must match");
  for (const section of REQUIRED_SECTIONS) {
    assert(bundle[section].schema_version === 1, `${section} schema version must be 1`);
  }

  const menuIds = new Set();
  let responseCount = 0;
  for (const menu of bundle.menus.menus) {
    assert(menu.id && !menuIds.has(menu.id), `duplicate menu id ${menu.id}`);
    menuIds.add(menu.id);
    assert(menu.prompt && Array.isArray(menu.options) && menu.options.length > 0, `invalid menu ${menu.id}`);
    const optionIds = new Set();
    const optionNumbers = new Set();
    for (const option of menu.options) {
      assert(option.id && !optionIds.has(option.id), `duplicate option ${menu.id}.${option.id}`);
      assert(Number.isInteger(option.number) && !optionNumbers.has(option.number), `duplicate option number in ${menu.id}`);
      assert(option.label && option.next_state, `incomplete option in ${menu.id}`);
      optionIds.add(option.id);
      optionNumbers.add(option.number);
      responseCount += 1;
    }
  }

  const registeredTargets = new Set([
    "flow.corporate",
    "flow.pricing",
    "flow.clubs_handoff",
    "capture.corporate_lead",
    "handoff.missing_content",
    "answer.site.berko_overview",
    "answer.site.field_overview",
    "answer.site.acre_directions",
    "answer.site.berko_directions",
    ...bundle.activities.activities.map((activity) => `answer.activity.${activity.id}`),
    ...bundle.safety.answers.map((answer) => `answer.safety.${answer.id}`),
    ...bundle.faq.entries.map((entry) => `answer.faq.${entry.id}`),
  ]);

  for (const menu of bundle.menus.menus) {
    for (const option of menu.options) {
      if (option.next_state.startsWith("menu.")) {
        assert(menuIds.has(option.next_state.slice(5)), `unknown target ${option.next_state}`);
      } else {
        assert(registeredTargets.has(option.next_state), `unknown target ${option.next_state}`);
      }
    }
  }

  const uniqueIds = (records, label) => {
    const ids = new Set();
    for (const record of records) {
      assert(record.id && !ids.has(record.id), `duplicate ${label} id ${record.id}`);
      ids.add(record.id);
      if (record.response) responseCount += 1;
    }
  };

  uniqueIds(bundle.sites.sites, "site");
  uniqueIds(bundle.activities.activities, "activity");
  uniqueIds(bundle.safety.answers, "safety answer");
  uniqueIds(bundle.faq.entries, "FAQ");

  assert(bundle.profile.guardrails.generative_factual_answers === false, "generative answers must be disabled");
  assert(bundle.profile.guardrails.operational_data_access === false, "operational data access must be disabled");
  assert(bundle.policies.pricing_and_booking.specific_price_behavior === "handoff_only", "specific prices must hand off");
  assert(bundle.handoff.automation_lock.allowed_automatic_responses.length === 0, "locked conversations cannot auto-reply");

  return {
    contentVersion: [...versions][0],
    menuCount: menuIds.size,
    responseCount,
  };
}
