import Database from "@tauri-apps/plugin-sql";
import * as path from "@tauri-apps/api/path";
import {exists} from "@tauri-apps/plugin-fs";


async function createTable() {
  const dbFile = await path.join(await path.appDataDir(), 'db.sqlite');
  const db = await Database.load("sqlite:" + dbFile);
  await db.execute(
    `CREATE TABLE IF NOT EXISTS "zapi"
       (
           id          VARCHAR(64) PRIMARY KEY,
           title       VARCHAR(255) NOT NULL,
           create_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
           update_at   DATETIME DEFAULT CURRENT_TIMESTAMP
       );`);
  await db.close()
}

async function getDb() {
  const dbFile = await path.join(await path.appDataDir(), 'db.sqlite');
  const dbFileExists = await exists(dbFile);
  if (!dbFileExists) {
    await createTable()
  }
  return await Database.load("sqlite:" + dbFile);
}