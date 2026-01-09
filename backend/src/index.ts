import express from 'express';
import cors from 'cors';
import * as cloudwatch from './services/cloudwatch.js';

const app = express();
const PORT = process.env.PORT || 31191;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /api/apps?env=qa|dev
 * Get list of available apps
 */
app.get('/api/apps', async (req, res) => {
  try {
    const env = (req.query.env as string) === 'dev' ? 'dev' : 'qa';
    const apps = await cloudwatch.listApps(env);
    res.json(apps);
  } catch (error: any) {
    console.error('Error fetching apps:', error);
    const isAuthError = error.name === 'ExpiredTokenException' ||
      error.name === 'UnauthorizedException' ||
      error.message?.includes('security token') ||
      error.message?.includes('credentials');
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'AWS credentials expired' : 'Failed to fetch apps',
      message: error instanceof Error ? error.message : 'Unknown error',
      requiresAuth: isAuthError,
    });
  }
});

/**
 * GET /api/streams?app=pamapiqa-worker&env=qa
 * Get list of log streams sorted by recency (most recent first)
 */
app.get('/api/streams', async (req, res) => {
  try {
    const { app, env = 'qa' } = req.query;
    if (!app || typeof app !== 'string') {
      return res.status(400).json({ error: 'app parameter is required' });
    }
    const streams = await cloudwatch.getStreamList(
      env === 'dev' ? 'dev' : 'qa',
      app
    );
    res.json({ streams });
  } catch (error: any) {
    console.error('Error fetching streams:', error);
    const isAuthError = error.name === 'ExpiredTokenException' ||
      error.message?.includes('security token') ||
      error.message?.includes('credentials');
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'AWS credentials expired' : 'Failed to fetch streams',
      message: error instanceof Error ? error.message : 'Unknown error',
      requiresAuth: isAuthError,
    });
  }
});

/**
 * GET /api/logs/latest?app=pamapiqa-worker&env=qa&limit=500
 * Initial load: Get logs from last 24 hours
 */
app.get('/api/logs/latest', async (req, res) => {
  try {
    const { app, env = 'qa', limit = '500' } = req.query;
    if (!app || typeof app !== 'string') {
      return res.status(400).json({ error: 'app parameter is required' });
    }
    const logs = await cloudwatch.fetchLatestLogs(
      env === 'dev' ? 'dev' : 'qa',
      app,
      Number(limit)
    );
    res.json({ logs });
  } catch (error: any) {
    console.error('Error fetching latest logs:', error);
    const isAuthError = error.name === 'ExpiredTokenException' ||
      error.message?.includes('security token') ||
      error.message?.includes('credentials');
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'AWS credentials expired' : 'Failed to fetch logs',
      message: error instanceof Error ? error.message : 'Unknown error',
      requiresAuth: isAuthError,
    });
  }
});

/**
 * POST /api/logs/stream
 * Get logs from a specific stream
 * Body: { streamName, env, startTime?, limit? }
 */
app.post('/api/logs/stream', async (req, res) => {
  try {
    const { streamName, env = 'qa', startTime, limit = 1000 } = req.body;
    if (!streamName || typeof streamName !== 'string') {
      return res.status(400).json({ error: 'streamName parameter is required' });
    }
    const logs = await cloudwatch.fetchLogsFromStream(
      env === 'dev' ? 'dev' : 'qa',
      streamName,
      startTime ? Number(startTime) : undefined,
      Number(limit)
    );
    res.json({ logs });
  } catch (error: any) {
    console.error('Error fetching stream logs:', error);
    const isAuthError = error.name === 'ExpiredTokenException' ||
      error.message?.includes('security token') ||
      error.message?.includes('credentials');
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'AWS credentials expired' : 'Failed to fetch stream logs',
      message: error instanceof Error ? error.message : 'Unknown error',
      requiresAuth: isAuthError,
    });
  }
});

/**
 * POST /api/logs/poll
 * Poll specific streams for new logs (efficient)
 * Body: { env, streams: [{ streamName, startTime }] }
 */
app.post('/api/logs/poll', async (req, res) => {
  try {
    const { env = 'qa', streams } = req.body;
    if (!Array.isArray(streams)) {
      return res.status(400).json({ error: 'streams must be an array' });
    }
    const logs = await cloudwatch.fetchNewLogsFromStreams(
      env === 'dev' ? 'dev' : 'qa',
      streams
    );
    res.json({ logs });
  } catch (error: any) {
    console.error('Error polling logs:', error);
    const isAuthError = error.name === 'ExpiredTokenException' ||
      error.message?.includes('security token') ||
      error.message?.includes('credentials');
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'AWS credentials expired' : 'Failed to poll logs',
      message: error instanceof Error ? error.message : 'Unknown error',
      requiresAuth: isAuthError,
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 PAM Monitor API server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📝 Stateless API endpoints:`);
  console.log(`   GET  /api/apps?env=qa|dev`);
  console.log(`   GET  /api/streams?app=xxx&env=qa`);
  console.log(`   GET  /api/logs/latest?app=xxx&env=qa&limit=500`);
  console.log(`   POST /api/logs/stream`);
  console.log(`   POST /api/logs/poll`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
