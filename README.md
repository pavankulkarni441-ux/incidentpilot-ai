# 🚨 IncidentPilot

### AI-Powered On-Call Incident Investigation & Response Agent

## 1. Project Overview

IncidentPilot is an AI-powered incident response assistant designed to help engineering and SRE teams investigate production incidents faster.

When an alert occurs, IncidentPilot gathers available metrics, logs and distributed traces, correlates evidence, identifies probable root causes and proposes remediation actions.

It reduces manual investigation effort while keeping engineers in control through human approval.

**Our goal:** Reduce the time engineers spend investigating incidents and help them make faster, evidence-based decisions.

## 2. Problem Statement

When production incidents occur, engineers often need to investigate multiple monitoring systems, application logs, distributed traces and recent deployments separately.

This creates several challenges:

- Slow incident investigation.
- Difficulty identifying root causes.
- Fragmented observability information.
- Delayed communication between engineering teams.
- Risk of incorrect or unsafe remediation.

IncidentPilot brings available incident evidence together and assists engineers throughout the investigation process.

## 3. Key Features

- **AI-Assisted Investigation:** Analyzes available incident evidence and generates a diagnosis.
- **Evidence Correlation:** Combines metrics, logs and traces into a chronological investigation timeline.
- **Root-Cause Analysis:** Identifies probable causes with supporting evidence and confidence explanations.
- **Remediation Suggestions:** Proposes actions to mitigate incidents.
- **Human-in-the-Loop Approval:** Engineers must authorize proposed remediation.
- **Slack Integration:** Includes functionality for incident notifications and approval workflows; live workspace configuration is pending.
- **Audit Trail:** Records approval and rejection decisions.
- **Simulation-Only Execution:** Demonstrates remediation without executing real infrastructure commands.

## 4. How It Works

1. **Incident Detection:** An incident is declared or received.
2. **Evidence Collection:** Available metrics, logs and traces are collected.
3. **Evidence Correlation:** Related events are organized into a unified timeline.
4. **AI Investigation:** The diagnosis workflow analyzes the available evidence.
5. **Root-Cause Hypothesis:** Probable causes and supporting evidence are presented.
6. **Remediation Proposal:** The system suggests a potential corrective action.
7. **Human Approval:** An authorized engineer approves or rejects the proposal.
8. **Audit & Verification:** The decision is recorded and the simulated outcome is displayed.

## 5. Technology Stack

| Technology    | Purpose                                                    |
| ------------- | ---------------------------------------------------------- |
| React         | Frontend interface                                         |
| TypeScript    | Type-safe application development                          |
| Node.js       | Backend runtime                                            |
| Express.js    | API and workflow orchestration                             |
| Claude API    | Intended AI diagnosis provider                             |
| Gemini        | AI fallback provider                                       |
| Slack API     | Incident notifications and approval workflows              |
| Prometheus    | Metrics provider integration                               |
| Grafana       | Potential future monitoring visualization integration      |
| OpenTelemetry | Potential future instrumentation and telemetry integration |
| Firestore     | Persistent storage implementation                          |
| Vite          | Frontend build tooling                                     |

**Integration status:** Prometheus, logs and traces currently support mock providers and configurable external HTTP providers. Grafana and OpenTelemetry are not yet verified as connected integrations. Claude live inference and Slack workspace posting also require configuration and testing.

## 6. System Architecture

```text
              Engineering Team
                     |
                     v
              React Dashboard
                     |
                     v
             Node.js + Express
                     |
          Incident Investigation
                     |
          +----------+----------+
          |          |          |
          v          v          v
       Metrics      Logs      Traces
          |          |          |
          +----------+----------+
                     |
                     v
             Evidence Correlation
                     |
                     v
              AI Diagnosis
                     |
                     v
           Remediation Proposal
                     |
                     v
             Human Approval
                     |
                     v
          Simulated Remediation
                     |
                     v
                Audit Trail
                     |
                     v
              Slack Notification
              (when configured)
```

## 7. Installation and Setup

### Prerequisites

- Node.js and npm installed.
- Git installed.
- Access to the project repository.
- API credentials if enabling external AI services.

### Clone the repository

```bash
git clone <https://github.com/pavankulkarni441-ux/incidentpilot-ai>
cd IncidentPilot
```

### Install dependencies

```bash
npm install
```

### Configure environment variables

Create a `.env` file in the appropriate project root.

Configure the variables described in the next section.

### Start the application

Use the development scripts defined in `package.json`.

For a typical Vite development setup:

```bash
npm run dev
```

Run the backend using the configured server script if it runs separately.

## 8. Environment Variables

Never commit actual API keys, signing secrets or credentials to GitHub.

| Variable                | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `ANTHROPIC_API_KEY`     | Claude API authentication                          |
| `WORKFLOW_STORE`        | Workflow persistence mode: `memory` or `firestore` |
| `METRICS_PROVIDER`      | Metrics provider selection                         |
| `PROMETHEUS_URL`        | External Prometheus endpoint                       |
| `LOG_PROVIDER`          | Structured log provider selection                  |
| `LOG_SOURCE_URL`        | External log source endpoint                       |
| `TRACE_PROVIDER`        | Trace provider selection                           |
| `TRACE_SOURCE_URL`      | External trace source endpoint                     |
| `SLACK_BOT_TOKEN`       | Slack bot authentication                           |
| `SLACK_SIGNING_SECRET`  | Slack request signature verification               |
| `SLACK_CHANNEL_ID`      | Destination Slack channel                          |
| `AUTHORIZED_COMMANDERS` | Authorized incident commanders                     |

For a local demo, use mock providers and memory storage.

Example:

```env
WORKFLOW_STORE=memory
METRICS_PROVIDER=mock
LOG_PROVIDER=mock
```

Keep secrets in environment variables or a secure secrets manager. Never expose them in frontend code or commit them to version control.

## 9. Safety and Reliability

IncidentPilot is designed with human oversight and safety controls.

- Authorized commander validation.
- Mandatory human approval.
- Approval expiration.
- Single-use approval decisions.
- Incident/action binding.
- Audit logging.
- Simulation-only remediation.
- No automatic shell or Kubernetes execution.
- Clear distinction between simulated, live and unavailable evidence.

## 10. Future Scope

- Complete live Slack workspace integration.
- Enable and evaluate live Claude diagnosis.
- Integrate production Prometheus, log and trace sources.
- Add OpenTelemetry-based instrumentation and collection.
- Explore Grafana dashboard integration.
- Complete Cloud Run and Firestore deployment.
- Improve AI diagnosis accuracy through prompt optimization and evaluation.
- Add incident trend analysis and historical incident learning.
- Develop richer remediation verification and reporting.

## 11. Project Status

**Current status: Pitchathon-ready demo in memory/mock mode.**

The existing implementation has passed reported automated tests, TypeScript checks and production builds.

Live external integrations remain subject to configuration and independent verification.

---

**IncidentPilot — Investigate Faster. Mitigate Smarter. Keep Engineers in Control.**
