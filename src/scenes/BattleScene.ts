import * as PIXI from 'pixi.js';
import ResourceMaster from 'ResourceMaster';
import BattleManagerDelegate from 'interfaces/BattleManagerDelegate';
import LoaderAddParam from 'interfaces/PixiTypePolyfill/LoaderAddParam';
import UnitState from 'enum/UnitState';
import BattleManager from 'managers/BattleManager';
import Scene from 'scenes/Scene';
import UiNodeFactory from 'modules/UiNodeFactory/UiNodeFactory';
import UnitButtonFactory from 'modules/UiNodeFactory/battle/UnitButtonFactory';
import AttackableEntity from 'entity/AttackableEntity';
import BaseEntity from 'entity/BaseEntity';
import UnitEntity from 'entity/UnitEntity';
import UnitButton from 'display/battle/UnitButton';
import Unit from 'display/battle/Unit';
import Field from 'display/battle/Field';
import Base from 'display/battle/Base';
import Dead from 'display/battle/effect/Dead';

const debugMaxUnitCount = 5;
const debugField: number = 1;
const debugStage: number = 1;
const debugUnits: number[] = [1, -1, 3, -1, 5];
const debugBaseIdMap = {
  player: 1,
  ai: 2
};
const debugCostRecoveryPerFrame = 0.05;
const debugMaxAvailableCost     = 100;

const BASES_PLAYER_INDEX = 0;
const BASES_AI_INDEX = 1;

/**
 * BattleScene のステートのリスト
 */
const BattleState = Object.freeze({
  LOADING_RESOURCES: 1,
  READY: 2,
  INGAME: 3,
  FINISHED: 4
});

/**
 * メインのゲーム部分のシーン
 * ゲームロジックは BattleManager に委譲し、主に描画周りを行う
 */
export default class BattleScene extends Scene implements BattleManagerDelegate {
  /**
   * 最大ユニット編成数
   */
  private maxUnitSlotCount!: number;

  /**
   * 利用するフィールドID
   */
  private fieldId!: number;
  /**
   * 挑戦するステージID
   */
  private stageId!: number;
  /**
   * 編成したユニットID配列
   */
  private unitIds!: number[];

  /**
   * 指定された拠点ID
   */
  private baseIdMap!: {
    player: number;
    ai: number;
  };
  /**
   * このシーンのステート
   */
  private state!: number;
  /**
   * ゲームロジックを処理する BattleManager のインスタンス
   */
  private manager!: BattleManager;
  /**
   * 背景の PIXI.Container
   */
  private field!: Field;

  /**
   * 拠点の PIXI.Container
   */
  private bases: Base[] = [];

  private destroyList: PIXI.Container[] = [];

  /**
   * GameManagerDelegate 実装
   * Base を発生させるときのコールバック
   * Field に Base のスプライトを追加する
   */
  public spawnBaseEntity(baseId: number, isPlayer: boolean): BaseEntity | null {
    const fieldMaster = this.manager.getFieldMaster();
    if (!fieldMaster) {
      return null;
    }

    const base = new Base(baseId, isPlayer);

    if (isPlayer) {
      base.init({ x: fieldMaster.playerBase.position.x });
      this.bases[BASES_PLAYER_INDEX] = base;
    } else {
      base.init({ x: fieldMaster.aiBase.position.x });
      this.bases[BASES_AI_INDEX] = base;
    }

    this.field.addChildAsForeBackgroundEffect(base.sprite);

    return base;
  };

  /**
   * GameManagerDelegate 実装
   * Unit を発生させるときのコールバック
   * Field に Unit のスプライトを追加する
   */
  public spawnUnitEntity(unitId: number, isPlayer: boolean): UnitEntity | null {
    const master = this.manager.getUnitMaster(unitId);
    if (!master) {
      return null;
    }

    const unit = new Unit(unitId, isPlayer, {
      hitFrame: master.hitFrame,
      animationMaxFrameIndexes: master.animationMaxFrameIndexes,
      animationUpdateDurations: master.animationUpdateDurations
    });

    unit.sprite.position.x = (isPlayer)
      ? this.bases[BASES_PLAYER_INDEX].sprite.position.x
      : this.bases[BASES_AI_INDEX].sprite.position.x;

    this.field.addChildToRandomZLine(unit.sprite);

    return unit;
  }

  /**
   * GameManagerDelegate 実装
   * Unit が発生したときのコールバック
   * Field に Unit のスプライトを追加する
   */
  public onUnitsSpawned(units: UnitEntity[]): void {
    for (let i = 0; i < units.length; i++) {
      const unit = units[i] as Unit;
      if (unit.isPlayer) {
        unit.sprite.position.x = this.bases[BASES_PLAYER_INDEX].sprite.position.x;
      } else {
        unit.sprite.position.x = this.bases[BASES_AI_INDEX].sprite.position.x;
      }

      this.field.addChildToRandomZLine(unit.sprite);
    }
  }

