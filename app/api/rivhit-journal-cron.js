import { createRivhitJournalCron } from '../server/rivhit-journal/cron.js';

export default { fetch: createRivhitJournalCron(process.env) };
