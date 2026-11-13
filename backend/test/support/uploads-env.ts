import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Import this before anything that loads AppModule. The app reads UPLOADS_DIR
 * when it loads, and the tests must write into a throwaway folder, not into
 * backend/uploads.
 */
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), 'travel-uploads-'));
