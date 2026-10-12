# Chatbot document delivery implementation plan

Approved scope: the user's D2–D10 audit mappings and explicit commercial approval. D1 is excluded. Work is local only; no deployment, remote storage writes, real messages, configuration changes, or commits of customer binaries.

Architecture: explicit topic menus resolve to server-owned asset IDs. A private, dedicated Storage bucket holds immutable checksum-addressed files. The signed inbound webhook downloads and verifies a selected asset, uploads its bytes to Meta, and sends by media ID. Persist attachment intent and atomically claim it before any provider operation. Attachment attempts are never automatically repeated after dispatch begins; errors/uncertainty enter the existing staff handoff workflow. Text behavior remains compatible.

- [x] Add failing mapping/navigation/isolation tests, then implement separate corporate, Berko and Acre package menus. Keep generic group-size handoff reachable.
- [x] Add nine-entry manifest with SHA-256, size, MIME, version, title, filename, site/topic, key and enabled flag. Add storage retrieval tests for missing/disabled/corrupt assets.
- [x] Add fake-network Meta upload/send tests, then implement media-ID delivery without URLs, sanitized errors, bounded requests and uncertain-send classification.
- [x] Persist attachment IDs/checksums and claim attempts using a service-only RPC. Add private bucket and delivery-state migration; no changes to financial tables or existing storage buckets.
- [x] Add processor replay, failure, handoff and text regressions, then integrate sender and repository.
- [x] Run relevant bot/webhook/send-whatsapp suites and isolated SQL checks where local tooling permits. Review changes, document exact later release steps, and leave changes uncommitted for review.

Release boundary: existing Vercel deployment policy is untouched. Only the chatbot migration, webhook function, private bucket population and manifest verification would later require production actions. Referenced supplementary files are not synthesized.
