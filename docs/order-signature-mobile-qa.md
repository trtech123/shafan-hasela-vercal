# Synthetic mobile signature QA

This fixture serves the actual `OrderSignature`, signature pad, public request client, and shared styles. Its isolated production bundle replaces the Supabase import with a stub that rejects staff calls. Vite config, env-file discovery, public assets, source maps, external fonts, and dev-server routes are disabled. Assets and PDFs are built in memory. No production server, provider, database, real order, or credentials are used. The fake API retains only a signed boolean; use **Mobile Tester**, never a real name. The unsigned PDF uses the actual production `renderUnsigned` renderer with frozen Hebrew document text and a wholly synthetic order. This is UI/device QA, not proof of database persistence, delivery, or server idempotency.

No real mobile test has been performed by preparing this harness. A mobile device, accessible private Wi-Fi address, and certificate trusted by that device are prerequisites. No public tunnel, firewall rule, certificate trust installation, or LAN server is created automatically.

## Prepare HTTPS

Use an existing approved development certificate with an IP Subject Alternative Name matching the exact private IPv4 address of this computer. Windows OpenSSL is unavailable on this machine; `/usr/bin/openssl` and `/usr/bin/wslpath` were verified in its `Ubuntu-22.04` WSL distribution. Alternatively, the operator can run these PowerShell commands to generate a short-lived test certificate in a fresh Windows TEMP directory (replace the example IP). These preparation commands have not been executed:

```powershell
$qaIp = '192.168.1.50'
$qaTls = Join-Path $env:TEMP ('signature-mobile-qa-tls-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaTls | Out-Null
$qaWslTls = (wsl -d Ubuntu-22.04 -- wslpath -a -u "$qaTls").Trim()
if ($LASTEXITCODE -ne 0 -or !$qaWslTls) { throw 'WSL path conversion failed' }
wsl -d Ubuntu-22.04 -- openssl req -x509 -newkey rsa:2048 -nodes -days 2 -keyout "$qaWslTls/key.pem" -out "$qaWslTls/cert.pem" -subj '/CN=SignatureMobileQA' -addext "subjectAltName=IP:$qaIp,IP:127.0.0.1" -addext 'basicConstraints=critical,CA:TRUE'
if ($LASTEXITCODE -ne 0) { throw 'Certificate generation failed; do not start QA' }
```

The certificate is self-signed. Device trust must be explicitly arranged by the device owner using their platform's approved process; this document does not install trust. Transfer only `cert.pem` if needed, never the private key. A certificate-error bypass is not reliable evidence of a secure context. Before signing, verify `window.isSecureContext === true` and `typeof crypto.randomUUID === 'function'` through mobile remote debugging, or use a normally trusted certificate without browser warnings. If device policy prevents trust, record that blocker rather than accepting a failed insecure HTTP test.

## Start only when ready

From the signature worktree root, with the existing `app/node_modules` dependencies and local Chrome/Edge available to the renderer (Windows autodetection; on other systems set `CONFIRMATION_CHROMIUM_PATH` to a local browser executable):

```powershell
node --test --test-timeout=90000 scripts/signatures/mobile-qa.test.mjs
# Loopback-only desktop rehearsal (default host):
node scripts/signatures/mobile-qa.mjs --cert "$qaTls/cert.pem" --key "$qaTls/key.pem"
# Stop the loopback process with Ctrl+C before explicitly starting LAN QA:
node scripts/signatures/mobile-qa.mjs --host $qaIp --cert "$qaTls/cert.pem" --key "$qaTls/key.pem"
```

Open `https://192.168.1.50:4188/` on the phone on the same private network. Use your actual chosen IP. The server rejects wildcard/public bindings, unexpected Host/Origin, unknown routes, oversized API bodies, and unsupported methods. The landing page and synthetic PDF are accessible to peers on that selected interface while it runs; use a trusted private network and stop promptly. If a firewall or Wi-Fi client isolation blocks the phone, report it; do not change those settings automatically.

## Device checklist

1. Open the synthetic PDF from the landing page. Tap its signing link in the phone's PDF viewer. It must open the HTTPS `/order-sign` page and remove the capability fragment from the visible address.
2. Confirm the PDF preview or its separate open/download link works. Test both portrait and landscape.
3. Enter **Mobile Tester**. Draw with a finger; verify the page does not scroll while drawing. Clear the signature and check that submission is disabled. Draw again.
4. Leave acceptance unchecked and verify submission remains disabled. Check acceptance, submit once, and verify the Hebrew success message.
5. Reopen the original PDF link; it should show the signed state. Restart the server to create a fresh token/state and repeat on the second device/browser.
6. Record device, OS/browser version, certificate/secure-context result, PDF viewer/link result, finger/clear/rotation result, acceptance behavior, and success result. Record failures without real personal data or capability URLs. Stop with Ctrl+C. Remove any temporary device trust using the owner's normal process after QA.

No signature or name is written to disk by the fixture, but browser PDF downloads/history are controlled by the device. The unsigned PDF is produced by the actual renderer, including its Hebrew terms, safety sections, and signing link. The automated smoke checks the in-memory request handler and bundle, not a live TLS connection or certificate trust. The API remains a fake and does not create signed evidence pages; those require the separate offline renderer/backend checks. Real iOS Safari and Android Chrome remain unverified until an operator completes this checklist.