  /**
   * ユニットのステートが変更した際のコールバック
   */
  public onUnitStateChanged(entity: UnitEntity, _oldState: number): void {
    (entity as Unit).resetAnimation();
  }

  /**
   * GameManagerDelegate 実装
   * Unit が更新されたときのコールバック
   * Unit のアニメーションと PIXI による描画を更新する
   */
  public onUnitUpdated(entity: UnitEntity): void {
    const unit = entity as Unit;

    const animationTypes = ResourceMaster.Unit.AnimationTypes;
    let animationType = unit.getAnimationType();

    switch (unit.state) {
      case UnitState.IDLE: {
        if (animationType !== animationTypes.WALK) {
          if (unit.isAnimationLastFrameTime()) {
            animationType = animationTypes.WALK;
            unit.resetAnimation();
          }
        } else {
          if (unit.isPlayer) {
            unit.sprite.position.x = this.bases[BASES_PLAYER_INDEX].sprite.position.x + unit.distance;
          } else {
            unit.sprite.position.x = this.bases[BASES_AI_INDEX].sprite.position.x - unit.distance;
          }
        }
        break;
      }
      case UnitState.LOCKED: {
        animationType = animationTypes.ATTACK;
        break;
      }
      case UnitState.DEAD: {
        const effect = new Dead(!unit.isPlayer);
        effect.position.set(unit.sprite.position.x, unit.sprite.position.y);
        this.field.addChildAsForeBackgroundEffect(effect);
        this.registerUpdatingObject(effect);

        if (unit.sprite) {
          this.destroyList.push(unit.sprite);
        }
        break;
      }
      default: break;
    }

    if (animationType) {
      unit.updateAnimation(animationType);
    }
  }
  /**
   * GameManagerDelegate 実装
   * 利用可能なコストの値が変動したときのコールバック
   */
  public onAvailableCostUpdated(cost: number): void {
    (this.uiGraph.cost_text as PIXI.Text).text = `${Math.floor(cost)}`;
  }

  /**
   * GameManagerDelegate 実装
   * 渡されたユニット同士が接敵可能か返す
   */
  public shouldLockUnit(attacker: AttackableEntity, target: UnitEntity): boolean {
    return (attacker as Unit).isFoeContact((target as Unit).sprite);
  }

  public shouldLockBase(attacker: AttackableEntity, target: BaseEntity): boolean {
    return (attacker as Unit).isFoeContact((target as Base).sprite);
  }

  /**
   * GameManagerDelegate 実装
   * 渡されたユニット同士が攻撃可能か返す
   */
  public shouldDamage(attackerEntity: AttackableEntity, targetEntity: AttackableEntity): boolean {
    const attacker = attackerEntity as Unit;
    const target = targetEntity as Unit;

    if (!attacker.isHitFrame()) {
      return false;
    }

    return attacker.isFoeContact(target.sprite);
  }
  public shouldUnitWalk(entity: UnitEntity): boolean {
    const unit = entity as Unit;

    if (unit.getAnimationType() === ResourceMaster.Unit.AnimationTypes.WALK) {
      return true;
    }
    return unit.isAnimationLastFrameTime();
  }


  constructor() {
    super();

    // BattleManager インスタンスの作成とコールバックの登録
    this.manager = new BattleManager();

    // Background インスタンスの作成
    this.field = new Field();
    // デフォルトのシーンステート
    this.state = BattleState.LOADING_RESOURCES;

    Debug: {
      this.maxUnitSlotCount = debugMaxUnitCount;
      this.fieldId   = debugField;
      this.stageId   = debugStage;
      this.unitIds   = debugUnits;
      this.baseIdMap = debugBaseIdMap;
      this.manager.costRecoveryPerFrame = debugCostRecoveryPerFrame;
      this.manager.maxAvailableCost     = debugMaxAvailableCost;
    }
  }

