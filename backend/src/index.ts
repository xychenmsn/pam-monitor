import express from 'express';
import cors from 'cors';
import * as cloudwatch from './services/cloudwatch.js';
import { getDashboardStatus } from './services/dashboard.js';
import { getAppDetails, restartService } from './services/details.js';
import { getAppSecrets } from './services/secrets.js';
import { getSchedulerRule, updateSchedulerRule, triggerScheduledTask } from './services/scheduler.js';

const app = express();
const port = process.env.PORT || 31191;
const SESSION_ID = Math.random().toString(36).substring(7);
console.log(`[INIT] Server Session ID: ${SESSION_ID}`);

// Middleware
app.use(cors());
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /api/auth/aws/status
 * Check if AWS credentials are valid
 */
app.get('/api/auth/aws/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const isValid = await cloudwatch.checkAuth();
  if (isValid) {
    res.json({ authenticated: true, sessionId: SESSION_ID });
  } else {
    res.status(401).json({
      authenticated: false,
      error: 'AWS credentials expired',
      requiresAuth: true,
      sessionId: SESSION_ID
    });
  }
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
 * GET /api/dashboard/status?env=qa
 * Get dashboard status for all apps (optimized global scan)
 */
app.get('/api/dashboard/status', async (req, res) => {
  try {
    const env = (req.query.env as string) === 'dev' ? 'dev' : 'qa';
    const status = await getDashboardStatus(env);
    res.json(status);
  } catch (error: any) {
    console.error('Error fetching dashboard status:', error);
    const isAuthError = error.name === 'ExpiredTokenException' ||
      error.name === 'UnauthorizedException' ||
      error.message?.includes('security token') ||
      error.message?.includes('credentials');
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'AWS credentials expired' : 'Failed to fetch status',
      message: error instanceof Error ? error.message : 'Unknown error',
      requiresAuth: isAuthError,
    });
  }
});

app.get('/api/apps/:appName/details', async (req, res) => {
  const env = (req.query.env as string) === 'dev' ? 'dev' : 'qa';
  const appName = req.params.appName;
  try {
    const result = await getAppDetails(appName, env);
    if (!result) {
      res.status(404).json({ error: 'App not found details' });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch details' });
  }
});

/**
 * GET /api/apps/:appName/secrets?env=qa
 * Fetch secrets from AWS Secrets Manager for the given app
 */
app.get('/api/apps/:appName/secrets', async (req, res) => {
  const env = (req.query.env as string) === 'dev' ? 'dev' : 'qa';
  const appName = req.params.appName;
  try {
    const result = await getAppSecrets(appName, env);
    res.json(result);
  } catch (err: any) {
    console.error('Error fetching secrets:', err);
    const isAuthError =
      err.name === 'ExpiredTokenException' ||
      err.name === 'UnauthorizedException' ||
      (err.message || '').includes('security token') ||
      (err.message || '').includes('expired');
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'AWS credentials expired' : 'Failed to fetch secrets',
      message: err.message || 'Unknown error',
      requiresAuth: isAuthError,
    });
  }
});

app.post('/api/apps/:appName/restart', async (req, res) => {
  const env = (req.query.env as string) === 'dev' ? 'dev' : 'qa';
  const appName = req.params.appName;
  try {
    const success = await restartService(appName, env);
    if (success) {
      res.json({ message: `Successfully triggered restart for ${appName}` });
    } else {
      res.status(500).json({ error: `Failed to trigger restart for ${appName}` });
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to restart' });
  }
});

/**
 * GET /api/scheduler/:ruleName?env=qa
 * Get CloudWatch Events rule info and targets for a scheduled task
 */
app.get('/api/scheduler/:ruleName', async (req, res) => {
  const env = (req.query.env as string) === 'dev' ? 'dev' : 'qa';
  const { ruleName } = req.params;
  try {
    const rule = await getSchedulerRule(ruleName, env);
    res.json(rule);
  } catch (err: any) {
    console.error('Error fetching scheduler rule:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch scheduler rule' });
  }
});

/**
 * PUT /api/scheduler/:ruleName?env=qa
 * Update the schedule expression for a CloudWatch Events rule
 * Body: { scheduleExpression: string }
 */
app.put('/api/scheduler/:ruleName', async (req, res) => {
  const env = (req.query.env as string) === 'dev' ? 'dev' : 'qa';
  const { ruleName } = req.params;
  const { scheduleExpression } = req.body;
  if (!scheduleExpression || typeof scheduleExpression !== 'string') {
    return res.status(400).json({ error: 'scheduleExpression is required' });
  }
  try {
    const result = await updateSchedulerRule(ruleName, scheduleExpression, env);
    res.json(result);
  } catch (err: any) {
    console.error('Error updating scheduler rule:', err);
    res.status(500).json({ error: err.message || 'Failed to update scheduler rule' });
  }
});

