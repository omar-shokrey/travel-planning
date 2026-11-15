process.env.MONGODB_URI = 'mongodb://localhost:27017/travel-planning-test';

process.env.UPLOADS_DIR = require('node:fs').mkdtempSync(
  require('node:path').join(require('node:os').tmpdir(), 'travel-uploads-e2e-'),
);
