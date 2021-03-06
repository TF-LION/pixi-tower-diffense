export default class BattleLogicConfig {
  /**
   * フレームごとのコスト回復量
   */
  public costRecoveryPerFrame: number = 0;
  /**
   * 利用可能コストの上限値
   */
  public maxAvailableCost: number = 100;
  /**
   * 1 対 1 の接敵のみを許可するかどうか
   */
  public chivalrousEngage: boolean = true;
  /**
   * ノックバック条件となる体力閾値
   * [0.5] の場合、体力が 0.5 以上から 0.5 未満に変動した場合にノックバックする
   */
  public knockBackHealthThreasholds: number[] = [0.25, 0.5, 0.75];

  constructor(params?: {
    costRecoveryPerFrame?: number,
    maxAvailableCost?: number,
    chivalrousEngage?: boolean,
    knockBackHealthThreasholds?: number[]
  }) {
    if (!params) {
      return;
    }

    if (params.costRecoveryPerFrame) {
      this.costRecoveryPerFrame = params.costRecoveryPerFrame;
    }
    if (params.maxAvailableCost) {
      this.maxAvailableCost = params.maxAvailableCost;
    }
    if (params.chivalrousEngage) {
      this.chivalrousEngage = params.chivalrousEngage;
    }
    if (params.knockBackHealthThreasholds) {
      this.knockBackHealthThreasholds = params.knockBackHealthThreasholds.sort().reverse();
    }
  }
}
