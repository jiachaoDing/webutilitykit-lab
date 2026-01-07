import { WfmV2Client } from "../clients/WfmV2Client";
import { SyncStateRepo } from "../repos/SyncStateRepo";
import { WeaponRepo } from "../repos/WeaponRepo";

export class SyncService {
  constructor(
    private wfmClient: WfmV2Client,
    private syncStateRepo: SyncStateRepo,
    private weaponRepo: WeaponRepo
  ) {}

  /**
   * 同步紫卡字典数据
   */
  async syncRivens() {
    // 1. 获取远程版本并对比
    const versions = await this.wfmClient.getVersions();
    const remoteVersion = versions.data.collections.rivens;
    const localVersion = await this.syncStateRepo.get('rivens_version_b64');

    if (remoteVersion === localVersion) {
      return { updated: false, reason: 'version_match' };
    }

    // 2. 版本不一致，全量拉取并更新 (upsert)
    const weapons = await this.wfmClient.getRivenWeapons();
    await this.weaponRepo.upsertMany(weapons);

    // 3. 更新本地版本号
    await this.syncStateRepo.set('rivens_version_b64', remoteVersion);

    return { updated: true, count: weapons.length };
  }
}

