/**
 * TokenUsageIndicator - Live token usage display driven by SDK context_warning events
 *
 * KNUTH-FEAT 2026-07-07: 把 SDK 的 token 用量实时显示在 UI 上.
 *
 * 工作机制:
 * - 订阅 AgentX 的 `context_warning` event
 * - 维护本地 state `{ used, total, ratio, severity }`
 * - 没用量时静默 (返回 null), 避免无意义的 0% 显示
 * - 用量上来后渲染 TokenUsagePie (颜色按 ratio 自动切: 蓝/琥珀/红)
 *
 * 数据来源: ContextManager 在 handleStreamEvent/handleResult 里调 recordUsage,
 *           超阈值时 emit ContextWarningEvent. 本组件就是这个 event 的 UI 消费者.
 */

import * as React from "react";
import { TokenUsagePie } from "./TokenUsagePie";

/**
 * ContextWarningEvent 数据结构 (从 @agentxjs/runtime 桥接到 bus)
 *
 * 与 ContextManager.ContextWarningEvent 保持一致.
 */
interface ContextWarningEventData {
  type: "context_warning";
  imageId: string;
  ratio: number;
  severity: "warn" | "force";
  usage: {
    imageId: string;
    inputTokens: number;
    outputTokens: number;
    totalInputTokens: number;
    contextWindow: number;
  };
  timestamp: number;
}

export interface TokenUsageIndicatorProps {
  /**
   * AgentX instance to subscribe to events on.
   * Subscribes to `context_warning` events emitted by ContextManager.
   */
  agentx: { on: (type: string, handler: (e: { data: unknown }) => void) => () => void } | null;
  /**
   * Only show updates for this imageId. If unset, shows updates for any image.
   */
  imageId?: string | null;
  /**
   * Additional CSS classes for the wrapper.
   */
  className?: string;
}

/**
 * TokenUsageIndicator - subscribes to context_warning events and renders TokenUsagePie
 *
 * Returns null when no usage data available.
 */
export function TokenUsageIndicator({
  agentx,
  imageId,
  className,
}: TokenUsageIndicatorProps): React.ReactElement | null {
  const [state, setState] = React.useState<{
    used: number;
    total: number;
    ratio: number;
    severity: "warn" | "force";
  } | null>(null);

  React.useEffect(() => {
    if (!agentx) return;

    const unsubscribe = agentx.on("context_warning", (event) => {
      const data = event.data as ContextWarningEventData;
      if (!data || !data.usage) return;

      // 过滤 imageId (如果指定了)
      if (imageId && data.imageId !== imageId) return;

      const { inputTokens, contextWindow } = data.usage;
      if (typeof inputTokens !== "number" || typeof contextWindow !== "number" || contextWindow <= 0) {
        return;
      }

      setState({
        used: inputTokens,
        total: contextWindow,
        ratio: data.ratio,
        severity: data.severity,
      });
    });

    return () => unsubscribe();
  }, [agentx, imageId]);

  // 没有用量数据时不显示 (避免 0/200000 噪声)
  if (!state) return null;

  return <TokenUsagePie used={state.used} total={state.total} className={className} />;
}
