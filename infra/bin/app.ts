#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { EmailStack } from "../lib/email-stack";

const app = new cdk.App();

// --- Fill these in for your own setup (or pass via `-c key=value`) ---
const fromEmail = app.node.tryGetContext("fromEmail") || "you@yourdomain.com";
const sendingDomain = app.node.tryGetContext("sendingDomain") || "yourdomain.com";
const allowedOrigin =
  app.node.tryGetContext("allowedOrigin") || "https://your-project.pages.dev";
const unsubscribeBaseUrl =
  app.node.tryGetContext("unsubscribeBaseUrl") ||
  "https://your-project.pages.dev/unsubscribe.html";
const adminApiSecret = app.node.tryGetContext("adminApiSecret");
if (!adminApiSecret) {
  throw new Error(
    "Missing -c adminApiSecret=<value>. Generate one with: openssl rand -hex 32"
  );
}

new EmailStack(app, "BulkEmailToolStack", {
  fromEmail,
  sendingDomain,
  allowedOrigin,
  unsubscribeBaseUrl,
  adminApiSecret,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
