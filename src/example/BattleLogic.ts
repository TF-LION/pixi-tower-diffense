import BattleLogicDelegate from 'example/BattleLogicDelegate';
import BattleLogicConfig from 'example/BattleLogicConfig';
import UnitEntity from 'example/UnitEntity';
import UnitMaster from 'example/UnitMaster';
import StageMaster from 'interfaces/master/StageMaster';
import AttackableState from 'example/AttackableState';

/**
 * ゲーム内バトルパートのマネージャ
 * ゲームロジックを中心に扱う
 */
export default class BattleLogic {
  /**
   * バトル設定
   */
  private config: BattleLogicConfig = Object.freeze(new BattleLogicConfig());
  /**
   * BattleLogicDelegate 実装オブジェクト
   */
  private delegator: BattleLogicDelegate | null = null;
  /**
   * 現在の利用可能なコスト
   */
  private availableCost: number = 0;
  /**
   * 次に割り当てるエンティティID
   */
  private nextEntityId: number = 0;
  /**
   * 生成済みの Unit インスタンスを保持する配列
   */
  private unitEntities: UnitEntity[] = [];
  /**
   * UnitMaster をキャッシュするための Map
   */
  private unitMasterCache: Map<number, UnitMaster> = new Map();
  /**
   * フィールドマスタのキャッシュ
   */
  private stageMasterCache: StageMaster | null = null;
  /**
   * StageMaster.waves をキャッシュするための Map
   */
  private aiWaveCache: Map<number, { unitId: number }[]> = new Map();
  /**
   * 経過フレーム数
   */
  private passedFrameCount: number = 0;

  /**
   * 外部から生成をリクエストされたユニット情報を保持する配列
   */
  private spawnRequestedUnitUnitIds: {
    unitId: number,
    isPlayer: boolean
  }[] = [];

  /**
   * プレイヤー情報
   */
  private player: {
    unitIds: number[]
  } = {
    unitIds: []
  };

