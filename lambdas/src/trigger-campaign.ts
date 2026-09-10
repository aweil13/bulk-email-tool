import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { SendCampaignRequestBody, SendCampaignResponseBody } from "@bulk-email-tool/shared";

const lambda = new LambdaClient({});
const SEND_FUNCTION_NAME = process.env.SEND_FUNCTION_NAME as string;
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET as string;

function json(
  statusCode: number,
  body: SendCampaignResponseBody
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * POST /campaigns
 * Headers: x-admin-key: <ADMIN_API_SECRET>
 * Body: { subject, html, text?, listName? }
 *
 * This is the endpoint the admin compose page calls. It does two things
 * and nothing else:
 *   1. Checks the shared admin secret — anyone without it gets a 401.
 *   2. Fires off the real send.ts Lambda asynchronously (InvocationType
 *      "Event") and returns immediately, since a full campaign can take
 *      several minutes and API Gateway's HTTP API hard-caps requests at
 *      29 seconds.
 *
 * Security note: the admin secret is shipped to the browser as a Vite env
 * var and sent as a header, so it's visible to anyone who can load the
 * admin page's compiled JS. That's an acceptable tradeoff here because
 * Cloudflare Access already restricts who can load that page at all — the
 * secret's real job is stopping someone who finds the raw API URL without
 * going through Access. It is NOT a substitute for Access; don't remove
 * the Access policy on the site and rely on this alone.
 */
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> => {
  const providedKey = event.headers?.["x-admin-key"] ?? event.headers?.["X-Admin-Key"];
  if (!ADMIN_API_SECRET || providedKey !== ADMIN_API_SECRET) {
    return json(401, { ok: false, message: "Unauthorized." });
  }

  let body: SendCampaignRequestBody;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { ok: false, message: "Invalid JSON body." });
  }

  if (!body.subject || !body.html) {
    return json(400, { ok: false, message: "'subject' and 'html' are required." });
  }

  await lambda.send(
    new InvokeCommand({
      FunctionName: SEND_FUNCTION_NAME,
      InvocationType: "Event", // fire-and-forget — don't wait for the send to finish
      Payload: Buffer.from(JSON.stringify(body)),
    })
  );

  return json(202, { ok: true, message: "Campaign queued. Sending will happen in the background." });
};
