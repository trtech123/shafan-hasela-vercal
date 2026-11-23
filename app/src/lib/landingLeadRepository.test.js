import { describe, expect, test, vi } from 'vitest';
import { createLandingLeadRepository } from '../../../supabase/functions/landing-lead-webhook/repository.js';

describe('landing lead repository', () => {
  test('uses the atomic service-role RPC and maps its result', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { created: true, leadId: 'lead-1' }, error: null });
    const repository = createLandingLeadRepository({ rpc });
    const input = { formId: 'form-1', submissionKey: 'a'.repeat(64),
      contactKey: 'b'.repeat(64), lead: { fullName: 'Synthetic Customer', source: 'landing_page' } };
    expect(await repository.ingest(input)).toEqual({ created: true, leadId: 'lead-1' });
    expect(rpc).toHaveBeenCalledWith('ingest_landing_lead', {
      p_form_id: input.formId, p_submission_key: input.submissionKey,
      p_contact_key: input.contactKey, p_lead: input.lead,
    });
  });

  test('fails closed on database errors and malformed results', async () => {
    const failed = createLandingLeadRepository({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'test' } }) });
    await expect(failed.ingest({})).rejects.toThrow('landing_lead_storage_failed');
    const malformed = createLandingLeadRepository({ rpc: vi.fn().mockResolvedValue({ data: {}, error: null }) });
    await expect(malformed.ingest({})).rejects.toThrow('landing_lead_storage_failed');
  });
});
