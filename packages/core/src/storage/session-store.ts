/**
 * SessionStore — persistence layer for sessions.
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
}

export interface SessionStore {
  create(input: CreateSessionInput): Session;
  get(id: SessionId): Session | null;
  list(projectId?: ProjectId): Session[];
  updateStatus(id: SessionId, status: SessionStatus): void;
  updateTitle(id: SessionId, title: string): void;
  touch(id: SessionId): void;
}

// ── Implementation ───────────────────────────────────────────────────

export function createSessionStore(db: Database): SessionStore {
  const insertStmt = db.prepare(`
    INSERT INTO sessions (id, project_id, kind, status, parent_id, alias, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getStmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const listAllStmt = db.prepare("SELECT * FROM sessions ORDER BY created_at DESC");
  const listByProjectStmt = db.prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC");
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

      insertStmt.run(
        id,
        projectId,
        kind,
        status,
        input.parentId ?? null,
        input.alias ?? null,
        input.title ?? "",
        now,
        now,
      );

      return {
        id,
        projectId,
        kind,
        status,
        parentId: (input.parentId as SessionId) ?? null,
        alias: input.alias ?? null,
        title: input.title ?? "",
        createdAt: now,
        updatedAt: now,
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

    updateStatus(id: SessionId, status: SessionStatus): void {
      updateStatusStmt.run(status, new Date().toISOString(), id);
    },

    updateTitle(id: SessionId, title: string): void {
      updateTitleStmt.run(title, new Date().toISOString(), id);
    },

    touch(id: SessionId): void {
      touchStmt.run(new Date().toISOString(), id);
    },
  };
}
