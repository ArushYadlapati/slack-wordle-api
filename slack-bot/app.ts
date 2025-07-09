import { App, LogLevel } from '@slack/bolt';
import dotenv from 'dotenv';
dotenv.config();

const app = new App({
    signingSecret: process.env.SLACK_BOT_SIGNING_SECRET,
    logLevel: LogLevel.INFO,
    clientId: process.env.SLACK_BOT_CLIENT_ID,
    clientSecret: process.env.SLACK_BOT_CLIENT_SECRET,
    stateSecret: process.env.SLACK_BOT_SIGNING_SECRET,
    scopes: [
        "channels:history",
        "groups:history",
        "im:history",
        "mpim:history",
        "chat:write",
        "chat:write.public"
    ],
    installerOptions: {
        redirectUriPath: "/slack/oauth_redirect",
        installPath: "/slack/install",
    }
});

app.command("/get-timestamp", async ({ command, ack, client, respond }) => {
    await ack();
    try {
        const history = await client.conversations.history({
            channel: command.channel_id,
            limit: 1
        });

        const message = history.messages?.[0];
        const ts = message?.ts;
        const date = ts ? new Date(parseFloat(ts) * 1000).toISOString() : "N/A";

        await respond(`${ date }`);
    } catch (error) {
        console.error(error);
    }
});

(async () => {
    await app.start(3001);
    console.log("ready");
    console.log("bolt is hopefully running on localhost:3001")
})();