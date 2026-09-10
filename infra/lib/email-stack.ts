import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as ses from "aws-cdk-lib/aws-ses";
import * as path from "path";

export interface EmailStackProps extends cdk.StackProps {
  /** Verified SES "From" address, e.g. newsletter@yourdomain.com */
  fromEmail: string;
  /** Domain you'll verify in SES for DKIM/SPF sending */
  sendingDomain: string;
  /** Origin allowed to call the API (your Cloudflare Pages URL) */
  allowedOrigin: string;
  /** Full URL of the unsubscribe confirmation page on your frontend */
  unsubscribeBaseUrl: string;
  /**
   * Shared secret the admin compose page must send as x-admin-key to
   * trigger a campaign send. Generate with `openssl rand -hex 32`.
   */
  adminApiSecret: string;
  /**
   * Optional Reply-To address applied to every campaign email, so replies
   * reach a monitored human mailbox even when From is a sending/no-reply
   * address. Omit to send with no Reply-To header.
   */
  replyToEmail?: string;
}

export class EmailStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);

    // --- Data store -------------------------------------------------
    const table = new dynamodb.Table(this, "SubscribersTable", {
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // free-tier friendly, no capacity to manage
      removalPolicy: cdk.RemovalPolicy.RETAIN, // don't lose subscriber data on `cdk destroy`
    });

    // --- SES sending domain identity ---------------------------------
    // Verifies the domain and sets up DKIM. You still need to add the
    // resulting CNAME records at your DNS provider after first deploy
    // (see stack outputs) and request SES production access before
    // sending to unverified recipients.
    new ses.EmailIdentity(this, "SendingDomainIdentity", {
      identity: ses.Identity.domain(props.sendingDomain),
    });

    const lambdaEnv = {
      TABLE_NAME: table.tableName,
    };

    const nodeJsFnDefaults: Partial<lambdaNode.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"], // provided by the Lambda Node.js runtime
      },
      timeout: cdk.Duration.seconds(10),
    };

    // --- Lambda: GET /unsubscribe -------------------------------------
    const unsubscribeFn = new lambdaNode.NodejsFunction(this, "UnsubscribeFunction", {
      ...nodeJsFnDefaults,
      entry: path.join(__dirname, "../../lambdas/src/unsubscribe.ts"),
      environment: lambdaEnv,
    });
    table.grantReadWriteData(unsubscribeFn);

    // --- Lambda: send campaign (invoked manually, not via API) --------
    const sendFn = new lambdaNode.NodejsFunction(this, "SendCampaignFunction", {
      ...nodeJsFnDefaults,
      entry: path.join(__dirname, "../../lambdas/src/send.ts"),
      timeout: cdk.Duration.minutes(10), // enough headroom for ~1500 recipients with a send delay
      environment: {
        ...lambdaEnv,
        FROM_EMAIL: props.fromEmail,
        UNSUBSCRIBE_BASE_URL: props.unsubscribeBaseUrl,
        ...(props.replyToEmail ? { REPLY_TO_EMAIL: props.replyToEmail } : {}),
      },
    });
    table.grantReadData(sendFn);
    sendFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: ["*"],
      })
    );

    // --- Lambda: POST /campaigns (admin-only trigger) -----------------
    // Validates the admin secret, then invokes sendFn asynchronously so
    // the API response isn't bound by API Gateway's 29s request timeout.
    const triggerCampaignFn = new lambdaNode.NodejsFunction(this, "TriggerCampaignFunction", {
      ...nodeJsFnDefaults,
      entry: path.join(__dirname, "../../lambdas/src/trigger-campaign.ts"),
      environment: {
        SEND_FUNCTION_NAME: sendFn.functionName,
        ADMIN_API_SECRET: props.adminApiSecret,
      },
    });
    sendFn.grantInvoke(triggerCampaignFn);

    // --- HTTP API (API Gateway v2) -------------------------------------
    const httpApi = new apigwv2.HttpApi(this, "EmailApi", {
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
        allowHeaders: ["Content-Type", "x-admin-key"],
      },
    });

    httpApi.addRoutes({
      path: "/unsubscribe",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "UnsubscribeIntegration",
        unsubscribeFn
      ),
    });

    httpApi.addRoutes({
      path: "/campaigns",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "TriggerCampaignIntegration",
        triggerCampaignFn
      ),
    });

    // --- Outputs ---------------------------------------------------
    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "SendCampaignFunctionName", { value: sendFn.functionName });
    new cdk.CfnOutput(this, "SubscribersTableName", { value: table.tableName });
  }
}
