# Canonical Hebrew Chatbot Content Version 1

This directory contains the exact approved response text and a structured mapping of the final client-document section `תסריט בוט — שפן הסלע / מסמך הטמעה למפתח הבוט`, version 1.0, July 2026. Structural IDs, transitions, and capture metadata implement the separately approved design; they are not presented as quotations from the document.

These files are documentation artifacts, not runtime code. Implementation must copy the records into runtime content modules without changing business facts or approved response text.

## Authority rules

1. The final implementation script is authoritative.
2. Earlier research is background only.
3. Missing content is `handoff_only`.
4. A specific price is never a bot answer.
5. Unknown questions always hand off.
6. The seven-option main menu uses FAQ as option 7; the repeated 6 in the source is treated as a numbering typo, not an eighth or duplicate option.
7. The approved transfer response is sent once when handoff begins; no automatic waiting response is invented or sent after the conversation is locked.

## Files

- `profile.json`: identity, voice, channels, and global guardrails.
- `menus.json`: stable menu IDs, labels, prompts, and transitions.
- `sites.json`: approved site and directions content.
- `activities.json`: approved activity answers.
- `policies.json`: corporate, pricing, booking, VAT, participant-count, cancellation, weather, and clothing content.
- `safety.json`: approved safety question-and-answer content.
- `faq.json`: approved FAQ entries.
- `handoff.json`: triggers, collection fields, automation lock, and transfer copy.

## Content version

`client-doc-1.0-2026-07-he`
