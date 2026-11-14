import { Firestore } from '@google-cloud/firestore';

export interface ServerAuditEvent {
  id: string;
  timestamp: string;
  actorType:
    | 'AI_AGENT'
    | 'CLAUDE_AGENT'
    | 'HUMAN_COMMANDER'
    | 'SYSTEM_PROBE'
    | 'N8N_WORKFLOW'
    | 'SLACK_NOTIFICATION'
    | 'SLACK_INTERACTION'
    | 'NODEJS_ORCHESTRATOR';
  actorName: string;
  action: string;
  details: string;
  verificationStatus: 'verified' | 'failed' | 'in_progress';
  created_at_ms?: number;
}

export interface ApprovalRecord {
  approval_id: string;
  incident_id: string;
  action: string;
  simulation_mode: true;
  binding_hash: string;
  diagnosis_source: 'claude_live' | 'demo_fallback';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  created_at: number;
  expires_at: number;
  decided_at?: string;
  decided_by?: { id: string; username?: string; name?: string };
  channel_id?: string;
  message_ts?: string;
}

export interface IncidentWorkflowState {
  workflow_id: string;
  incident_id: string;
  severity: string;
  service: string;
  phase:
    | 'investigating'
    | 'diagnosed'
    | 'awaiting_human_approval'
    | 'approved_simulated_remediated'
    | 'rejected'
    | 'failed';
  diagnosis_source?: 'claude_live' | 'demo_fallback';
  diagnosis?: any;
  approval_id?: string;
  proposed_action?: string;
  slack_notified: boolean;
  slack_status?: string;
  slack_message_ts?: string;
  simulation_mode: true;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  last_error?: string;
  remediation_result?: {
    workflow_status: string;
    result_message: string;
    execution_timestamp: string;
    approval_id: string;
    action: string;
    commander: { id: string; name: string; role?: string };
    simulation_mode: true;
  };
}

export interface ResolveApprovalInput {
  approvalId: string;
  incidentId?: string;
  action: string;
  expectedBindingHash: (incidentId: string, action: string) => string;
  providedBindingHash?: string;
  decision: 'approve' | 'reject';
  decidedBy: { id: string; username?: string; name?: string };
  decidedAt: string;
  nowMs: number;
  requireWorkflowExists?: boolean;
  buildRemediationResult?: (
    workflow: IncidentWorkflowState | null,
    record: ApprovalRecord
  ) => IncidentWorkflowState['remediation_result'];
}

export type ResolveApprovalResult =
  | {
      ok: true;
      outcome: 'APPROVED' | 'REJECTED';
      record: ApprovalRecord;
      workflow: IncidentWorkflowState | null;
    }
  | {
      ok: false;
      outcome:
        | 'APPROVAL_NOT_FOUND'
        | 'WORKFLOW_NOT_FOUND'
        | 'APPROVAL_MISMATCH'
        | 'DUPLICATE_APPROVAL'
        | 'APPROVAL_EXPIRED';
      record?: ApprovalRecord;
      workflow?: IncidentWorkflowState | null;
    };

export interface WorkflowStore {
  readonly mode: 'memory' | 'firestore';
  verifyConnectivity(): Promise<{ ok: true } | { ok: false; error: string }>;
  getWorkflow(incidentId: string): Promise<IncidentWorkflowState | null>;
  createWorkflowUnique(
    workflow: IncidentWorkflowState
  ): Promise<{ created: true; workflow: IncidentWorkflowState } | { created: false; existing: IncidentWorkflowState }>;
  saveWorkflow(workflow: IncidentWorkflowState): Promise<void>;
  countWorkflows(): Promise<number>;

  getApproval(approvalId: string): Promise<ApprovalRecord | null>;
  saveApproval(record: ApprovalRecord): Promise<void>;
  listApprovals(): Promise<ApprovalRecord[]>;
  resolveApprovalTransaction(input: ResolveApprovalInput): Promise<ResolveApprovalResult>;

  appendAuditEvent(event: ServerAuditEvent): Promise<ServerAuditEvent>;
  listAuditEvents(limit?: number): Promise<ServerAuditEvent[]>;
}

