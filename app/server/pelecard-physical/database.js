import { Client } from 'pg';

export function createPhysicalDatabase(env, ClientClass = Client) {
  const connectionString = env.PELECARD_PHYSICAL_DATABASE_URL;
  const ca = env.PELECARD_PHYSICAL_DATABASE_CA;
  let parsed;
  try { parsed = new URL(connectionString); } catch { throw new Error('physical_database_configuration_required'); }
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol) || !parsed.username || !parsed.password ||
    !parsed.hostname || !ca?.includes('-----BEGIN CERTIFICATE-----') || parsed.search || parsed.hash)
    throw new Error('physical_database_configuration_required');
  const options = { connectionString, ssl: { ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeoutMillis: 5000, query_timeout: 15_000, statement_timeout: 15_000,
    application_name: 'pelecard-physical-terminal' };
  return {
    async query(sql, params = []) {
      const client = new ClientClass(options);
      try {
        await client.connect();
        await client.query('BEGIN');
        await client.query("SELECT set_config('request.jwt.claim.role','service_role',true)");
        const result = await client.query(sql, params);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* Preserve original error. */ }
        throw error;
      } finally {
        await client.end();
      }
    },
  };
}
