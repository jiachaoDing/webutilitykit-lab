export interface WfmAuction {
  id: string;
  buyout_price: number | null;
  visible: boolean;
  closed: boolean;
  owner: {
    status: 'ingame' | 'online' | 'offline';
    ingame_name?: string;
  };
  item: {
    weapon_url_name: string;
    re_rolls: number;
    attributes: Array<{
      value: number;
      positive: boolean;
      url_name: string;
    }>;
  };
}

export interface RivenWeapon {
  slug: string;
  name_en: string;
  name_zh: string | null;
  icon: string;
  thumb: string;
  group: string;
  rivenType: string;
  disposition: number;
  req_mr: number;
}

export interface Tick {
  ts: string;
  platform: string;
  weapon_slug: string;
  bottom_price: number | null;
  sample_count: number;
  active_count: number; // 新增：真实活跃总数
  min_price: number | null;
  p5_price: number | null;
  p10_price: number | null; // 新增：第 10 名的价格
  created_at: string;
  source_status: 'ok' | 'no_data' | 'error';
  error_code?: string;
}

export interface AggregatedTick {
  ts: string;
  bottom_price: number | null;
  sample_count: number | null;
  active_count: number | null;
  min_price: number | null;
  p5_price: number | null;
  p10_price: number | null;
  status: string | null;
  aggregated_count: number;
}

export interface SyncState {
  key: string;
  value: string;
  updated_at: string;
}

export interface JobRun {
  id: string;
  job_name: string;
  scheduled_ts: string;
  started_at: string;
  finished_at?: string;
  status: 'success' | 'partial' | 'fail';
  detail: string;
}

