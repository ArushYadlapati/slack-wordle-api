import { Hono } from "hono"
import { handle } from "hono/vercel"
import { cors } from "hono/cors"
import type { Context } from "hono"
import { MongoClient } from "mongodb"

import schedule from "node-schedule"

import dotenv from 'dotenv';
dotenv.config({
    path: './.env'
});

const app = new Hono().basePath("/api");

const MONGO_LEADERBOARD_URI = process.env.MONGO_LEADERBOARD_URI || "";
const MONGO_LEADERBOARD_DB_NAME = process.env.MONGO_LEADERBOARD_DB_NAME || "";
const MONGO_LEADERBOARD_COLLECTION_NAME = process.env.MONGO_LEADERBOARD_COLLECTION_NAME || "";

const MONGO_USERS_URI = process.env.MONGO_USERS_URI || "";
const MONGO_USERS_DB_NAME = process.env.MONGO_USERS_DB_NAME || "";
const MONGO_USERS_COLLECTION_NAME = process.env.MONGO_USERS_COLLECTION_NAME || "";

let mongoClient: MongoClient | null = null;
async function getMongoClient() {
    if (!mongoClient) {
        mongoClient = new MongoClient(MONGO_LEADERBOARD_URI);
        await mongoClient.connect();
    }
    return mongoClient;
}
async function getLeaderboardCollection() {
    const client = await getMongoClient();
    return client.db(MONGO_LEADERBOARD_DB_NAME).collection(MONGO_LEADERBOARD_COLLECTION_NAME);
}

let mongoUsersClient: MongoClient | null = null;
async function getUsersCollection() {
    if (!mongoUsersClient) {
        mongoUsersClient = new MongoClient(MONGO_USERS_URI);
        await mongoUsersClient.connect();
    }
    return mongoUsersClient.db(MONGO_USERS_DB_NAME).collection(MONGO_USERS_COLLECTION_NAME);
}

// --- Scheduled DB clearing at PST midnight ---
schedule.scheduleJob("0 0 * * *", { tz: "America/Los_Angeles" }, async () => {
    try {
        if (mongoClient) {
            const leaderboardCol = await getLeaderboardCollection();
            await leaderboardCol.deleteMany({});
        }
        if (mongoUsersClient) {
            const usersCol = await getUsersCollection();
            await usersCol.deleteMany({});
        }
        console.log("Leaderboard and users DBs cleared at PST midnight.");
    } catch (e) {
        console.error("Failed to clear DBs at PST midnight.", e);
    }
});

app.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
}))

app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
        url.pathname = url.pathname.slice(0, -1);
        return c.redirect(url.toString(), 308);
    }
    await next();
})

app.get("/", (c: Context) => {
    return c.json({
        message: "Wordle Game API",
        timezone: "America/Los_Angeles (PST/PDT, UTC-8 by default)",
    });
})

// --- Utility functions for wordle logic (unchanged) ---
async function getWord(timestamp?: string | number | Date) {
    let date: string;

    if (timestamp) {
        if (typeof timestamp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(timestamp)) {
            date = timestamp;
        } else if (typeof timestamp === "string" || typeof timestamp === "number") {
            const newTimestamp = new Date(Number.isNaN(+timestamp) ? timestamp : +timestamp);
            if (isNaN(newTimestamp.getTime())) throw new Error("Timestamp parameter format is invalid: 400");
            const options: Intl.DateTimeFormatOptions = {
                timeZone: "America/Los_Angeles",
                year: "numeric", month: "2-digit", day: "2-digit"
            };
            const [month, day, year] = new Intl.DateTimeFormat("en-US", options)
                .format(newTimestamp)
                .split("/");
            date = `${ year }-${ month.padStart(2, "0") }-${ day.padStart(2, "0") }`;
        } else if (timestamp instanceof Date) {
            const options: Intl.DateTimeFormatOptions = {
                timeZone: "America/Los_Angeles",
                year: "numeric", month: "2-digit", day: "2-digit"
            };
            const [month, day, year] = new Intl.DateTimeFormat("en-US", options)
                .format(timestamp)
                .split("/");
            date = `${ year }-${ month.padStart(2, "0") }-${ day.padStart(2, "0") }`;
        } else {
            throw new Error("Invalid timestamp parameter type: 400");
        }
    } else {
        const now = new Date();
        const options: Intl.DateTimeFormatOptions = {
            timeZone: "America/Los_Angeles",
            year: "numeric", month: "2-digit", day: "2-digit"
        };
        const [month, day, year] = new Intl.DateTimeFormat("en-US", options)
            .format(now)
            .split("/");
        date = `${ year }-${ month.padStart(2, "0") }-${ day.padStart(2, "0") }`;
    }

    const res = await fetch(`https://www.nytimes.com/svc/wordle/v2/${ date }.json`);
    if (!res.ok) throw new Error(`Failed to fetch word: ${ res.status } ${ res.statusText }`);
    const data = await res.json();
    return { data, date };
}