/**
 * POST /api/apps/:appName/trigger?env=qa
 * Manually trigger a scheduled task (Run Now), bypassing the schedule
 */
app.post('/api/apps/:appName/trigger', async (req, res) => {
  const env = (req.query.env as string) === 'dev' ? 'dev' : 'qa';
  const { appName } = req.params;
  try {
    const result = await triggerScheduledTask(appName, env);
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err: any) {
    console.error('Error triggering scheduled task:', err);
    res.status(500).json({ error: err.message || 'Failed to trigger task' });
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
    const { app, env = 'qa', limit = '500', startTime } = req.query;
    if (!app || typeof app !== 'string') {
      return res.status(400).json({ error: 'app parameter is required' });
    }
    const logs = await cloudwatch.fetchLatestLogs(
      env === 'dev' ? 'dev' : 'qa',
      app,
      Number(limit),
      startTime ? Number(startTime) : undefined
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
    const { streamName, env = 'qa', startTime, limit } = req.body;
    if (!streamName || typeof streamName !== 'string') {
      return res.status(400).json({ error: 'streamName parameter is required' });
    }
    const logs = await cloudwatch.fetchLogsFromStream(
      env === 'dev' ? 'dev' : 'qa',
      streamName,
      startTime ? Number(startTime) : undefined,
      limit ? Number(limit) : undefined
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

// ... (previous endpoints)


/**
 * GET /api/logs/streams
 * Get list of log streams for an app (optimized to find latest)
 */
app.get('/api/logs/streams', async (req, res) => {
  try {
    const { app, env = 'qa' } = req.query;
    if (!app || typeof app !== 'string') {
      return res.status(400).json({ error: 'App name required' });
    }
    const streams = await cloudwatch.getStreamList(env as 'qa' | 'dev', app);
    res.json(streams);
  } catch (error: any) {
    const isAuthError = error.name === 'ExpiredTokenException' ||
      error.message?.includes('security token') ||
      error.message?.includes('credentials');
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'AWS credentials expired' : 'Failed to fetch streams',
      message: error instanceof Error ? error.message : 'Unknown error',
      requiresAuth: isAuthError
    });
  }
});

/**
 * POST /api/logs/stream/events
 * Get logs using native GetLogEvents (better for pagination)
 * Body: { streamName, env, limit?, startFromHead?, nextToken? }
 */
app.post('/api/logs/stream/events', async (req, res) => {
  try {
    const { streamName, env = 'qa', limit = 1000, startFromHead = false, nextToken } = req.body;

    // Debug logging
    console.log(`[POST /stream/events] app=${streamName} startFromHead=${startFromHead} (${typeof startFromHead}) nextToken=${nextToken ? 'YES' : 'NO'}`);

    if (!streamName || typeof streamName !== 'string') {
      return res.status(400).json({ error: 'streamName parameter is required' });
    }

    // Ensure strict boolean
    const isStartFromHead = startFromHead === true || startFromHead === 'true';

    const result = await cloudwatch.getLogEvents(
      env === 'dev' ? 'dev' : 'qa',
      streamName,
      Number(limit),
      isStartFromHead,
      nextToken
    );
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching log events:', error);
    const isAuthError = error.name === 'ExpiredTokenException' ||
      error.message?.includes('security token') ||
      error.message?.includes('credentials');
    res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'AWS credentials expired' : 'Failed to fetch log events',
      message: error instanceof Error ? error.message : 'Unknown error',
      requiresAuth: isAuthError,
    });
  }
});



/**
 * GET /api/logs/live
 * Server-Sent Events (SSE) endpoint for Live Tail
 */
app.get('/api/logs/live', async (req, res) => {
  const { app, env = 'qa' } = req.query;

  if (!app || typeof app !== 'string') {
    return res.status(400).json({ error: 'App name required' });
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send initial "connected" message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to Live Tail...' })}\n\n`);

  const cleanup = await cloudwatch.startLiveTail(
    env === 'dev' ? 'dev' : 'qa',
    app,
    (logs) => {
      // Send logs to client
      if (logs && logs.length > 0) {
        const payload = {
          type: 'logs',
          events: logs.map((l: any) => ({
            timestamp: l.timestamp,
            message: l.message,
            stream: l.logStreamName
          }))
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    },
    (err) => {
      console.error('Live Tail Error:', err);
      const errPayload = {
        type: 'error',
        message: err.message || 'Unknown error'
      };
      res.write(`data: ${JSON.stringify(errPayload)}\n\n`);
      // Do not close connection immediately, let client decide or retry
    },
    () => {
      console.log('Live Tail stream closed');
      res.end();
    }
  );

  // Clean up when client disconnects
  req.on('close', () => {
    console.log('Client disconnected, stopping Live Tail');
    cleanup();
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 PAM Monitor API server running on http://localhost:${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
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
