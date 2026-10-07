import { Buffer } from 'node:buffer';
import { boundedOperation, DeliveryError, safeProviderId, validEmail } from './contract.js';
export function createEmailProvider({ user, password, createTransport, timeoutMs = 25000 }) {
  const configured = Boolean(validEmail(user) && password);
  return {
    async capabilities() { return { configured, canSend: configured, reason: configured ? null : 'email_not_configured' }; },
    async send({ destination, pdfBytes, clientName, quoteNumber, fileName }) {
      const transport = createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, auth: { user, pass: password } });
      try {
        const sent = await boundedOperation(signal => {
          signal.addEventListener('abort', () => transport.close(), { once: true });
          return transport.sendMail({ from: user, to: destination, subject: `הצעת מחיר ${quoteNumber} — שפן הסלע`, text: `שלום ${clientName},\nמצורפת הצעת המחיר ${quoteNumber}.\nשפן הסלע`, disableFileAccess: true, disableUrlAccess: true, attachments: [{ filename: fileName, content: Buffer.from(pdfBytes), contentType: 'application/pdf' }] });
        }, timeoutMs);
        const id = safeProviderId(sent.messageId);
        if (!id || !Array.isArray(sent.accepted) || sent.accepted.length !== 1 || sent.accepted[0] !== destination) throw new DeliveryError('provider_response_uncertain', 502, 'uncertain');
        return id;
      } catch (error) {
        if (error instanceof DeliveryError) throw error;
        if (Number.isInteger(error?.responseCode) && error.responseCode >= 400 && error.responseCode <= 599) throw new DeliveryError('provider_rejected', 502, 'failed');
        throw new DeliveryError('provider_unavailable', 502, 'uncertain');
      } finally { transport.close(); }
    },
  };
}
