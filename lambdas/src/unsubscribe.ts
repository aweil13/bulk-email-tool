import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { UnsubscribeResponseBody } from "@bulk-email-tool/shared";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME as string;

function json(statusCode: number, body: UnsubscribeResponseBody): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * GET /unsubscribe?email=...&token=...
 *
 * The token check is what stops a stranger from unsubscribing someone
 * else just by guessing their email address — it must match the token
 * that was embedded in the link we actually sent that subscriber.
 */
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> => {
  const email = event.queryStringParameters?.email?.trim().toLowerCase();
  const token = event.queryStringParameters?.token;

  if (!email || !token) {
    return json(400, { ok: false, message: "Missing email or token." });
  }

  const existing = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { email } })
  );

  if (!existing.Item) {
    return json(404, { ok: false, message: "No such subscriber." });
  }

  if (existing.Item.unsubscribeToken !== token) {
    return json(403, { ok: false, message: "Invalid unsubscribe link." });
  }

  if (existing.Item.subscribed === false) {
    return json(200, { ok: true, message: "You were already unsubscribed." });
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { email },
      UpdateExpression: "SET subscribed = :false",
      ExpressionAttributeValues: { ":false": false },
    })
  );

  return json(200, { ok: true, message: "You've been unsubscribed." });
};
