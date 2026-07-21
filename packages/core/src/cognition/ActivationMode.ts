/**
 * ActivationMode - 认知激活模式配置
 *
 * ## 设计理念
 *
 * 基于认知神经科学的 Exploration-Exploitation 理论，
 * 提供三种基础的记忆激活模式，模拟人脑在不同任务下的激活策略。
 *
 * ## 学术基础
 *
 * 1. **Exploration-Exploitation Theory**
 * 2. **ACT-R Cognitive Architecture**
 * 3. **Dual Process Theory**
 *
 * ## 三种模式
 *
 * - **Creative**: 创造性探索，广泛联想
 * - **Balanced**: 平衡模式，系统默认
 * - **Focused**: 聚焦检索，精确查找
 */
import { info as logInfo, warn as logWarn } from '@promptx/logger'
import { HippocampalActivationStrategy, ActivationStrategyOptions } from './ActivationStrategy'

export type ActivationModeName = 'creative' | 'balanced' | 'focused'

export interface ActivationModeParams {
  firingThreshold: number
  synapticDecay: number
  inhibitionFactor: number
  maxCycles: number
  cycleDecay: number
  frequencyBoost: number
  maxActivations: number
  totalLimit: number
}

export interface ActivationModeConfig {
  name: string
  description: string
  params: ActivationModeParams
}

const MODES: Record<ActivationModeName, ActivationModeConfig> = {
  creative: {
    name: 'Creative',
    description: '创造性探索模式，广泛联想，发现远距离连接',
    params: {
      firingThreshold: 0.05,
      synapticDecay: 0.95,
      inhibitionFactor: 0.05,
      maxCycles: 12,
      cycleDecay: 0.95,
      frequencyBoost: 0.05,
      maxActivations: 150,
      totalLimit: 80,
    },
  },
  balanced: {
    name: 'Balanced',
    description: '平衡模式，系统默认行为',
    params: {
      firingThreshold: 0.1,
      synapticDecay: 0.9,
      inhibitionFactor: 0.1,
      maxCycles: 8,
      cycleDecay: 0.9,
      frequencyBoost: 0.1,
      maxActivations: 100,
      totalLimit: 50,
    },
  },
  focused: {
    name: 'Focused',
    description: '聚焦检索模式，精确查找，优先常用记忆',
    params: {
      firingThreshold: 0.2,
      synapticDecay: 0.75,
      inhibitionFactor: 0.15,
      maxCycles: 4,
      cycleDecay: 0.85,
      frequencyBoost: 0.2,
      maxActivations: 50,
      totalLimit: 20,
    },
  },
}

export class ActivationMode {
  static MODES: Record<ActivationModeName, ActivationModeConfig> = MODES

  /** 获取模式配置（未识别名称 fallback 到 balanced） */
  static getConfig(mode: ActivationModeName | string = 'balanced'): ActivationModeConfig {
    const config = (MODES as Record<string, ActivationModeConfig | undefined>)[mode]

    if (!config) {
      logWarn('[ActivationMode] Unknown mode, using balanced', {
        requestedMode: mode,
        availableModes: Object.keys(MODES),
      })
      return MODES.balanced
    }

    logInfo('[ActivationMode] Using mode', { mode, modeName: config.name })
    return config
  }

  /** 创建 HippocampalActivationStrategy 实例 */
  static createStrategy(mode: ActivationModeName | string = 'balanced'): HippocampalActivationStrategy {
    const config = this.getConfig(mode)

    logInfo('[ActivationMode] Creating activation strategy', {
      mode,
      modeName: config.name,
      firingThreshold: config.params.firingThreshold,
      maxActivations: config.params.maxActivations,
      totalLimit: config.params.totalLimit,
    })

    return new HippocampalActivationStrategy(config.params as ActivationStrategyOptions)
  }

  /** 创建 TwoPhaseRecallStrategy 配置 */
  static createRecallConfig(mode: ActivationModeName | string = 'balanced'): {
    activationStrategy: HippocampalActivationStrategy
    maxActivations: number
    totalLimit: number
  } {
    const config = this.getConfig(mode)

    logInfo('[ActivationMode] Creating recall config', {
      mode,
      name: config.name,
      maxActivations: config.params.maxActivations,
      totalLimit: config.params.totalLimit,
    })

    return {
      activationStrategy: this.createStrategy(mode),
      maxActivations: config.params.maxActivations,
      totalLimit: config.params.totalLimit,
    }
  }

  /** 获取所有可用模式列表 */
  static listModes(): Array<{ key: string; name: string; description: string }> {
    return Object.entries(MODES).map(([key, value]) => ({
      key,
      name: value.name,
      description: value.description,
    }))
  }

  /** 校验模式名称 */
  static isValidMode(mode: string): boolean {
    return !!mode && Object.prototype.hasOwnProperty.call(MODES, mode)
  }
}

export default ActivationMode
