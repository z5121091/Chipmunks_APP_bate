const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const requireServer = createRequire(path.join(__dirname, '../server/package.json'));
const express = requireServer('express');
const root = path.resolve(__dirname, '../dist/expo57-web');
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Export the Web build first');
const app = express();
app.use(express.static(root));
app.use((req, res) => {
  if (req.method === 'GET' && req.accepts('html')) return res.sendFile(path.join(root, 'index.html'));
  res.sendStatus(404);
});
const port = Number(process.env.PREVIEW_PORT || 19018);
app.listen(port, '127.0.0.1', () => console.log(`Built Web preview: http://127.0.0.1:${port}`));
