import type { ChildPromptEpisode, Episode } from "./types/index.js";
const TOKEN_SPLIT = /[^a-zA-Z0-9_]+/g;

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(TOKEN_SPLIT)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function lexicalOverlapScore(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let overlap = 0;
  for (const token of ta) {
    if (tb.has(token)) overlap += 1;
  }

  return overlap;
}

function recencyScore(episode: Episode): number {
  const t = Date.parse(episode.finishedAt ?? episode.createdAt);
  if (Number.isNaN(t)) return 0;
  return Math.floor(t / 1000);
}

function statusScore(status: Episode["status"]): number {
  switch (status) {
    case "completed":
      return 5;
    case "escalated":
      return 2;
    case "aborted":
      return 0;
    default:
      return 0;
  }
}

function episodeRank(
  episode: Episode,
  targetTask: string,
  aliasHint: string | null,
): number {
  return (
    statusScore(episode.status) * 1_000_000 +
    (episode.alias && aliasHint && episode.alias === aliasHint ? 200_000 : 0) +
    lexicalOverlapScore(episode.task + "\n" + (episode.summary ?? ""), targetTask) *
      10_000 +
    Math.min(episode.filesChanged.length, 10) * 200 +
    Math.min(episode.keyFindings.length, 10) * 100 +
    recencyScore(episode)
  );
}

function toChildPromptEpisode(episode: Episode): ChildPromptEpisode {
  return {
    id: episode.id,
    alias: episode.alias,
    task: episode.task,
    status: episode.status,
    summary: episode.summary,
    keyFindings: episode.keyFindings,
    filesRead: episode.filesRead,
    filesChanged: episode.filesChanged,
    openQuestions: episode.openQuestions,
    nextActions: episode.nextActions,
    finishedAt: episode.finishedAt,
  };
}

export interface EpisodeSelectionInput {
  episodes: Episode[];
  targetTask: string;
  aliasHint?: string | null;
  preferredEpisodeIds?: string[];
  limit: number;
}

export function selectEpisodes(input: EpisodeSelectionInput): Episode[] {
  const {
    episodes,
    targetTask,
    aliasHint = null,
    preferredEpisodeIds = [],
    limit,
  } = input;
  if (limit <= 0 || episodes.length === 0) return [];

  const byId = new Map(episodes.map((episode) => [episode.id, episode]));
  const selected: Episode[] = [];

  for (const preferred of preferredEpisodeIds) {
    const hit = byId.get(preferred);
    if (!hit) continue;
    if (selected.some((x) => x.id === hit.id)) continue;
    selected.push(hit);
    if (selected.length >= limit) return selected;
  }

  const ranked = [...episodes].sort((a, b) => {
    const rb = episodeRank(b, targetTask, aliasHint);
    const ra = episodeRank(a, targetTask, aliasHint);
    if (rb !== ra) return rb - ra;
    return b.createdAt.localeCompare(a.createdAt);
  });

  for (const episode of ranked) {
    if (selected.some((x) => x.id === episode.id)) continue;
    selected.push(episode);
    if (selected.length >= limit) break;
  }

  return selected;
}

export function selectEpisodesForChildPrompt(input: {
  episodes: Episode[];
  task: string;
  alias: string | null;
  inputEpisodeIds?: string[];
  limit?: number;
}): ChildPromptEpisode[] {
  const selected = selectEpisodes({
    episodes: input.episodes,
    targetTask: input.task,
    aliasHint: input.alias,
    preferredEpisodeIds: input.inputEpisodeIds,
    limit: input.limit ?? 3,
  });

  return selected.map(toChildPromptEpisode);
}

export function selectEpisodesForOrchestrator(input: {
  episodes: Episode[];
  task: string;
  limit?: number;
}): Episode[] {
  return selectEpisodes({
    episodes: input.episodes,
    targetTask: input.task,
    limit: input.limit ?? 6,
  });
}
