/**
 * 个人知识库:切片 + BM25 词法检索 + 可选向量检索(混合)
 * 没有配置 embedding API 时,纯本地 BM25 就能工作 —— 对个人笔记这种小语料效果很好。
 */
import type { KnowledgeChunk } from '../types'

export interface ChunkOptions {
  /** 目标切片长度(字符) */
  size?: number
  /** 相邻切片重叠 */
  overlap?: number
}

/** 把长文本切成适合检索的片段,尽量在段落/句子边界断开 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = opts.size ?? 700
  const overlap = opts.overlap ?? 120
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  if (clean.length <= size) return [clean]

  const chunks: string[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length)
    if (end < clean.length) {
      // 在窗口后半段找一个自然断点
      const window = clean.slice(start + Math.floor(size * 0.5), end)
      const breakAt = Math.max(
        window.lastIndexOf('\n'),
        window.lastIndexOf('。'),
        window.lastIndexOf('!'),
        window.lastIndexOf('?'),
        window.lastIndexOf(';'),
        window.lastIndexOf('、'),
      )
      if (breakAt > 0) end = start + Math.floor(size * 0.5) + breakAt + 1
    }
    const piece = clean.slice(start, end).trim()
    if (piece) chunks.push(piece)
    if (end >= clean.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks
}

/** 分词:英文按词,中文按字 + 二元组 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  const words = lower.match(/[a-z0-9]+/g)
  if (words) tokens.push(...words)
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of cjk) {
    for (const ch of run) tokens.push(ch)
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
  }
  return tokens
}

interface Bm25Doc {
  tokens: string[]
  tf: Map<string, number>
  len: number
}

const K1 = 1.5
const B = 0.75

/** 对候选切片做 BM25 打分 */
export function bm25Scores(query: string, chunks: KnowledgeChunk[]): number[] {
  const qTokens = tokenize(query)
  if (!qTokens.length || !chunks.length) return chunks.map(() => 0)

  const docs: Bm25Doc[] = chunks.map((c) => {
    const tokens = tokenize(c.text)
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    return { tokens, tf, len: tokens.length }
  })

  const N = docs.length
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / N || 1
  const df = new Map<string, number>()
  for (const d of docs) {
    for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  }

  return docs.map((d) => {
    let score = 0
    for (const qt of new Set(qTokens)) {
      const f = d.tf.get(qt)
      if (!f) continue
      const n = df.get(qt) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avgLen)))
    }
    return score
  })
}

/** 余弦相似度 */
export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export interface SearchHit {
  chunk: KnowledgeChunk
  score: number
  reason: 'semantic' | 'keyword' | 'hybrid'
}

/**
 * 混合检索:有向量走语义 + 词法,没有就纯词法
 */
export async function searchChunks(
  query: string,
  chunks: KnowledgeChunk[],
  opts: { topK?: number; queryEmbedding?: number[] } = {},
): Promise<SearchHit[]> {
  const topK = opts.topK ?? 6
  if (!chunks.length) return []
  const lexical = bm25Scores(query, chunks)
  const maxLex = Math.max(...lexical, 0.0001)

  const haveVectors = chunks.some((c) => c.embedding?.length)
  let semantic: number[] | null = null
  if (haveVectors && opts.queryEmbedding?.length) {
    semantic = chunks.map((c) => (c.embedding ? cosine(opts.queryEmbedding!, c.embedding) : 0))
  }

  const hits: SearchHit[] = chunks.map((chunk, i) => {
    const lex = lexical[i] / maxLex
    const sem = semantic ? semantic[i] : 0
    let score: number
    let reason: SearchHit['reason']
    if (semantic) {
      score = 0.55 * sem + 0.45 * lex
      reason = 'hybrid'
    } else {
      score = lex
      reason = 'keyword'
    }
    return { chunk, score, reason }
  })

  return hits
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/** 把检索结果拼成给模型看的引用块 */
export function buildContext(hits: SearchHit[]): string {
  return hits
    .map((h, i) => `[片段 ${i + 1}] 来源:${h.chunk.title}\n${h.chunk.text}`)
    .join('\n\n')
}
