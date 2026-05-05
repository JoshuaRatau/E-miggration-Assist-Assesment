import twilio from "twilio";

const sid = process.env.TEST_SID;
const tok = process.env.TEST_TOK;
const from = process.env.TEST_FROM;
const to = process.env.TEST_TO;

if (!sid || !tok || !from || !to) {
  console.error("missing env");
  process.exit(1);
}

console.log("SID prefix:", sid.slice(0, 4) + "..." + sid.slice(-4), "len=" + sid.length);
console.log("From:", from, "To:", to);

let client;
try {
  client = twilio(sid, tok);
} catch (e) {
  console.error("CONSTRUCTOR FAILED:", e.message);
  process.exit(2);
}

try {
  const msg = await client.messages.create({
    from,
    to,
    body:
      "Twilio migration test from E-Migration Assist. " +
      "If you see this, your account credentials and sandbox enrollment " +
      "are both working. (Reply 'done' to test the inbound webhook too.)",
  });
  console.log("SEND OK");
  console.log("  MessageSid:", msg.sid);
  console.log("  Status:", msg.status);
  console.log("  ErrorCode:", msg.errorCode ?? "(none)");
  console.log("  ErrorMessage:", msg.errorMessage ?? "(none)");
} catch (e) {
  console.log("SEND FAILED");
  console.log("  HTTP status:", e.status);
  console.log("  Twilio code:", e.code);
  console.log("  Message:", e.message);
  console.log("  More info:", e.moreInfo ?? "(none)");
}
