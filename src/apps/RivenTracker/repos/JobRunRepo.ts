import { JobRun } from "../domain/types";
import { d1WithRetry } from "../infra/d1Retry";

export class JobRunRepo {
  constructor(private db: D1Database) {}

  async create(job: JobRun) {
    return d1WithRetry("job_run.create", () =>
      this.db.prepare(`
        INSERT INTO job_run (id, job_name, scheduled_ts, started_at, status, detail)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(job.id, job.job_name, job.scheduled_ts, job.started_at, job.status, job.detail).run(),
    );
  }

  async update(id: string, status: string, finishedAt: string, detail: string) {
    return d1WithRetry("job_run.update", () =>
      this.db.prepare(`
        UPDATE job_run SET status = ?, finished_at = ?, detail = ? WHERE id = ?
      `).bind(status, finishedAt, detail, id).run(),
    );
  }

  /**
   * 清理过期 job_run 记录（按 started_at 判断）
   * @returns 删除的行数（如底层返回不可用，则为 0）
   */
  async purgeOlderThan(isoCutoff: string): Promise<number> {
    const res = await d1WithRetry("job_run.purgeOlderThan", () =>
      this.db
        .prepare(`DELETE FROM job_run WHERE started_at < ?`)
        .bind(isoCutoff)
        .run(),
    );
    // D1Result 可能包含 meta.changes
    // @ts-expect-error D1 meta typing differs between runtimes
    return (res as any)?.meta?.changes ?? 0;
  }
}

