const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { PORT } = require('./src/config');
const { verifyToken } = require('./src/auth');

// Route handlers
const { handleAuthRoutes } = require('./src/routes/authRoutes');
const { handleParentRoutes } = require('./src/routes/parentRoutes');
const { handleAdminRoutes } = require('./src/routes/adminRoutes');
const { handleStudentRoutes } = require('./src/routes/studentRoutes');
const { handleSuperAdminRoutes } = require('./src/routes/superAdminRoutes');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let safePath = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Access Denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA client-side routing if requested
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('404 Not Found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  // Global CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Extract Auth Token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    req.user = verifyToken(token);
  } else {
    req.user = null;
  }

  // Parse Body for non-GET/HEAD
  let bodyBuffer = '';
  req.on('data', chunk => {
    bodyBuffer += chunk;
    if (bodyBuffer.length > 5 * 1024 * 1024) { // 5MB limit
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload too large' }));
      req.destroy();
    }
  });

  req.on('end', () => {
    let body = {};
    if (bodyBuffer) {
      try {
        body = JSON.parse(bodyBuffer);
      } catch (e) {
        body = {};
      }
    }

    // Check if API Route
    if (parsedUrl.pathname.startsWith('/api/')) {
      try {
        if (parsedUrl.pathname.startsWith('/api/auth/')) {
          if (handleAuthRoutes(req, res, parsedUrl, body)) return;
        }

        if (parsedUrl.pathname.startsWith('/api/parent/')) {
          if (handleParentRoutes(req, res, parsedUrl, body)) return;
        }

        if (parsedUrl.pathname.startsWith('/api/admin/')) {
          if (handleAdminRoutes(req, res, parsedUrl, body)) return;
        }

        if (parsedUrl.pathname.startsWith('/api/student/')) {
          if (handleStudentRoutes(req, res, parsedUrl, body)) return;
        }

        if (parsedUrl.pathname.startsWith('/api/super-admin/')) {
          if (handleSuperAdminRoutes(req, res, parsedUrl, body)) return;
        }

        // If no API matched
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `API route not found: ${parsedUrl.pathname}` }));
      } catch (err) {
        console.error('API Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Internal server error: ' + err.message }));
      }
    }

    // Serve Static UI Files
    serveStatic(req, res, parsedUrl.pathname);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🕌 Islamic Daily Prayer & Routine Tracker Server v2.0`);
    console.log(`🌐 Server running at: http://localhost:${PORT}`);
    console.log(`📱 Parent-Controlled Tracking System Active`);
    console.log(`=======================================================`);
  });
}

module.exports = { server };
