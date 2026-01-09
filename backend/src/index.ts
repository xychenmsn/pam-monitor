import express from 'express';
import cors from 'cors';
import * as cloudwatch from './services/cloudwatch.js';

const app = express();
const PORT = process.env.PORT || 3001;

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
                        error.name === 'InvalidAccessKeyId' ||
                        error.name === 'SignatureDoesNotMatch' ||
                        error.code === 'ExpiredToken' ||
                        error.code === 'Unauthorized' ||
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
 * GET /api/logs/latest?app=pamapiqa-worker&env=qa&limit=500
 * Fetch latest logs (most recent first, no time filter)
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
                        error.name === 'UnauthorizedException' ||
                        error.name === 'InvalidAccessKeyId' ||
                        error.name === 'SignatureDoesNotMatch' ||
                        error.code === 'ExpiredToken' ||
                        error.code === 'Unauthorized' ||
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
 * GET /api/logs/older?app=pamapiqa-worker&env=qa&olderThan=1234567890&limit=500
 * Fetch logs older than a timestamp (for background loading)
 */
app.get('/api/logs/older', async (req, res) => {
  try {
    const { app, env = 'qa', olderThan, limit = '500' } = req.query;

    if (!app || typeof app !== 'string') {
      return res.status(400).json({ error: 'app parameter is required' });
    }

    if (!olderThan) {
      return res.status(400).json({ error: 'olderThan parameter is required' });
    }

    const logs = await cloudwatch.fetchOlderLogs(
      env === 'dev' ? 'dev' : 'qa',
      app,
      Number(olderThan),
      Number(limit)
    );

    res.json({ logs });
  } catch (error: any) {
    console.error('Error fetching older logs:', error);
    const isAuthError = error.name === 'ExpiredTokenException' ||
                        error.name === 'UnauthorizedException' ||
                        error.name === 'InvalidAccessKeyId' ||
                        error.name === 'SignatureDoesNotMatch' ||
                        error.code === 'ExpiredToken' ||
                        error.code === 'Unauthorized' ||
                        error.message?.includes('security token') ||
                        error.message?.includes('credentials');
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'AWS credentials expired' : 'Failed to fetch older logs',
      message: error instanceof Error ? error.message : 'Unknown error',
      requiresAuth: isAuthError,
    });
  }
});

/**
 * GET /api/logs/newer?app=pamapiqa-worker&env=qa&newerThan=1234567890
 * Fetch logs newer than a timestamp (for polling)
 */
app.get('/api/logs/newer', async (req, res) => {
  try {
    const { app, env = 'qa', newerThan } = req.query;

    if (!app || typeof app !== 'string') {
      return res.status(400).json({ error: 'app parameter is required' });
    }

    if (!newerThan) {
      return res.status(400).json({ error: 'newerThan parameter is required' });
    }

    const logs = await cloudwatch.fetchNewLogs(
      env === 'dev' ? 'dev' : 'qa',
      app,
      Number(newerThan)
    );

    res.json({ logs });
  } catch (error: any) {
    console.error('Error fetching newer logs:', error);
    const isAuthError = error.name === 'ExpiredTokenException' ||
                        error.name === 'UnauthorizedException' ||
                        error.name === 'InvalidAccessKeyId' ||
                        error.name === 'SignatureDoesNotMatch' ||
                        error.code === 'ExpiredToken' ||
                        error.code === 'Unauthorized' ||
                        error.message?.includes('security token') ||
                        error.message?.includes('credentials');
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'AWS credentials expired' : 'Failed to fetch newer logs',
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
  console.log(`   GET  /api/logs/latest?app=xxx&env=qa&limit=500`);
  console.log(`   GET  /api/logs/older?app=xxx&env=qa&olderThan=timestamp&limit=500`);
  console.log(`   GET  /api/logs/newer?app=xxx&env=qa&newerThan=timestamp`);
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
