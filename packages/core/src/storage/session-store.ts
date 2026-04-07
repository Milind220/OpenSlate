/**
 * SessionStore — persistence layer for sessions.
 * Extended in Phase 4 with thread lifecycle and alias lookup.
 */

import type Database from "bun:sqlite";
import type { Session, SessionId, ProjectId, SessionKind, SessionStatus } from "../types/session.js";

// ── Row shape from SQLite ────────────────────────────────────────────

interface SessionRow {
  id: string;
  project_id: string;
  kind: string;
  status: string;
  parent_id: string | null;
  alias: string | null;
  title: string;
  task: string | null;
  capabilities_json: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id as SessionId,
    projectId: row.project_id as ProjectId,
    kind: row.kind as SessionKind,
    status: row.status as SessionStatus,
    parentId: row.parent_id as SessionId | null,
    alias: row.alias,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Store Interface ──────────────────────────────────────────────────

export interface CreateSessionInput {
  projectId?: string;
  kind?: SessionKind;
  parentId?: string | null;
  alias?: string | null;
  title?: string;
  task?: string;
  capabilities?: string[];
}

export interface SessionStore {
  create(input: CreateSessionInput): Session;
  get(id: SessionId): Session | null;
  list(projectId?: ProjectId): Session[];
  listChildren(parentId: SessionId): Session[];
  findByAlias(parentId: SessionId, alias: string): Session | null;
  updateStatus(id: SessionId, status: SessionStatus): void;
  updateTitle(id: SessionId, title: string): void;
  touch(id: SessionId): void;
  getTask(id: SessionId): string | null;
  getCapabilities(id: SessionId): string[];
}

// ── Implementation ───────────────────────────────────────────────────

export function createSessionStore(db: Database): SessionStore {
  const insertStmt = db.prepare(`
    INSERT INTO sessions (id, project_id, kind, status, parent_id, alias, title, task, capabilities_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getStmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const listAllStmt = db.prepare("SELECT * FROM sessions WHERE kind = 'primary' ORDER BY created_at DESC");
  const listByProjectStmt = db.prepare("SELECT * FROM sessions WHERE project_id = ? AND kind = 'primary' ORDER BY created_at DESC");
  const listChildrenStmt = db.prepare("SELECT * FROM sessions WHERE parent_id = ? ORDER BY created_at ASC");
  const findByAliasStmt = db.prepare("SELECT * FROM sessions WHERE parent_id = ? AND alias = ? LIMIT 1");
  const updateStatusStmt = db.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?");
  const updateTitleStmt = db.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?");
  const touchStmt = db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?");

  return {
    create(input: CreateSessionInput): Session {
      const now = new Date().toISOString();
      const id = crypto.randomUUID() as SessionId;
      const projectId = (input.projectId ?? "default") as ProjectId;
      const kind = input.kind ?? "primary";
      const status: SessionStatus = "active";
      const capsJson = input.capabilities ? JSON.stringify(input.capabilities) : null;

      insertStmt.run(
        id, projectId, kind, status,
        input.parentId ?? null,
        input.alias ?? null,
        input.title ?? "",
        input.task ?? null,
        capsJson,
        now, now,
      );

      return {
        id, projectId, kind, status,
        parentId: (input.parentId as SessionId) ?? null,
        alias: input.alias ?? null,
        title: input.title ?? "",
        createdAt: now, updatedAt: now,
      };
    },

    get(id: SessionId): Session | null {
      const row = getStmt.get(id) as SessionRow | null;
      return row ? rowToSession(row) : null;
    },

    list(projectId?: ProjectId): Session[] {
      const rows = projectId
        ? (listByProjectStmt.all(projectId) as SessionRow[])
        : (listAllStmt.all() as SessionRow[]);
      return rows.map(rowToSession);
    },

    listChildren(parentId: SessionId): Session[] {
      return (listChildrenStmt.all(parentId) as SessionRow[]).map(rowToSession);
    },

    findByAlias(parentId: SessionId, alias: string): Session | null {
      const row = findByAliasStmt.get(parentId, alias) as SessionRow | null;
      return row ? rowToSession(row) : null;
    },

    updateStatus(id: SessionId, status: SessionStatus): void {
      updateStatusStmt.run(status, new Date().toISOString(), id);
    },

    updateTitle(id: SessionId, title: string): void {
      updateTitleStmt.run(title, new Date().toISOString(), id);
    },

    touch(id: SessionId): void {
      touchStmt.run(new Date().toISOString(), id);
    },

    getTask(id: SessionId): string | null {
      const row = getStmt.get(id) as SessionRow | null;
      return row?.task ?? null;
    },

    getCapabilities(id: SessionId): string[] {
      const row = getStmt.get(id) as SessionRow | null;
      if (!row?.capabilities_json) return [];
      try { return JSON.parse(row.capabilities_json); } catch { return []; }
    },
  };
}