  /**
   * リソースリストの作成
   * ユーザが選択したユニットとフィールドのリソース情報も加える
   */
  protected createResourceList(): LoaderAddParam[] {
    const assets = super.createResourceList();

    for (let i = 0; i < this.unitIds.length; i++) {
      const unitId = this.unitIds[i];
      if (unitId >= 0) {
        const unitUrl      = ResourceMaster.Unit.Texture(unitId);
        const unitPanelUrl = ResourceMaster.Unit.PanelTexture(unitId);
        assets.push({ name: unitUrl,      url: unitUrl });
        assets.push({ name: unitPanelUrl, url: unitPanelUrl});
      }
    }

    const fieldMasterUrl = ResourceMaster.Field.Api(this.fieldId);
    assets.push({ name: ResourceMaster.Field.ApiEntryPoint(), url: fieldMasterUrl });

    const aiWaveMasterUrl = ResourceMaster.AiWave.Api(this.stageId);
    assets.push({ name: ResourceMaster.AiWave.ApiEntryPoint(), url: aiWaveMasterUrl });

    const unitMasterUrl = ResourceMaster.Unit.Api(this.unitIds);
    assets.push({ name: ResourceMaster.Unit.ApiEntryPoint(), url: unitMasterUrl });

    const baseMasterUrl = ResourceMaster.Base.Api(this.baseIdMap.player, this.baseIdMap.ai);
    assets.push({ name: ResourceMaster.Base.ApiEntryPoint(), url: baseMasterUrl });

    const playerBaseTextureUrl = ResourceMaster.Base.Texture(this.baseIdMap.player);
    assets.push({ name: playerBaseTextureUrl, url: playerBaseTextureUrl });
    if (this.baseIdMap.player !== this.baseIdMap.ai) {
      const aiBaseTextureUrl = ResourceMaster.Base.Texture(this.baseIdMap.ai);
      assets.push({ name: aiBaseTextureUrl, url: aiBaseTextureUrl });
    }

    if (this.unitIds.indexOf(-1) >= 0) {
      const emptyPanelUrl = ResourceMaster.Unit.PanelTexture(-1);
      assets.push({ name: emptyPanelUrl, url: emptyPanelUrl });
    }

    const fieldResources = Field.resourceList;
    for (let i = 0; i < fieldResources.length; i++) {
      const bgResourceUrl = fieldResources[i];
      assets.push({ name: bgResourceUrl, url: bgResourceUrl });
    }

    const deadResources = Dead.resourceList;
    for (let i = 0; i < deadResources.length; i++) {
      const deadResourceUrl = deadResources[i];
      assets.push({ name: deadResourceUrl, url: deadResourceUrl });
    }

    return assets;
  }

  /**
   * リソースロード完了コールバック
   * BattleManager にユニットマスタ情報を私、フィールドやユニットボタンの初期化を行う
   */
  protected onResourceLoaded(): void {
    const resources = PIXI.loader.resources;

    const sceneUiGraphName = ResourceMaster.SceneUiGraph.Api(this);
    this.prepareUiGraphContainer(resources[sceneUiGraphName].data);

    const fieldMaster = resources[ResourceMaster.Field.ApiEntryPoint()].data;
    const aiWaveMaster = resources[ResourceMaster.AiWave.ApiEntryPoint()].data;
    const unitMasters  = resources[ResourceMaster.Unit.ApiEntryPoint()].data;
    const baseMasterMap = resources[ResourceMaster.Base.ApiEntryPoint()].data;

    this.field.init();

    for (let index = 0; index < this.maxUnitSlotCount; index++) {
      const unitButton = this.getUiGraphUnitButton(index);
      if (!unitButton) {
        continue;
      }

      unitButton.init(index, this.unitIds[index]);
    }

    this.addChild(this.field);
    this.addChild(this.uiGraphContainer);

    if (baseMasterMap) {
      this.manager.init({
        aiWaveMaster,
        fieldMaster,
        unitMasters,
        baseMasterMap,
        delegator: this
      });
    }

    this.state = BattleState.READY;
  }

  /**
   * 独自 UiGraph 要素のファクトリを返す
   * BattleScene は UnitButton を独自で定義している
   */
  protected getCustomUiGraphFactory(type: string): UiNodeFactory | null {
    if (type === 'unit_button') {
      return new UnitButtonFactory();
    }
    return null;
  }

  /**
   * 毎フレームの更新処理
   * シーンのステートに応じて処理する
   */
  public update(delta: number): void {
    switch (this.state) {
      case BattleState.LOADING_RESOURCES: break;
      case BattleState.READY: {
        this.state = BattleState.INGAME;
        break;
      }
      case BattleState.INGAME: {
        this.manager.update(delta);
        break;
      }
    }

    this.bases[BASES_PLAYER_INDEX].updateAnimation();
    this.bases[BASES_AI_INDEX].updateAnimation();

    this.updateRegisteredObjects(delta);

    for (let i = 0; i < this.destroyList.length; i++) {
      this.destroyList[i].destroy();
    }

    this.destroyList = [];
  }

  /**
   * UnitButton 用のコールバック
   * タップされたボタンに応じたユニットの生成を BattleManager にリクエストする
   */
  public onUnitButtonTapped(buttonIndex: number): void {
    if (this.state !== BattleState.INGAME) {
      return;
    }

    const unitButton = this.getUiGraphUnitButton(buttonIndex);
    if (unitButton) {
      this.manager.requestSpawnPlayer(unitButton.unitId);
    }
  }

  /**
   * ボタンインデックスから UnitButton インスタンスを返す
   */
  private getUiGraphUnitButton(index: number): UnitButton | undefined {
    const uiGraphUnitButtonName = `unit_button_${index+1}`;
    return this.uiGraph[uiGraphUnitButtonName] as UnitButton;
  }
}
