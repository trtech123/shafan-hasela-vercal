const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function numberInRange(value, field, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} is invalid`);
  }
  return parsed;
}

function optionalDate(value, field) {
  const text = optionalText(value);
  if (text && !ISO_DATE.test(text)) throw new Error(`${field} is invalid`);
  return text;
}

export function validateScheduleRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error("At least one schedule rule is required");
  }

  return rules.map((rule, index) => {
    const weekday = numberInRange(rule.weekday, `weekday ${index + 1}`, 0, 6);
    const startTime = String(rule.start_time ?? "").trim();
    const endTime = String(rule.end_time ?? "").trim();
    if (!CLOCK_TIME.test(startTime) || !CLOCK_TIME.test(endTime)) {
      throw new Error(`Schedule time ${index + 1} is invalid`);
    }
    if (endTime <= startTime) {
      throw new Error(`Schedule end time ${index + 1} must be after start time`);
    }
    const effectiveFrom = optionalDate(rule.effective_from, "effective date");
    const effectiveUntil = optionalDate(rule.effective_until, "effective date");
    if (effectiveFrom && effectiveUntil && effectiveUntil < effectiveFrom) {
      throw new Error("Schedule effective date range is invalid");
    }

    return {
      weekday,
      start_time: startTime,
      end_time: endTime,
      effective_from: effectiveFrom,
      effective_until: effectiveUntil,
      timezone: "Asia/Jerusalem",
      is_active: rule.is_active !== false,
    };
  });
}

export function normalizeClubPayload(form) {
  const name = String(form.name ?? "").trim();
  if (!name) throw new Error("Club name is required");
  const monthlyPrice = numberInRange(form.monthly_price, "monthly price", 0, 999999999.99);
  const billingDay = numberInRange(form.default_billing_day, "billing day", 1, 28);
  const capacityText = String(form.capacity ?? "").trim();
  const capacity = capacityText
    ? numberInRange(capacityText, "capacity", 1, 100000)
    : null;
  if (capacity !== null && !Number.isInteger(capacity)) throw new Error("capacity is invalid");
  const allowedStatuses = new Set(["active", "inactive", "archived"]);
  if (!allowedStatuses.has(form.status)) throw new Error("Club status is invalid");

  return {
    club: {
      name,
      description: optionalText(form.description),
      instructor_id: optionalText(form.instructor_id),
      site: optionalText(form.site),
      capacity,
      monthly_price: Math.round(monthlyPrice * 100) / 100,
      currency: "ILS",
      default_billing_day: billingDay,
      status: form.status,
      notes: optionalText(form.notes),
    },
    rules: validateScheduleRules(form.schedule_rules),
  };
}

export function buildMembershipRegistration(form, club) {
  const firstName = String(form.first_name ?? "").trim();
  const lastName = String(form.last_name ?? "").trim();
  if (!firstName || !lastName) throw new Error("Participant name is required");
  if (!club?.id) throw new Error("Club is required");
  const startsOn = optionalDate(form.starts_on, "membership start date");
  if (!startsOn) throw new Error("Membership start date is required");

  const priceSource = String(form.monthly_price ?? "").trim()
    ? form.monthly_price
    : club.monthly_price;
  const billingDaySource = String(form.billing_day ?? "").trim()
    ? form.billing_day
    : club.default_billing_day;
  const monthlyPrice = numberInRange(priceSource, "monthly price", 0, 999999999.99);
  const billingDay = numberInRange(billingDaySource, "billing day", 1, 28);

  return {
    participant: {
      first_name: firstName,
      last_name: lastName,
      birth_date: optionalDate(form.birth_date, "birth date"),
      phone: optionalText(form.phone),
      email: optionalText(form.email),
      primary_contact_name: optionalText(form.primary_contact_name),
      primary_contact_relationship: optionalText(form.primary_contact_relationship),
      primary_contact_phone: optionalText(form.primary_contact_phone),
      primary_contact_email: optionalText(form.primary_contact_email),
      notes: optionalText(form.notes),
    },
    membership: {
      club_id: club.id,
      starts_on: startsOn,
      monthly_price: Math.round(monthlyPrice * 100) / 100,
      currency: "ILS",
      billing_day: billingDay,
      status: "pending_enrollment",
      payment_status: "not_enrolled",
      debt_amount: 0,
      notes: optionalText(form.membership_notes),
    },
  };
}
