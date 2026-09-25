/**
 * 瞄准测试数据模型。
 * 每个测试都记录真实的鼠标/时间数据，成绩由这些数据计算得出，
 * 绝不使用随机数生成成绩。
 */

/* ---------- 通用 ---------- */

/** 坐标采样点（毫秒时间戳） */
export interface PointSample {
  t: number;
  x: number;
  y: number;
}

/* ---------- Flick Test ---------- */

export interface FlickTargetRecord {
  targetId: number;
  /** 目标中心（虚拟画布坐标，CSS px） */
  targetX: number;
  targetY: number;
  targetRadius: number;
  /** 本目标开始时刻的准星位置 */
  startX: number;
  startY: number;
  spawnTime: number;
  /** 首次出现明显移动的时间（反应时间基准） */
  firstMoveTime: number;
  /** 点击（命中或未命中）时间 */
  hitTime: number;
  hitX: number;
  hitY: number;
  /** 是否命中 */
  hit: boolean;
  /** 采样到的鼠标路径点数 */
  pathSampleCount: number;
  /** 实际移动总距离（px） */
  totalMouseDistance: number;
  /** 起点到目标中心的理想直线距离（px） */
  idealDistance: number;
  /** 移动方向反向/停顿重新加速次数（修正次数） */
  correctionCount: number;
  /** 是否过冲（进入目标半径后又大幅远离） */
  overshoot: boolean;
  /** 过冲距离（超出目标边缘的像素量，无过冲为 0） */
  overshootDistance: number;
  /** 是否欠冲（明显停滞后又继续移动才到达） */
  undershoot: boolean;
  /** 反应时间 ms：spawn -> firstMove */
  reactionTime: number;
  /** 到达时间 ms：spawn -> click */
  timeToTarget: number;
}

export interface FlickScoreBreakdown {
  accuracy: number;
  speed: number;
  reaction: number;
  efficiency: number;
  consistency: number;
}

export interface FlickResult {
  attempts: number;
  hits: number;
  misses: number;
  accuracy: number;
  avgReactionTime: number;
  avgTimeToTarget: number;
  medianTimeToTarget: number;
  avgEfficiency: number;
  overshootRate: number;
  undershootRate: number;
  avgCorrections: number;
  consistency: number;
  score: number;
  breakdown: FlickScoreBreakdown;
  records: FlickTargetRecord[];
  timestamp: number;
  durationMs: number;
}

/* ---------- Tracking Test ---------- */

export interface TrackingSample {
  t: number;
  cursorX: number;
  cursorY: number;
  targetX: number;
  targetY: number;
  /** 准星与目标中心距离（px） */
  error: number;
  /** 是否位于目标半径之内 */
  inside: boolean;
  /** 准星速度 px/s */
  cursorSpeed: number;
  /** 目标速度 px/s */
  targetSpeed: number;
}

export interface TrackingScoreBreakdown {
  error: number;
  medianError: number;
  coverage: number;
  stability: number;
  velocityMatching: number;
  noise: number;
}

export interface TrackingResult {
  durationMs: number;
  sampleCount: number;
  avgError: number;
  medianError: number;
  p95Error: number;
  errorStd: number;
  /** 准星在目标内的采样占比 0~1 */
  coverage: number;
  /** 平均速度匹配误差（相对目标速度的比率均值） */
  velocityDiffRatio: number;
  /** 抖动：误差变化速度 px/s（p75） */
  jitter: number;
  score: number;
  breakdown: TrackingScoreBreakdown;
  timestamp: number;
  seed: number;
}

/* ---------- Micro Adjustment Test ---------- */

export interface MicroTargetRecord {
  targetId: number;
  targetX: number;
  targetY: number;
  targetRadius: number;
  spawnTime: number;
  hitTime: number;
  /** 进入锁定半径（hold 开始）时间 */
  holdStartTime: number;
  /** hold 期间平均与目标中心的距离 */
  avgHoldError: number;
  /** hold 期间最大偏离 */
  maxHoldError: number;
  /** 修正次数：离开锁定半径重置 + 方向变化 */
  corrections: number;
  /** hold 时间 ms */
  holdMs: number;
  /** 完成时间 ms：spawn -> hit */
  completionTime: number;
}

export interface MicroScoreBreakdown {
  accuracy: number;
  precision: number;
  speed: number;
  stability: number;
}

export interface MicroResult {
  attempts: number;
  hits: number;
  misses: number;
  accuracy: number;
  avgHoldError: number;
  avgCompletionTime: number;
  avgCorrections: number;
  stability: number;
  score: number;
  breakdown: MicroScoreBreakdown;
  records: MicroTargetRecord[];
  timestamp: number;
  durationMs: number;
}

/* ---------- 综合 ---------- */

export interface TestSuiteResult {
  candidateSensitivity: number;
  multiplier: number;
  flick: FlickResult;
  tracking: TrackingResult;
  micro: MicroResult;
  flickScore: number;
  trackingScore: number;
  microScore: number;
  consistencyScore: number;
  penalties: number;
  overallScore: number;
}

/** 一次校准结果（不计入正式成绩，只建立基线） */
export interface CalibrationResult {
  durationMs: number;
  clicks: number;
  /** 平均移动速度 px/s */
  avgMoveSpeed: number;
  /** 平均点击延迟 ms（目标出现 -> 点击） */
  avgClickDelay: number;
  /** 平均从屏幕中心出发到达目标的距离 px（玩家活动范围） */
  avgReachDistance: number;
  hitRate: number;
  timestamp: number;
}
