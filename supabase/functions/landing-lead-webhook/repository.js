export function createLandingLeadRepository(client) {
  return {
    async ingest({ formId, submissionKey, contactKey, lead }) {
      const { data, error } = await client.rpc('ingest_landing_lead', {
        p_form_id: formId, p_submission_key: submissionKey,
        p_contact_key: contactKey, p_lead: lead,
      });
      if (error || !data || (data.limited !== true &&
        (typeof data.created !== 'boolean' || typeof data.leadId !== 'string')))
        throw new Error('landing_lead_storage_failed');
      return data;
    },
  };
}