/**
 * Minimal subset of @google-cloud/firestore used by FirestoreStore.
 * Enables Cloud Run IAM Firestore usage in production and faithful transaction tests locally.
 */
export interface FirestoreDocSnapshotLike {
  exists: boolean;
  data(): any;
}

export interface FirestoreQuerySnapshotLike {
  docs: FirestoreDocSnapshotLike[];
  size: number;
}

export interface FirestoreDocRefLike {
  id: string;
  get(): Promise<FirestoreDocSnapshotLike>;
  set(data: any): Promise<any>;
}

export interface FirestoreQueryLike {
  orderBy(field: string, direction?: 'asc' | 'desc'): FirestoreQueryLike;
  limit(limit: number): FirestoreQueryLike;
  get(): Promise<FirestoreQuerySnapshotLike>;
}

export interface FirestoreCollectionLike extends FirestoreQueryLike {
  doc(id: string): FirestoreDocRefLike;
}

export interface FirestoreTransactionLike {
  get(ref: FirestoreDocRefLike): Promise<FirestoreDocSnapshotLike>;
  set(ref: FirestoreDocRefLike, data: any): any;
  update(ref: FirestoreDocRefLike, data: any): any;
}

export interface FirestoreClientLike {
  collection(name: string): FirestoreCollectionLike;
  runTransaction<T>(fn: (tx: FirestoreTransactionLike) => Promise<T>): Promise<T>;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

/**
 * In-memory WorkflowStore for local development and isolated automated tests.
 * Synchronous operations inside transaction methods preserve atomicity in Node.js.
 */
export class InMemoryStore implements WorkflowStore {
  public readonly mode = 'memory' as const;
  public readonly workflows: Map<string, IncidentWorkflowState>;
  public readonly approvals: Map<string, ApprovalRecord>;
  public readonly auditEvents: ServerAuditEvent[];
  private readonly maxAuditEvents: number;

  constructor(options?: {
    workflows?: Map<string, IncidentWorkflowState>;
    approvals?: Map<string, ApprovalRecord>;
    auditEvents?: ServerAuditEvent[];
    maxAuditEvents?: number;
  }) {
    this.workflows = options?.workflows ?? new Map<string, IncidentWorkflowState>();
    this.approvals = options?.approvals ?? new Map<string, ApprovalRecord>();
    this.auditEvents = options?.auditEvents ?? [];
    this.maxAuditEvents = options?.maxAuditEvents ?? 200;
  }

  async verifyConnectivity(): Promise<{ ok: true } | { ok: false; error: string }> {
    return { ok: true };
  }

  async getWorkflow(incidentId: string): Promise<IncidentWorkflowState | null> {
    return this.workflows.get(incidentId) ?? null;
  }

  async createWorkflowUnique(
    workflow: IncidentWorkflowState
  ): Promise<{ created: true; workflow: IncidentWorkflowState } | { created: false; existing: IncidentWorkflowState }> {
    const existing = this.workflows.get(workflow.incident_id);
    if (existing) {
      return { created: false, existing };
    }
    this.workflows.set(workflow.incident_id, workflow);
    return { created: true, workflow };
  }

  async saveWorkflow(workflow: IncidentWorkflowState): Promise<void> {
    this.workflows.set(workflow.incident_id, workflow);
  }

  async countWorkflows(): Promise<number> {
    return this.workflows.size;
  }

  async getApproval(approvalId: string): Promise<ApprovalRecord | null> {
    return this.approvals.get(approvalId) ?? null;
  }

  async saveApproval(record: ApprovalRecord): Promise<void> {
    this.approvals.set(record.approval_id, record);
  }

  async listApprovals(): Promise<ApprovalRecord[]> {
    return Array.from(this.approvals.values());
  }

