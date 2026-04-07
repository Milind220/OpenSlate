/**
 * MessageStore — persistence layer for messages and their structured parts.
 */

import type Database from "bun:sqlite";
import type { SessionId, MessageId } from "../types/session.js";
import type { Message, MessageRole, MessagePart } from "../types/message.js";

// ── Row shapes ───────────────────────────────────────────────────────

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  created_at: string;
}

interface MessagePartRow {
  id: string;
  message_id: string;
  kind: string;
  position: number;
  payload_json: string;
}

// ── Store Interface ──────────────────────────────────────────────────

export interface AppendMessageInput {
  sessionId: SessionId;
  role: MessageRole;
  parts: MessagePart[];
}

export interface MessageStore {
  append(input: AppendMessageInput): Message;
  get(id: MessageId): Message | null;
  listBySession(sessionId: SessionId): Message[];
}

// ── Implementation ───────────────────────────────────────────────────

export function createMessageStore(db: Database): MessageStore {
  const insertMessageStmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const insertPartStmt = db.prepare(`
    INSERT INTO message_parts (id, message_id, kind, position, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `);

  const getMessageStmt = db.prepare("SELECT * FROM messages WHERE id = ?");

  const listPartsStmt = db.prepare(
    "SELECT * FROM message_parts WHERE message_id = ? ORDER BY position ASC"
  );

  const listBySessionStmt = db.prepare(
    "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC"
  );

  function hydrateMessage(row: MessageRow): Message {
    const partRows = listPartsStmt.all(row.id) as MessagePartRow[];
    const parts: MessagePart[] = partRows.map((pr) => JSON.parse(pr.payload_json) as MessagePart);

    return {
      id: row.id as MessageId,
      sessionId: row.session_id as SessionId,
      role: row.role as MessageRole,
      parts,
      createdAt: row.created_at,
    };
  }

  return {
    append(input: AppendMessageInput): Message {
      const now = new Date().toISOString();
      const messageId = crypto.randomUUID() as MessageId;

      // Insert message row
      insertMessageStmt.run(messageId, input.sessionId, input.role, now);

      // Insert each part as a separate row
      for (let i = 0; i < input.parts.length; i++) {
        const part = input.parts[i]!;
        const partId = crypto.randomUUID();
        insertPartStmt.run(partId, messageId, part.kind, i, JSON.stringify(part));
      }

      return {
        id: messageId,
        sessionId: input.sessionId,
        role: input.role,
        parts: input.parts,
        createdAt: now,
      };
    },

    get(id: MessageId): Message | null {
      const row = getMessageStmt.get(id) as MessageRow | null;
      return row ? hydrateMessage(row) : null;
    },

    listBySession(sessionId: SessionId): Message[] {
      const rows = listBySessionStmt.all(sessionId) as MessageRow[];
      return rows.map(hydrateMessage);
    },
  };
}
