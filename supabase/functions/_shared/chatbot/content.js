import profile from "./content/v1/he/profile.json" with { type: "json" };
import menus from "./content/v1/he/menus.json" with { type: "json" };
import sites from "./content/v1/he/sites.json" with { type: "json" };
import activities from "./content/v1/he/activities.json" with { type: "json" };
import policies from "./content/v1/he/policies.json" with { type: "json" };
import safety from "./content/v1/he/safety.json" with { type: "json" };
import faq from "./content/v1/he/faq.json" with { type: "json" };
import handoff from "./content/v1/he/handoff.json" with { type: "json" };
import { validateContentBundle } from "./content-schema.js";

export const approvedContent = {
  profile,
  menus,
  sites,
  activities,
  policies,
  safety,
  faq,
  handoff,
};

validateContentBundle(approvedContent);

function findById(records, id) {
  return records.find((record) => record.id === id) ?? null;
}

function renderMenu(menu) {
  return [
    menu.prompt,
    ...menu.options.map((option) => `${option.number}. ${option.label}`),
  ].join("\n");
}

export function resolveResponse(content, responseId) {
  const parts = responseId.split(".");
  let response = null;

  if (responseId === "policy.welcome") response = content.policies.welcome;
  if (responseId === "policy.corporate.overview") response = content.policies.corporate.overview;
  if (responseId === "policy.corporate.offerings") response = content.policies.corporate.offerings;
  if (responseId === "policy.corporate.after_group_selection") response = content.policies.corporate.after_group_selection;
  if (responseId === "policy.pricing") {
    const pricing = content.policies.pricing_and_booking;
    response = [
      pricing.intro,
      ...pricing.approved_non_price_facts.map((fact) => `• ${fact}`),
      pricing.contact,
    ].join("\n");
  }
  if (responseId === "handoff.transfer") response = content.handoff.transfer_response;

  if (parts[0] === "menu" && parts.length === 2) {
    const menu = findById(content.menus.menus, parts[1]);
    if (menu) response = renderMenu(menu);
  }
  if (parts[0] === "activity" && parts.length === 2) {
    response = findById(content.activities.activities, parts[1])?.response ?? null;
  }
  if (parts[0] === "safety" && parts.length === 2) {
    response = findById(content.safety.answers, parts[1])?.response ?? null;
  }
  if (parts[0] === "faq" && parts.length === 2) {
    response = findById(content.faq.entries, parts[1])?.response ?? null;
  }
  if (parts[0] === "site" && parts.length === 3) {
    const site = findById(content.sites.sites, parts[1]);
    if (site && parts[2] === "overview") response = site.overview;
    if (site && parts[2] === "directions") response = site.directions_response;
  }

  if (!response) throw new Error(`Unknown chatbot response: ${responseId}`);
  return response;
}
