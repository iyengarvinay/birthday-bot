export interface Birthday {
  phone: string;
  name: string;
  month: number;
  day: number;
}

export interface Store {
  /** Saves a birthday, replacing any earlier date saved for the same name. */
  upsert(b: Birthday): Promise<void>;
  list(phone: string): Promise<Birthday[]>;
  /** Returns whether a birthday with that name existed. */
  remove(phone: string, name: string): Promise<boolean>;
  /** Birthdays on any of `dates` whose reminder hasn't gone out in `year`. */
  due(dates: Array<[number, number]>, year: number): Promise<Birthday[]>;
  markSent(b: Birthday, year: number): Promise<void>;
}

const key = (name: string) => name.toLowerCase();

export class D1Store implements Store {
  constructor(private db: D1Database) {}

  async upsert(b: Birthday): Promise<void> {
    // A changed date resets last_sent_year so the new date still gets a reminder.
    await this.db
      .prepare(
        `INSERT INTO birthdays (phone, name, name_key, month, day)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (phone, name_key) DO UPDATE SET
           name = excluded.name,
           last_sent_year = CASE
             WHEN birthdays.month = excluded.month AND birthdays.day = excluded.day
             THEN birthdays.last_sent_year END,
           month = excluded.month,
           day = excluded.day`,
      )
      .bind(b.phone, b.name, key(b.name), b.month, b.day)
      .run();
  }

  async list(phone: string): Promise<Birthday[]> {
    const { results } = await this.db
      .prepare(`SELECT phone, name, month, day FROM birthdays WHERE phone = ?1 ORDER BY month, day, name_key`)
      .bind(phone)
      .all<Birthday>();
    return results;
  }

  async remove(phone: string, name: string): Promise<boolean> {
    const res = await this.db
      .prepare(`DELETE FROM birthdays WHERE phone = ?1 AND name_key = ?2`)
      .bind(phone, key(name))
      .run();
    return res.meta.changes > 0;
  }

  async due(dates: Array<[number, number]>, year: number): Promise<Birthday[]> {
    const found: Birthday[] = [];
    for (const [month, day] of dates) {
      const { results } = await this.db
        .prepare(
          `SELECT phone, name, month, day FROM birthdays
           WHERE month = ?1 AND day = ?2 AND (last_sent_year IS NULL OR last_sent_year < ?3)
           ORDER BY phone, name_key`,
        )
        .bind(month, day, year)
        .all<Birthday>();
      found.push(...results);
    }
    return found;
  }

  async markSent(b: Birthday, year: number): Promise<void> {
    await this.db
      .prepare(`UPDATE birthdays SET last_sent_year = ?1 WHERE phone = ?2 AND name_key = ?3`)
      .bind(year, b.phone, key(b.name))
      .run();
  }
}