  async resolveApprovalTransaction(input: ResolveApprovalInput): Promise<ResolveApprovalResult> {
    const record = this.approvals.get(input.approvalId);
    if (!record) {
      return { ok: false, outcome: 'APPROVAL_NOT_FOUND' };
    }

    const wf = this.workflows.get(record.incident_id) ?? null;
    if (input.requireWorkflowExists && (!wf || (input.incidentId && wf.incident_id !== input.incidentId))) {
      return { ok: false, outcome: 'WORKFLOW_NOT_FOUND', record };
    }

    const expectedHash = input.expectedBindingHash(record.incident_id, record.action);
    if (
      (input.incidentId && record.incident_id !== input.incidentId) ||
      record.action !== input.action ||
      (input.providedBindingHash && input.providedBindingHash !== expectedHash) ||
      record.binding_hash !== expectedHash
    ) {
      return { ok: false, outcome: 'APPROVAL_MISMATCH', record, workflow: wf };
    }

    if (record.status !== 'pending') {
      return { ok: false, outcome: 'DUPLICATE_APPROVAL', record, workflow: wf };
    }

    if (input.nowMs > record.expires_at) {
      record.status = 'expired';
      if (wf) {
        wf.phase = 'failed';
        wf.last_error = `Approval "${record.approval_id}" expired before commander decision.`;
        wf.updated_at = input.decidedAt;
      }
      return { ok: false, outcome: 'APPROVAL_EXPIRED', record, workflow: wf };
    }

    const commanderMeta = {
      id: input.decidedBy.id,
      ...(input.decidedBy.username ? { username: input.decidedBy.username } : {}),
      ...(input.decidedBy.name ? { name: input.decidedBy.name } : {}),
    };

    if (input.decision === 'reject') {
      record.status = 'rejected';
      record.decided_at = input.decidedAt;
      record.decided_by = commanderMeta;

      if (wf && (!wf.approval_id || wf.approval_id === record.approval_id)) {
        wf.phase = 'rejected';
        wf.updated_at = input.decidedAt;
        wf.completed_at = input.decidedAt;
      }

      return { ok: true, outcome: 'REJECTED', record, workflow: wf };
    }

    record.status = 'approved';
    record.decided_at = input.decidedAt;
    record.decided_by = commanderMeta;

    if (wf && (!wf.approval_id || wf.approval_id === record.approval_id)) {
      wf.phase = 'approved_simulated_remediated';
      wf.updated_at = input.decidedAt;
      wf.completed_at = input.decidedAt;
      if (input.buildRemediationResult) {
        wf.remediation_result = input.buildRemediationResult(wf, record);
      }
    }

    return { ok: true, outcome: 'APPROVED', record, workflow: wf };
  }

  async appendAuditEvent(event: ServerAuditEvent): Promise<ServerAuditEvent> {
    this.auditEvents.unshift(event);
    if (this.auditEvents.length > this.maxAuditEvents) {
      this.auditEvents.length = this.maxAuditEvents;
    }
    return event;
  }

  async listAuditEvents(limit = 200): Promise<ServerAuditEvent[]> {
    return this.auditEvents.slice(0, limit);
  }
}

/**
 * Google Cloud Firestore WorkflowStore for Cloud Run persistence.
 * Authenticates via Cloud Run service-account IAM (Application Default Credentials)
 * without any embedded keys or secrets.
 */
export class FirestoreStore implements WorkflowStore {
  public readonly mode = 'firestore' as const;
  private readonly db: FirestoreClientLike;
  private readonly workflowsColName: string;
  private readonly approvalsColName: string;
  private readonly auditColName: string;

  constructor(options?: {
    client?: FirestoreClientLike;
    projectId?: string;
    databaseId?: string;
    collectionPrefix?: string;
  }) {
    if (options?.client) {
      this.db = options.client;
    } else {
      const firestoreOptions: Record<string, any> = {
        ignoreUndefinedProperties: true,
      };
      const projectId = options?.projectId ?? process.env.GOOGLE_CLOUD_PROJECT?.trim();
      const databaseId = options?.databaseId ?? process.env.FIRESTORE_DATABASE_ID?.trim();
      if (projectId) firestoreOptions.projectId = projectId;
      if (databaseId) firestoreOptions.databaseId = databaseId;
      this.db = new Firestore(firestoreOptions) as unknown as FirestoreClientLike;
    }

    const prefix = options?.collectionPrefix ?? process.env.FIRESTORE_COLLECTION_PREFIX?.trim() ?? 'incidentpilot_';
    this.workflowsColName = `${prefix}workflows`;
    this.approvalsColName = `${prefix}approvals`;
    this.auditColName = `${prefix}audit_events`;
  }

