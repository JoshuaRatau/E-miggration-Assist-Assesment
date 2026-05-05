import twilio from "twilio";

const authToken = process.env.TWILIO_AUTH_TOKEN;
if (!authToken) { console.error("no token"); process.exit(1); }

const url = "https://localhost/api/webhooks/whatsapp";
const messageSid = "SMtwiliotest" + Date.now();
const params = {
  From: "whatsapp:+27739395126",
  To: process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886",
  Body: "done — uploading documents now",
  MessageSid: messageSid,
  AccountSid: process.env.TWILIO_ACCOUNT_SID || "AC0",
  NumMedia: "0",
};

// twilio.validateRequest does the same SHA1 + base64 dance internally.
// We need the SAME helper to compute the signature. The webhooks module
// exports getExpectedTwilioSignature.
const { getExpectedTwilioSignature } =
  await import("twilio/lib/webhooks/webhooks.js");
const sig = getExpectedTwilioSignature(authToken, url, params);
console.log("MessageSid:", messageSid);
console.log("Signature head:", sig.slice(0, 16) + "...");

const formBody = new URLSearchParams(params).toString();
const r = await fetch("http://localhost:80/api/webhooks/whatsapp", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Twilio-Signature": sig,
    "Host": "localhost",
  },
  body: formBody,
});
console.log("HTTP", r.status, "body:", (await r.text()).slice(0, 80));
