import { createClient } from '@supabase/supabase-js';
import { readPhysicalConfig } from './config.js';
import { createPhysicalDatabase } from './database.js';
import { createPhysicalRepository } from './repository.js';
import { createPhysicalPelecardProvider } from './provider.js';
import { createHostedEmvProvider } from './hosted-provider.js';
import { createPhysicalWorkflow } from './workflow.js';

export function createPhysicalRuntime(env, overrides = {}) {
  const config = readPhysicalConfig(env);
  const database = overrides.database ?? createPhysicalDatabase(env);
  const repository = createPhysicalRepository(database);
  const authClient = overrides.authClient ?? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } });
  const provider = config.enabled
    ? createPhysicalPelecardProvider({ terminalNumber: config.terminalNumber,
      user: config.user, password: config.password, fetcher: overrides.fetcher })
    : { inspect: async () => { throw new Error('physical_disabled'); } };
  const hostedProvider = config.hostedEnabled
    ? createHostedEmvProvider({ terminal: config.terminalNumber,
      user: config.user, password: config.password }, overrides.fetcher)
    : null;
  const workflow = createPhysicalWorkflow({ ...repository, provider,
    hostedProvider, hostedEnabled: config.hostedEnabled,
    hostedInitEnabled: config.hostedInitEnabled, hostedUrls: config.hostedUrls,
    enabled: config.enabled, dispatchEnabled: config.dispatchEnabled,
    merchantTerminal: config.terminalNumber });
  return {
    enabled: config.enabled, dispatchEnabled: config.dispatchEnabled,
    hostedEnabled: config.hostedEnabled, hostedInitEnabled: config.hostedInitEnabled,
    workerMaxMs: config.workerMaxMs, database, repository, workflow,
    async authenticate(token) {
      const { data: { user } = {}, error } = await authClient.auth.getUser(token);
      if (error || !user) return null;
      const { data, error: profileError } = await authClient.from('profiles')
        .select('role').eq('id', user.id).single();
      if (profileError || !data) return null;
      const role = data.role === 'קופאי' ? 'cashier' : data.role;
      return { id: user.id, role };
    },
  };
}
