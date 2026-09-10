#!/usr/bin/env ts-node
/**
 * One-off / repeatable subscriber import from a CSV or Excel file.
 *
 * Usage:
 *   npm run import-subscribers -- --file ./subscribers.csv --table <SubscribersTableName> [--list general] [--region us-east-1]
 *
 * File format: a header row with an "email" column (required) and an
 * optional "lists" column — comma or semicolon separated list names, e.g.
 * "juniors;private-lessons". Rows with no "lists" value fall back to the
 * --list flag (default: "general"). Both .csv and .xlsx/.xls are supported,
 * detected from the file extension.
 *
 * SAFE TO RE-RUN: existing subscribers are never re-subscribed and never
 * get their unsubscribe token replaced. Re-running with an updated file
 * only creates new rows and unions list membership for people who already
 * exist — anyone who previously unsubscribed stays unsubscribed even if
 * their row appears again in a new file. This is intentional and required
 * for compliance (CAN-SPAM) — do not "fix" this by forcing subscribed:true.
 */
import { readFileSync } from "fs";
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { AVAILABLE_LISTS } from "../shared/src/types";

interface Args {
  file: string;
  table: string;
  list: string;
  region: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback?: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : fallback;
  };
  const file = get("--file");
  const table = get("--table");
  if (!file || !table) {
    console.error(
      "Usage: npm run import-subscribers -- --file <path> --table <TableName> [--list general] [--region us-east-1]"
    );
    process.exit(1);
  }
  return {
    file: file!,
    table: table!,
    list: get("--list", "general")!,
    region: get("--region", "us-east-1")!,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Row {
  email: string;
  lists: string[];
}

function readRows(filePath: string, defaultList: string): Row[] {
  const isExcel = /\.xlsx?$/i.test(filePath);
  let records: Record<string, unknown>[];

  if (isExcel) {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    records = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  } else {
    const content = readFileSync(filePath, "utf-8");
    records = parseCsv(content, { columns: true, skip_empty_lines: true, trim: true });
  }

  const rows: Row[] = [];
  let skippedInvalid = 0;

  for (const record of records) {
    // case-insensitive header lookup
    const entries = Object.entries(record).reduce((acc, [k, v]) => {
      acc[k.trim().toLowerCase()] = String(v ?? "").trim();
      return acc;
    }, {} as Record<string, string>);

    const email = entries["email"]?.toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      skippedInvalid += 1;
      continue;
    }

    const listsRaw = entries["lists"];
    const lists = listsRaw
      ? listsRaw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      : [defaultList];

    rows.push({ email, lists });
  }

  if (skippedInvalid > 0) {
    console.log(`Skipped ${skippedInvalid} row(s) with a missing/invalid email.`);
  }
  return rows;
}

async function main() {
  const { file, table, list, region } = parseArgs();
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  const rows = readRows(file, list);
  console.log(`Parsed ${rows.length} valid email row(s) from ${file}`);

  const unknownLists = new Set<string>();
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    row.lists.forEach((l) => {
      if (!(AVAILABLE_LISTS as readonly string[]).includes(l)) unknownLists.add(l);
    });

    try {
      const existing = await ddb.send(
        new GetCommand({ TableName: table, Key: { email: row.email } })
      );

      if (!existing.Item) {
        await ddb.send(
          new PutCommand({
            TableName: table,
            Item: {
              email: row.email,
              subscribed: true,
              unsubscribeToken: randomUUID(),
              createdAt: new Date().toISOString(),
              lists: row.lists,
            },
          })
        );
        created += 1;
      } else {
        const mergedLists = Array.from(
          new Set([...(existing.Item.lists ?? []), ...row.lists])
        );
        await ddb.send(
          new PutCommand({
            TableName: table,
            Item: {
              ...existing.Item, // preserves existing `subscribed` status and unsubscribeToken
              lists: mergedLists,
            },
          })
        );
        updated += 1;
      }
    } catch (err) {
      console.error(`Failed on ${row.email}:`, (err as Error).message);
      failed += 1;
    }
  }

  console.log(
    `\nDone. Created: ${created}, Updated (list membership merged): ${updated}, Failed: ${failed}`
  );
  if (unknownLists.size > 0) {
    console.log(
      `\nNote: these list names aren't in AVAILABLE_LISTS (shared/src/types.ts) and won't appear as a dedicated option in the send dropdown: ${[...unknownLists].join(", ")}`
    );
  }
}

main();