async function getValidWords() {
    const res = await fetch (
        `https://gist.githubusercontent.com/dracos/dd0668f281e685bad51479e5acaadb93/raw/6bfa15d263d6d5b63840a8e5b64e04b382fdb079/valid-wordle-words.txt`
    );
    if (!res.ok) throw new Error(`Failed to fetch words list: ${ res.status } ${ res.statusText }`);
    return (await res.text())
        .split("\n")
        .map((word) => word.trim())
        .filter((word) => word !== "")
        .map((word) => word.toLowerCase());
}

function cleanWord(word: string) {
    word = word.toLowerCase().trim();
    if (word.length !== 5) throw new Error("Guess parameter length is invalid: 400");
    if (!/^[a-z]+$/.test(word)) throw new Error("Guess must contain only letters: 400");
    return word;
}

function checkWord(gL: string[], sL: string[], sY: boolean[]) {
    let result: number[] = [];
    for (let i = 0; i < 5; i++) {
        if (gL[i] === sL[i]) {
            result[i] = 0;
            sY[i] = true;
        } else {
            result[i] = 2;
        }
    }
    for (let i = 0; i < 5; i++) {
        if (result[i] === 2) {
            for (let j = 0; j < 5; j++) {
                if (!sY[j] && gL[i] === sL[j]) {
                    result[i] = 1;
                    sY[j] = true;
                    break;
                }
            }
        }
    }
    return result;
}

function handleError(c: Context, error: Error) {
    if (error.message.includes(": 400")) {
        const message = error.message.replace(": 400", "");
        return c.json({
            error: "Bad Request",
            details: message
        }, 400);
    }
    let errorMessage = "Internal Server Error: 500";
    errorMessage += " " + error.message;
    return c.json({
        error: "Internal Server Error",
        details: errorMessage
    }, 500);
}

function calculateScore(guesses: number[][]): number {
    let hasAnyGreen = false;
    let totalGreen = 0;
    let totalYellow = 0;
    for (const guess of guesses) {
        for (const val of guess) {
            if (val === 0) {
                hasAnyGreen = true;
                totalGreen += 1;
            }
            if (val === 1) {
                totalYellow += 1;
            }
        }
    }
    if (!hasAnyGreen) return 0;
    let winIndex = guesses.findIndex(g => g.every(x => x === 0));
    if (winIndex !== -1) {
        switch (winIndex + 1) {
            case 1: return 1000;
            case 2: return 900;
            case 3: return 800;
            case 4: return 700;
            case 5: return 600;
            case 6: return 500;
            default: return 500 - (winIndex + 1 - 6) * 50;
        }
    }
    let partial = totalGreen * 10 + totalYellow * 4;
    return Math.min(partial, 400);
}

