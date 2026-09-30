// Test-only entrypoint for unchanged upstream personal-note regression coverage.
// Never use this entrypoint in a deployment; wrangler.toml points to src/index.ts.
import { createApp } from '../../src/application';
const app = createApp(false);
export default { fetch: app.fetch };
