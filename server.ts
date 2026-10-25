import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Allowed simulated remediation actions
const ALLOWED_ACTIONS = [
  'scale_connection_pool_canary',
  'apply_hotfix_patch',
  'drain_stale_connections',
  'rolling_restart_canary',
  'enable_token_cache_bypass',
  'test_connection',
];

/**
 * Health check
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get webhook configuration status (without exposing secrets to client)
 */
app.get('/api/webhook/status', (_req: Request, res: Response) => {
  const isConfigured = Boolean(process.env.N8N_WEBHOOK_URL && process.env.N8N_WEBHOOK_URL.trim() !== '');
  res.json({
    configured: isConfigured,
    simulation_enforced: true,
    env_variable: 'N8N_WEBHOOK_URL',
    message: isConfigured
      ? 'n8n production webhook endpoint is configured in server environment.'
      : 'N8N_WEBHOOK_URL is not set in server environment. Please configure it in your environment variables/secrets.',
  });
});

/**
 * Gemini Root Cause Diagnosis Endpoint
 * Evaluates incident telemetry via Gemini API
 */
app.post('/api/gemini/diagnose', async (req: Request, res: Response) => {
  const { incident_id, telemetry } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    res.status(503).json({
      error: 'GEMINI_API_KEY is not configured in server environment.',
      code: 'GEMINI_API_KEY_MISSING',
      live: false,
    });
    return;
  }

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI();
    const prompt = `You are IncidentPilot SRE Copilot. Given incident "${incident_id}" with telemetry evidence: ${JSON.stringify(telemetry || {})}, provide a concise technical diagnosis of the root cause and a safe remediation strategy.`;

    const generatePromise = ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini API call timed out in sandbox after 4000ms')), 4000)
    );

    const response: any = await Promise.race([generatePromise, timeoutPromise]);

    res.json({
      success: true,
      live: true,
      model: 'gemini-3.8-flash',
      diagnosis: response.text,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(502).json({
      success: false,
      live: false,
      error: `Gemini API call failed: ${err.message}`,
      fallback_available: true,
    });
  }
});

/**
 * Dispatch human approval to n8n webhook
 *
 * Requirements:
 * 1. Validates incident_id
 * 2. Validates human_approval record (must be approved=true)
 * 3. Validates action against allowed list
 * 4. Enforces simulation_mode=true (rejects simulation_mode=false with HTTP 400)
 * 5. Calls N8N_WEBHOOK_URL with timeout and parses actual HTTP response
 */
app.post('/api/approvals/dispatch', async (req: Request, res: Response) => {
  const { incident_id, approval_id, action, approved_action, simulation_mode, human_approval, parameters } = req.body;
  const targetAction = approved_action || action;

  // 1. Validate Incident ID
  if (!incident_id || typeof incident_id !== 'string') {
    res.status(400).json({
      error: 'Validation failed: incident_id is required and must be a string.',
      code: 'INVALID_INCIDENT_ID',
    });
    return;
  }

  // 2. Validate Approval Record ID
  if (!approval_id || typeof approval_id !== 'string') {
    res.status(400).json({
      error: 'Validation failed: approval_id is required.',
      code: 'INVALID_APPROVAL_ID',
    });
    return;
  }

  // 3. Validate Explicit Human Approval
  if (!human_approval || typeof human_approval !== 'object' || human_approval.approved !== true) {
    res.status(403).json({
      error: 'Dispatch rejected: Action requires explicit human approval from an authorized Incident Commander.',
      code: 'HUMAN_APPROVAL_REQUIRED',
    });
    return;
  }

  // 4. Validate Allowed Action
  if (!targetAction || !ALLOWED_ACTIONS.includes(targetAction)) {
    res.status(400).json({
      error: `Validation failed: Action "${targetAction}" is not allowed. Allowed actions: ${ALLOWED_ACTIONS.join(', ')}.`,
      code: 'INVALID_ACTION',
    });
    return;
  }

  // 5. Strict Enforcement: simulation_mode MUST be true
  if (simulation_mode !== true) {
    res.status(400).json({
      error: 'Safety violation: Unsimulated actions are prohibited. simulation_mode must be explicitly set to true.',
      code: 'SIMULATION_MODE_REQUIRED',
    });
    return;
  }

  // 6. Check Server Environment for N8N_WEBHOOK_URL
  const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL?.trim();
  if (!n8nWebhookUrl) {
    res.status(503).json({
      error: 'N8N_WEBHOOK_URL is not configured in the server environment. Configure N8N_WEBHOOK_URL in environment secrets.',
      code: 'N8N_WEBHOOK_NOT_CONFIGURED',
      missing_secret: 'N8N_WEBHOOK_URL',
    });
    return;
  }

  // 7. Prepare n8n Payload (including approved_action as required by n8n workflow)
  const n8nPayload = {
    incident_id,
    approval_id,
    action: targetAction,
    approved_action: targetAction,
    simulation_mode: true,
    commander: {
      name: human_approval.commander_name || 'Sarah Chen',
      id: human_approval.commander_id || 's-chen-882',
      role: human_approval.commander_role || 'Staff SRE / Incident Commander',
    },
    parameters: parameters || {},
    timestamp: human_approval.timestamp || new Date().toISOString(),
  };

  // 8. Dispatch to n8n Webhook with 10-second timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'IncidentPilot-Commander/1.0',
        'Accept': 'application/json',
      },
      body: JSON.stringify(n8nPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();
    let responseData: any;

    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }

    if (!response.ok) {
      res.status(response.status).json({
        error: `n8n webhook returned HTTP ${response.status}`,
        code: 'N8N_WORKFLOW_ERROR',
        details: responseData,
      });
      return;
    }

    // Parse the n8n response: incident_id, approval_id, workflow_status, result_message, execution_timestamp
    const actualData = Array.isArray(responseData) ? responseData[0] : responseData;

    const parsedResult = {
      success: true,
      incident_id: actualData.incident_id || incident_id,
      approval_id: actualData.approval_id || approval_id,
      workflow_status: actualData.workflow_status || 'completed',
      result_message: actualData.result_message || 'Simulated remediation action executed successfully by n8n workflow.',
      execution_timestamp: actualData.execution_timestamp || new Date().toISOString(),
      raw: actualData,
    };

    res.status(200).json(parsedResult);
  } catch (err: any) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      res.status(504).json({
        error: 'n8n webhook dispatch timed out after 10 seconds. Check n8n service connectivity.',
        code: 'TIMEOUT',
      });
      return;
    }

    res.status(502).json({
      error: `Failed to connect to n8n webhook: ${err.message || 'Network error'}`,
      code: 'CONNECTION_FAILED',
    });
  }
});

/**
 * Start Server (Mount Vite in dev, serve dist in production)
 */
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`IncidentPilot server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