// --- API for Slack bot to submit guess ---
app.post("/slack-guess", async (c: Context) => {
    try {
        const { userId, guess, timestamp } = await c.req.json();

        if (!userId || !guess) {
            return c.json({ error: "Missing userId or guess" }, 400);
        }
        const word = cleanWord(guess);
        const { data, date } = await getWord(timestamp);

        // Validate word
        const validWords = await getValidWords();
        if (!validWords.includes(word)) {
            return c.json({ error: `Word '${word}' is not a valid Wordle guess.` }, 400);
        }

        const usersCol = await getUsersCollection();
        let userEntry = await usersCol.findOne({ userId, date });
        let guessesArr = userEntry?.guesses || [];

        // Don't allow more than 6 guesses
        if (guessesArr.length >= 6) {
            return c.json({
                response_type: "ephemeral",
                text: "You've already used all 6 guesses for today!"
            }, 200);
        }

        const solution = data.solution.toLowerCase();
        const sL = solution.split("");
        const gL = word.split("");
        const sY = new Array(5).fill(false);

        const result = checkWord(gL, sL, sY);
        guessesArr.push(result);

        // Update guesses in DB
        await usersCol.updateOne(
            { userId, date },
            { $set: { userId, date, guesses: guessesArr } },
            { upsert: true }
        );

        // If completed (win or 6 guesses used), add to leaderboard
        let win = result.every(x => x === 0);
        if (win || guessesArr.length >= 6) {
            const leaderboardCol = await getLeaderboardCollection();
            await leaderboardCol.updateOne(
                { userId, date },
                { $set: { userId, date, score: calculateScore(guessesArr), guesses: guessesArr } },
                { upsert: true }
            );
        }

        // Format grid for Slack
        const emoji = [":large_green_square:", ":large_yellow_square:", ":white_large_square:"];
        const blocks = guessesArr.map((guess: number[]) => ({
            type: "section",
            text: { type: "mrkdwn", text: guess.map((val: number) => emoji[val]).join("") }
        }));


        let doneMsg = "";
        if (win) {
            doneMsg = `:tada: <@${userId}> solved today's Wordle in ${guessesArr.length} guess${guessesArr.length > 1 ? "es" : ""}!`;
        } else if (guessesArr.length >= 6) {
            doneMsg = `:no_entry: <@${userId}> used all guesses. Try again tomorrow!\n*Solution:* \`${solution}\``;
        } else {
            doneMsg = `Guess submitted. You have used ${guessesArr.length}/6 guesses.`;
        }

        blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: doneMsg }]
        });

        return c.json({
            response_type: "in_channel",
            blocks
        });

    } catch (error) {
        return handleError(c, error as Error);
    }
});

// --- (Other endpoints remain unchanged, including leaderboard/viewAll etc) ---

app.get("/game/leaderboard/viewAll", async (c: Context) => {
    try {
        const timestamp = c.req.query("timestamp");
        const { date } = await getWord(timestamp); // This normalizes the date

        const collection = await getLeaderboardCollection();
        const scores = await collection
            .find({ date })
            .sort({ score: -1 })
            .limit(5)
            .toArray();

        return c.json({
            date,
            leaderboard: scores.map(({ userId, score, guesses }) => ({
                userId,
                score,
                guessesCount: guesses.length,
            }))
        });
    } catch (error) {
        return handleError(c, error as Error);
    }
});

app.get("/game/leaderboard/view", async (c: Context) => {
    try {
        const userId = c.req.query("userId");
        if (!userId) {
            return c.json({ error: "Missing parameter userId" }, 400);
        }
        const timestamp = c.req.query("timestamp");
        const { date } = await getWord(timestamp);

        const collection = await getLeaderboardCollection();
        const entry = await collection.findOne({ date, userId });

        if (!entry) {
            return c.json({ userId, date, score: null, guesses: null, message: "No score found" });
        }

        return c.json({
            userId,
            date,
            score: entry.score,
            guesses: entry.guesses
        });
    } catch (error) {
        return handleError(c, error as Error);
    }
});

app.post("/game/leaderboard/add", async (c: Context) => {
    try {
        const { userId, guesses, timestamp } = await c.req.json();

        if (!userId || !guesses || !Array.isArray(guesses)) {
            return c.json({ error: "Missing parameters. Required: userId, guesses (number[][])" }, 400);
        }
        const { date } = await getWord(timestamp);

        const score = calculateScore(guesses);

        const collection = await getLeaderboardCollection();
        await collection.updateOne(
            { userId, date },
            { $set: { userId, date, score, guesses } },
            { upsert: true }
        );

        return c.json({
            message: "Score added/updated.",
            userId,
            date,
            score
        });
    } catch (error) {
        return handleError(c, error as Error);
    }
});

// (Other endpoints such as /game/check, /game/valid, etc. unchanged...)

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const OPTIONS = handler;