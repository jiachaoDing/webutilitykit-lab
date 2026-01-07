import { JobRun } from "../domain/types";

export class JobRunRepo {
  constructor(private db: D1Database) {}

  async create(job: JobRun) {
    return this.db.prepare(`
      INSERT INTO job_run (id, job_name, scheduled_ts, started_at, status, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(job.id, job.job_name, job.scheduled_ts, job.started_at, job.status, job.detail).run();
  }

  async update(id: string, status: string, finishedAt: string, detail: string) {
    return this.db.prepare(`
      UPDATE job_run SET status = ?, finished_at = ?, detail = ? WHERE id = ?
    `).bind(status, finishedAt, detail, id).run();
  }
}