  async verifyConnectivity(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.db.collection(this.workflowsColName).limit(1).get();
      return { ok: true };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Firestore connectivity check failed.',
      };
    }
  }

  async getWorkflow(incidentId: string): Promise<IncidentWorkflowState | null> {
    const snap = await this.db.collection(this.workflowsColName).doc(incidentId).get();
    return snap.exists ? (snap.data() as IncidentWorkflowState) : null;
  }

  async createWorkflowUnique(
    workflow: IncidentWorkflowState
  ): Promise<{ created: true; workflow: IncidentWorkflowState } | { created: false; existing: IncidentWorkflowState }> {
    const wfRef = this.db.collection(this.workflowsColName).doc(workflow.incident_id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(wfRef);
      if (snap.exists) {
        return { created: false as const, existing: snap.data() as IncidentWorkflowState };
      }
      const clean = stripUndefined(workflow);
      tx.set(wfRef, clean);
      return { created: true as const, workflow: clean };
    });
  }

  async saveWorkflow(workflow: IncidentWorkflowState): Promise<void> {
    await this.db.collection(this.workflowsColName).doc(workflow.incident_id).set(stripUndefined(workflow));
  }

  async countWorkflows(): Promise<number> {
    const col = this.db.collection(this.workflowsColName) as FirestoreCollectionLike & {
      count?: () => { get: () => Promise<{ data: () => { count: number } }> };
    };
    if (typeof col.count === 'function') {
      const aggSnap = await col.count().get();
      return aggSnap.data().count;
    }
    const snap = await col.get();
    return snap.size;
  }

  async getApproval(approvalId: string): Promise<ApprovalRecord | null> {
    const snap = await this.db.collection(this.approvalsColName).doc(approvalId).get();
    return snap.exists ? (snap.data() as ApprovalRecord) : null;
  }

  async saveApproval(record: ApprovalRecord): Promise<void> {
    await this.db.collection(this.approvalsColName).doc(record.approval_id).set(stripUndefined(record));
  }

  async listApprovals(): Promise<ApprovalRecord[]> {
    const snap = await this.db.collection(this.approvalsColName).orderBy('created_at', 'desc').limit(200).get();
    return snap.docs.map((d) => d.data() as ApprovalRecord);
  }

  async resolveApprovalTransaction(input: ResolveApprovalInput): Promise<ResolveApprovalResult> {
    const apprRef = this.db.collection(this.approvalsColName).doc(input.approvalId);

    return this.db.runTransaction(async (tx) => {
      // All reads MUST occur before any writes in Firestore transactions
      const apprSnap = await tx.get(apprRef);
      if (!apprSnap.exists) {
        return { ok: false, outcome: 'APPROVAL_NOT_FOUND' } as ResolveApprovalResult;
      }

      const record = { ...(apprSnap.data() as ApprovalRecord) };
      const wfRef = this.db.collection(this.workflowsColName).doc(record.incident_id);
      const wfSnap = await tx.get(wfRef);
      const wf = wfSnap.exists ? ({ ...(wfSnap.data() as IncidentWorkflowState) }) : null;

      if (input.requireWorkflowExists && (!wf || (input.incidentId && wf.incident_id !== input.incidentId))) {
        return { ok: false, outcome: 'WORKFLOW_NOT_FOUND', record } as ResolveApprovalResult;
      }

      const expectedHash = input.expectedBindingHash(record.incident_id, record.action);
      if (
        (input.incidentId && record.incident_id !== input.incidentId) ||
        record.action !== input.action ||
        (input.providedBindingHash && input.providedBindingHash !== expectedHash) ||
        record.binding_hash !== expectedHash
      ) {
        return { ok: false, outcome: 'APPROVAL_MISMATCH', record, workflow: wf } as ResolveApprovalResult;
      }

      if (record.status !== 'pending') {
        return { ok: false, outcome: 'DUPLICATE_APPROVAL', record, workflow: wf } as ResolveApprovalResult;
      }

      if (input.nowMs > record.expires_at) {
        record.status = 'expired';
        tx.update(apprRef, { status: 'expired' });
        if (wf) {
          wf.phase = 'failed';
          wf.last_error = `Approval "${record.approval_id}" expired before commander decision.`;
          wf.updated_at = input.decidedAt;
          tx.update(wfRef, {
            phase: wf.phase,
            last_error: wf.last_error,
            updated_at: wf.updated_at,
          });
        }
        return { ok: false, outcome: 'APPROVAL_EXPIRED', record, workflow: wf } as ResolveApprovalResult;
      }

      const commanderMeta = stripUndefined({
        id: input.decidedBy.id,
        username: input.decidedBy.username,
        name: input.decidedBy.name,
      });

      if (input.decision === 'reject') {
        record.status = 'rejected';
        record.decided_at = input.decidedAt;
        record.decided_by = commanderMeta;
        tx.update(apprRef, {
          status: 'rejected',
          decided_at: input.decidedAt,
          decided_by: commanderMeta,
        });

        if (wf && (!wf.approval_id || wf.approval_id === record.approval_id)) {
          wf.phase = 'rejected';
          wf.updated_at = input.decidedAt;
          wf.completed_at = input.decidedAt;
          tx.update(wfRef, {
            phase: 'rejected',
            updated_at: input.decidedAt,
            completed_at: input.decidedAt,
          });
        }

        return { ok: true, outcome: 'REJECTED', record, workflow: wf } as ResolveApprovalResult;
      }

      record.status = 'approved';
      record.decided_at = input.decidedAt;
      record.decided_by = commanderMeta;
      tx.update(apprRef, {
        status: 'approved',
        decided_at: input.decidedAt,
        decided_by: commanderMeta,
      });

      if (wf && (!wf.approval_id || wf.approval_id === record.approval_id)) {
        wf.phase = 'approved_simulated_remediated';
        wf.updated_at = input.decidedAt;
        wf.completed_at = input.decidedAt;
        const remediationResult = input.buildRemediationResult
          ? stripUndefined(input.buildRemediationResult(wf, record))
          : undefined;
        if (remediationResult) {
          wf.remediation_result = remediationResult;
        }
        tx.update(
          wfRef,
          stripUndefined({
            phase: 'approved_simulated_remediated',
            updated_at: input.decidedAt,
            completed_at: input.decidedAt,
            remediation_result: remediationResult,
          })
        );
      }

      return { ok: true, outcome: 'APPROVED', record, workflow: wf } as ResolveApprovalResult;
    });
  }

  async appendAuditEvent(event: ServerAuditEvent): Promise<ServerAuditEvent> {
    const persisted = stripUndefined({
      ...event,
      created_at_ms: event.created_at_ms ?? Date.now(),
    });
    await this.db.collection(this.auditColName).doc(persisted.id).set(persisted);
    return persisted;
  }

  async listAuditEvents(limit = 200): Promise<ServerAuditEvent[]> {
    const snap = await this.db
      .collection(this.auditColName)
      .orderBy('created_at_ms', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as ServerAuditEvent);
  }
}

export function createWorkflowStoreFromEnv(options?: {
  workflows?: Map<string, IncidentWorkflowState>;
  approvals?: Map<string, ApprovalRecord>;
  auditEvents?: ServerAuditEvent[];
}): WorkflowStore {
  const configuredMode = (process.env.WORKFLOW_STORE || 'memory').trim().toLowerCase();
  if (configuredMode === 'firestore') {
    return new FirestoreStore();
  }
  if (configuredMode !== 'memory') {
    throw new Error(`Invalid WORKFLOW_STORE="${configuredMode}". Expected "memory" or "firestore".`);
  }
  return new InMemoryStore({
    workflows: options?.workflows,
    approvals: options?.approvals,
    auditEvents: options?.auditEvents,
  });
}