  /**
   * デリゲータとマスタ情報で初期化
   */
  public init(params: {
    delegator: BattleLogicDelegate,
    stageMaster: StageMaster,
    player: {
      unitIds: number[]
    },
    unitMasters: UnitMaster[],
    config?: BattleLogicConfig
  }): void {
    if (params.config) {
      this.config = Object.freeze(params.config);
    }

    // デリゲータのセット
    this.delegator = params.delegator;
    this.player = params.player;
    this.unitMasterCache.clear();

    // ユニット情報のキャッシュ
    for (let i = 0; i < params.unitMasters.length; i++) {
      const unit = params.unitMasters[i];
      this.unitMasterCache.set(unit.unitId, unit);
    }

    // マスターのキャッシュ処理
    this.stageMasterCache = params.stageMaster;

    // AI生成情報のキャッシュ
    const waves = this.stageMasterCache.waves;
    const keys = Object.keys(waves);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      this.aiWaveCache.set(Number.parseInt(key, 10), waves[key]);
    }
  }

  /**
   * ゲーム更新処理
   * 外部から任意のタイミングでコールする
   */
  public update(): void {
    // コスト回復
    this.updateAvailableCost(this.availableCost + this.config.costRecoveryPerFrame);
    // AI ユニットの生成リクエスト発行
    this.updateAISpawn();
    // リクエストされているユニット生成実行
    this.updateSpawnRequest();
    // エンティティパラメータの更新
    this.updateEntityParameter();
    // エンティティのステート変更
    this.updateEntityState();

    this.passedFrameCount++;
  }

  /**
   * Unit 生成をリクエストする
   */
  public requestSpawn(unitId: number, isPlayer: boolean): void {
    this.spawnRequestedUnitUnitIds.push({ unitId, isPlayer });
  }
  /**
   * Unit 生成をリクエストする
   * プレイヤーユニット生成リクエストのシュガー
   */
  public requestSpawnPlayer(unitId: number): void {
    this.requestSpawn(unitId, true);
  }
  /**
   * Unit 生成をリクエストする
   * AIユニット生成リクエストのシュガー
   */
  public requestSpawnAI(unitId: number): void {
    this.requestSpawn(unitId, false);
  }

  /**
   * 利用可能なコストを更新し、専用のコールバックをコールする
   */
  private updateAvailableCost(newCost: number): number {
    let cost = newCost;
    if (cost > this.config.maxAvailableCost) {
      cost = this.config.maxAvailableCost;
    }
    this.availableCost = cost;

    if (this.delegator) {
      const availablePlayerUnitIds = [];
      for (let i = 0; i < this.player.unitIds.length; i++) {
        const unitId = this.player.unitIds[i];
        const master = this.unitMasterCache.get(unitId);
        if (!master) {
          continue;
        }

        if (this.availableCost >= master.cost) {
          availablePlayerUnitIds.push(unitId);
        }
      }

      // コスト更新後処理をデリゲータに委譲する
      this.delegator.onAvailableCostUpdated(
        this.availableCost,
        this.config.maxAvailableCost,
        availablePlayerUnitIds
      );
    }

    return this.availableCost;
  }

  /**
   * 現在のフレームに応じて AI ユニットを生成させる
   */
  private updateAISpawn(): void {
    const waves = this.aiWaveCache.get(this.passedFrameCount);
    if (!waves) {
      return;
    }

    for (let i = 0; i < waves.length; i++) {
      const unitId = waves[i].unitId;
      this.requestSpawnAI(unitId);
    }
  }

  /**
   * 受け付けた Unit 生成リクエストを処理する
   * プレイヤーユニットの場合はコストを消費し、Unit 生成を試みる
   */
  private updateSpawnRequest(): void {
    // 生成リクエストがなければ何もしない
    if (this.spawnRequestedUnitUnitIds.length === 0) {
      return;
    }

    let tmpCost = this.availableCost;

    for (let i = 0; i < this.spawnRequestedUnitUnitIds.length; i++) {
      const reservedUnit = this.spawnRequestedUnitUnitIds[i];

      const master = this.unitMasterCache.get(reservedUnit.unitId);
      if (!master) {
        continue;
      }

      let baseLocation = 0;

      if (reservedUnit.isPlayer) {
        // コストが足りなければ何もしない
        if ((tmpCost - master.cost) < 0) {
          continue;
        }

        tmpCost -= master.cost;
        baseLocation = 100; // 仮の値
      } else {
        baseLocation = 1000; // 仮の値
      }


      const entity = new UnitEntity(reservedUnit.unitId, reservedUnit.isPlayer);
      entity.id = this.nextEntityId++;
      entity.maxHealth = master.maxHealth;
      entity.currentHealth = master.maxHealth;
      entity.state = AttackableState.IDLE;
      this.unitEntities.push(entity);

      // ユニット生成後処理をデリゲータに移譲する
      if (this.delegator) {
        this.delegator.onUnitEntitySpawned(entity, baseLocation);
      }
    }

    this.updateAvailableCost(tmpCost);

    this.spawnRequestedUnitUnitIds = [];
  }

  /**
   * Unit のパラメータを更新する
   * ステートは全てのパラメータが変化した後に更新する
   */
  private updateEntityParameter(): void {
    for (let i = 0; i < this.unitEntities.length; i++) {
      const unit = this.unitEntities[i];
      const master = this.unitMasterCache.get(unit.unitId);
      if (!master) {
        continue;
      }

      this.updateDistance(unit, master);
    }
  }

  /**
   * 移動可能か判定し、可能なら移動させる
   */
  private updateDistance(unit: UnitEntity, master: UnitMaster): void {
    if (unit.state === AttackableState.IDLE) {
      // 移動可能かどうかの判断をデリゲータに委譲する
      if (this.delegator) {
        if (this.delegator.shouldUnitWalk(unit)) {
          unit.distance += master.speed;
          // 移動した後の処理をデリゲータに委譲する
          this.delegator.onUnitEntityWalked(unit);
        }
      } else {
        unit.distance += master.speed;
      }
    }
  }

  /**
   * エンティティのステートを更新する
   * ステート優先順位は右記の通り DEAD > KNOCK_BACK > ENGAGED > IDLE
   * ユニット毎に処理を行うとステートを条件にした処理結果が
   * タイミングによって異なってしまうのでステート毎に処理を行う
   */
  private updateEntityState(): void {
    for (let i = 0; i < this.unitEntities.length; i++) {
      const entity = this.unitEntities[i];
      if (entity.state === AttackableState.IDLE) {
        this.updateUnitIdleState(entity);
      }
    }
  }

  /**
   * 何もしていない状態でのステート更新処理
   */
  private updateUnitIdleState(_unit: UnitEntity): void {
  }
}