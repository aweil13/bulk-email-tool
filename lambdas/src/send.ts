import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { Subscriber, SendCampaignRequestBody } from "@bulk-email-tool/shared";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({});

const TABLE_NAME = process.env.TABLE_NAME as string;
const FROM_EMAIL = process.env.FROM_EMAIL as string;
const UNSUBSCRIBE_BASE_URL = process.env.UNSUBSCRIBE_BASE_URL as string; // e.g. https://your-project.pages.dev/unsubscribe.html
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL; // optional — replies routed here instead of FROM_EMAIL

interface SendJobInput extends SendCampaignRequestBody {
  /** Delay between sends, in ms. Keep this above your SES account's per-second send rate limit. */
  sendDelayMs?: number;
}

async function scanSubscribers(listName?: string): Promise<Subscriber[]> {
  const items: Subscriber[] = [];
  let lastKey: Record<string, unknown> | undefined;
  const filterByList = listName && listName !== "all";

  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: filterByList
          ? "subscribed = :true AND contains(#lists, :list)"
          : "subscribed = :true",
        ExpressionAttributeNames: filterByList ? { "#lists": "lists" } : undefined,
        ExpressionAttributeValues: {
          ":true": true,
          ...(filterByList ? { ":list": listName } : {}),
        },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...((page.Items as Subscriber[]) ?? []));
    lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends a campaign to every subscriber on the given list (or everyone, if
 * `listName` is omitted or "all"). Invoked two ways:
 *
 * 1. Directly, via `aws lambda invoke` — useful for testing or one-off sends.
 * 2. Asynchronously, by the trigger-campaign Lambda behind POST /campaigns —
 *    this is how the admin compose page sends. It's invoked with
 *    InvocationType "Event" so it isn't bound by API Gateway's 29-second
 *    request timeout; a 1,500-recipient send can take several minutes.
 *
 * Not wired to API Gateway directly on purpose — see trigger-campaign.ts,
 * which handles the admin-key check before kicking this off.
 */
export const handler = async (event: SendJobInput) => {
  if (!event.subject || !event.html) {
    throw new Error("Payload must include 'subject' and 'html'.");
  }

  const subscribers = await scanSubscribers(event.listName);
  const delayMs = event.sendDelayMs ?? 150; // ~6/sec by default; tune to your SES sending rate

  let sent = 0;
  const failures: { email: string; error: string }[] = [];

  for (const subscriber of subscribers) {
    const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}?email=${encodeURIComponent(
      subscriber.email
    )}&token=${encodeURIComponent(subscriber.unsubscribeToken)}`;

    const html = event.html.replaceAll("{{unsubscribeUrl}}", unsubscribeUrl);
    const text = event.text?.replaceAll("{{unsubscribeUrl}}", unsubscribeUrl);

    try {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: FROM_EMAIL,
          Destination: { ToAddresses: [subscriber.email] },
          ...(REPLY_TO_EMAIL ? { ReplyToAddresses: [REPLY_TO_EMAIL] } : {}),
          Content: {
            Simple: {
              Subject: { Data: event.subject },
              Body: {
                Html: { Data: html },
                ...(text ? { Text: { Data: text } } : {}),
              },
            },
          },
        })
      );
      sent += 1;
    } catch (err) {
      failures.push({ email: subscriber.email, error: (err as Error).message });
    }

    await sleep(delayMs);
  }

  const result = {
    listName: event.listName ?? "all",
    totalSubscribers: subscribers.length,
    sent,
    failed: failures.length,
    failures,
  };
  console.log(JSON.stringify(result));
  return result;
};
