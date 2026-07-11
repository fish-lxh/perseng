/**
 * EnvelopeValidator — envelope 拼装 + 版本策略校验 (3.6 P1)
 *
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.6 / 批次 2)
 *
 * 集中 envelope 拼装 + 版本策略校验，避免每个工具重复
 *   Date.now() / 'system' / 'tool:xxx' / '2.4.1'
 * 内联模式。
 *
 * 不变量：
 * - envelope.producer 必须匹配 `^(tool|core|runtime):[a-zA-Z][a-zA-Z0-9-]*$`
 * - envelope.schemaVersion 必须 === 1（schema 兼容性版本）
 * - envelope.producerVersion === PRODUCER_VERSION（与 package.json 同步）
 * - envelope.ts / ingestedAt > 0（事件源时间）
 * - envelope.type 非空字符串
 *
 * 注意：type 与 producer 的命名空间约定（type 包含 producer 后半段，如 'action.activate' ↔ 'tool:action'）
 * 是约定但不强制校验 — 避免 false-negative 把 V2 envelope 拦下。
 * type 前缀一致性是 warn 而非 throw。
 */

import type { BuilderEnvelope } from './ToolContext.js'
import { PRODUCER_VERSION } from './constants.js'

export interface EnvelopeSpec {
  readonly type: string                  // 'action.activate'
  readonly producer: string              // 'tool:action'
}

export const CURRENT_SCHEMA_VERSION = 1 as const

/**
 * 校验不通过抛 ValidationError；记录 envelope 路径便于排查。
 */
export class EnvelopeValidationError extends Error {
  constructor(public readonly field: string, msg: string) {
    super(`[EnvelopeValidator] ${field}: ${msg}`)
    this.name = 'EnvelopeValidationError'
  }
}

/**
 * 校验 V2 envelope 的必填字段 + 版本约束。
 */
export function validateEnvelope(env: BuilderEnvelope): void {
  if (!env.type || typeof env.type !== 'string') {
    throw new EnvelopeValidationError('type', 'must be non-empty string')
  }
  if (!env.producer || typeof env.producer !== 'string') {
    throw new EnvelopeValidationError('producer', 'must be non-empty string')
  }
  // producer 命名空间约束
  if (!/^(tool|core|runtime):[a-zA-Z][a-zA-Z0-9-]*$/.test(env.producer)) {
    throw new EnvelopeValidationError(
      'producer',
      `must match 'tool:<name>' | 'core:<name>' | 'runtime:<name>' (got '${env.producer}')`,
    )
  }
  if (env.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new EnvelopeValidationError(
      'schemaVersion',
      `must be ${CURRENT_SCHEMA_VERSION} (got ${env.schemaVersion})`,
    )
  }
  if (env.producerVersion !== PRODUCER_VERSION) {
    throw new EnvelopeValidationError(
      'producerVersion',
      `must be '${PRODUCER_VERSION}' (got '${env.producerVersion}')`,
    )
  }
  if (typeof env.ts !== 'number' || env.ts <= 0) {
    throw new EnvelopeValidationError('ts', 'must be positive timestamp')
  }
  if (typeof env.ingestedAt !== 'number' || env.ingestedAt <= 0) {
    throw new EnvelopeValidationError('ingestedAt', 'must be positive timestamp')
  }
  // type / producer 命名空间一致性 — warning 而非 throw
  assertTypeMatchesProducer(env)
}

/**
 * type 应该以 producer 后半段命名空间开头（如 'action.activate' ↔ 'tool:action'），
 * 但 V2 envelope 的真实 prefix 约定是 `${producerShort}.` — 暂作为 warning
 * 而非强制 throw，避免 false-negative 把 V2 跨 producer 跨类型 envelope 拦下。
 *
 * 抛错模式保留（用 opts.strict=true 显式开启）。
 */
export function assertTypeMatchesProducer(env: BuilderEnvelope, opts: { strict?: boolean } = {}): void {
  const producerShort = env.producer.split(':')[1] ?? ''
  if (!producerShort) return
  const expected = `${producerShort}.`
  if (!env.type.startsWith(expected) && !env.type.startsWith(`${producerShort}:`)) {
    if (opts.strict) {
      throw new EnvelopeValidationError(
        'type',
        `recommended prefix '${expected}' (got '${env.type}', producer='${env.producer}')`,
      )
    }
    // non-strict: warn only; validation continues
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        `[EnvelopeValidator] type='${env.type}' producer='${env.producer}' — expected prefix '${expected}'`,
      )
    }
  }
}

export interface BuildArgs {
  type: string
  payload: unknown
  role?: BuilderEnvelope['role']
}

export interface BuilderEnvLike {
  trace: { sessionId: string | null; agentId: string | null; causationId: number | null }
}

/**
 * 按 spec 构造 envelope，自动注入 producer / producerVersion / schemaVersion / ts。
 * 后置 validate（除非 opts.silent）— envelope 出 Bus 之前先过校验。
 */
export function buildEnvelope(
  spec: EnvelopeSpec,
  payload: unknown,
  ctx: BuilderEnvLike,
  role: BuilderEnvelope['role'] = 'system',
  opts: { silent?: boolean } = {},
): BuilderEnvelope {
  const ts = Date.now()
  const env: BuilderEnvelope = {
    type: spec.type,
    ts,
    ingestedAt: ts,
    sessionId: ctx.trace.sessionId,
    agentId: ctx.trace.agentId,
    imageId: null,
    role,
    producer: spec.producer,
    producerVersion: PRODUCER_VERSION,
    schemaVersion: 1,
    causation: ctx.trace.causationId,
    tenantId: null,
    ownerId: null,
    payload,
  }
  if (!opts.silent) validateEnvelope(env)
  return env
}