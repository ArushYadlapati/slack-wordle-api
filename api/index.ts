import { Hono } from "hono"
import { handle } from "hono/vercel"
import { cors } from "hono/cors"
import type { Context } from "hono"
import { MongoClient } from "mongodb"

const app = new Hono().basePath("/api");

const MONGO_URI = process.env.MONGO_URI || "";
const DB_NAME = process.env.MONGO_DB_NAME || "";
const COLLECTION_NAME = process.env.MONGO_URI || "";

let mongoClient: MongoClient | null = null;
async function getMongoClient() {
    if (!mongoClient) {
        mongoClient = new MongoClient(MONGO_URI);
        await mongoClient.connect();
    }
    return mongoClient;
}
async function getLeaderboardCollection() {
    const client = await getMongoClient();
    return client.db(DB_NAME).collection(COLLECTION_NAME);
}

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
        endpoints: [{
                path: "api/wordle",
                description: "API Methods to get basic Wordle info",
                usage: "GET /api/wordle?timestamp=yyyy-mm-dd"
            },
            {
                path: "api/game",
                description: "API Methods for the Wordle Game",
                usage: "GET /api/game"
            },
            {
                path: "api/game/leaderboard/viewAll",
                description: "View top 5 leaderboard scores for the day",
                usage: "GET /api/game/leaderboard/viewAll?timestamp=yyyy-mm-dd"
            },
            {
                path: "api/game/leaderboard/view",
                description: "View the current user's score for the day",
                usage: "GET /api/game/leaderboard/view?userId=USER_ID&timestamp=yyyy-mm-dd"
            },
            {
                path: "api/game/leaderboard/add",
                description: "Add a score to the leaderboard",
                usage: "POST /api/game/leaderboard/add"
            }
        ]
    });
})

async function getWord(timestamp?: string | number | Date) {
    let date: string;

    if (timestamp) {
        if (typeof timestamp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(timestamp)) {
            date = timestamp;
        } else if (typeof timestamp === "string" || typeof timestamp === "number") {
            const newTimestamp = new Date(Number.isNaN(+timestamp) ? timestamp : +timestamp);

            if (isNaN(newTimestamp.getTime())) {
                throw new Error("Timestamp parameter format is invalid: 400");
            }

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

    if (!res.ok) {
        throw new Error(`Failed to fetch word: ${ res.status } ${ res.statusText }`);
    }

    const data = await res.json();
    return { data, date };
}

async function getValidWords() {
    const res = await fetch (
        `https://gist.githubusercontent.com/dracos/dd0668f281e685bad51479e5acaadb93/raw/6bfa15d263d6d5b63840a8e5b64e04b382fdb079/valid-wordle-words.txt`
    );

    if (!res.ok) {
        throw new Error(`Failed to fetch words list: ${ res.status } ${ res.statusText }`);
    }

    return (await res.text())
        .split("\n")
        .map((word) => word.trim())
        .filter((word) => word !== "")
        .map((word) => word.toLowerCase());
}

function cleanWord(word: string) {
    word = word.toLowerCase().trim();

    if (word.length !== 5) {
        throw new Error("Guess parameter length is invalid: 400");
    }

    if (!/^[a-z]+$/.test(word)) {
        throw new Error("Guess must contain only letters: 400");
    }

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

export function calculateScore(guesses: number[][]): number {
    // If user never gets any correct (all squares always 2), return 0
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

    if (!hasAnyGreen) {
        return 0;
    }

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

app.get("/wordle/:field?", async (c: Context) => {
    try {
        const field = c.req.param("field");
        const timestamp = c.req.query("timestamp");
        const { data } = await getWord(timestamp);

        const allowedFields = {
            solution: data.solution,
            date: data.print_date,
            day: data.days_since_launch
        };

        if (!field) {
            return c.json(allowedFields);
        }

        if (!(field in allowedFields)) {
            return c.json({
                error: `Invalid field requested: ${ field }`
            }, 400);
        }

        return c.json({
            [field]: allowedFields[
                field as keyof typeof allowedFields
                ]
        });
    } catch (error) {
        return handleError(c, error as Error);
    }
});

app.get("/game", async (c: Context) => {

    return c.json({
        message: "Wordle Game API endpoints",
        timezone: "America/Los_Angeles (PST/PDT/UTC-8 by default)",
        endpoints: [{
                path: "/valid",
                description: "Check if a word is valid (5 letters and in dictionary)",
                usage: "GET /api/game/valid?word=WORDS"
            },
            {
                path: "/check",
                description: "Check a guess against today's Wordle solution (default timezone is PST/PDT/UTC-8)",
                usage: "GET /api/game/check?word=WORDS&timestamp=yyyy-mm-dd"
            },
            {
                path: "/playGame",
                description: "Shows a current Wordle game with previous guesses",
                usage: "GET /api/game/playGame?word=WORDS&guesses=[[0,1,2,1,0],[2,2,1,0,0]]&timestamp=yyyy-mm-dd"
            },
            {
                path: "/leaderboard/viewAll",
                description: "View top 5 scores for the day",
                usage: "GET /api/game/leaderboard/viewAll?timestamp=yyyy-mm-dd"
            },
            {
                path: "/leaderboard/view",
                description: "View current user's score",
                usage: "GET /api/game/leaderboard/view?userId=USER_ID&timestamp=yyyy-mm-dd"
            },
            {
                path: "/leaderboard/add",
                description: "Add a score to leaderboard",
                usage: "POST /api/game/leaderboard/add"
            }
        ]
    });
})

app.get("/game/valid", async (c: Context) => {
    try {
        let word = c.req.query("word");

        if (!word) {
            return c.json({
                error: "Missing parameter word"
            }, 400);
        }

        word = cleanWord(word);

        const valid = (await getValidWords()).includes(word);

        return c.json({
            word,
            valid
        });
    } catch (error) {
        return handleError(c, error as Error);
    }
})

app.get("/game/check", async (c: Context) => {
    try {
        let word = c.req.query("word") || "";
        const timestamp = c.req.query("timestamp");

        if (!word) {
            return c.json({
                error: "Missing parameter word"
            }, 400);
        }

        word = cleanWord(word);

        const solution = (await getWord(timestamp)).data.solution.toLowerCase();

        const sL = solution.split("");
        const gL = word.split("");
        const sY = new Array(5).fill(false);

        const result = checkWord(gL, sL, sY);

        return c.json({
            guess: word,
            correct: solution === word,
            result
        })
    }

    catch (error) {
        return handleError(c, error as Error);
    }
})

app.get("/game/playGame", async (c: Context) => {
    try {
        let word = c.req.query("word") || "";
        const prevGuesses = c.req.query("guesses") || "";
        const timestamp = c.req.query("timestamp");

        if (!word) {
            return c.json({
                error: "Missing parameter `word`"
            }, 400);
        }

        if (!prevGuesses) {
            return c.json({
                error: "Missing parameter `guesses`"
            }, 400);
        }

        let guesses: number[][];

        try {
            guesses = JSON.parse(prevGuesses as string);
        } catch (parseError) {
            return c.json({
                error: "Parameter `guesses` should be a JSON array."
            }, 400);
        }

        if (!Array.isArray(guesses) || !guesses.every(row => Array.isArray(row))) {
            return c.json({
                error: "Parameter `guesses` should be a 2D array."
            }, 400);
        }

        word = cleanWord(word);

        const solution = (await getWord(timestamp)).data.solution.toLowerCase();

        const sL = solution.split("");
        const gL = word.split("");
        const sY = new Array(5).fill(false);

        const result = checkWord(gL, sL, sY);

        const updatedGuesses = [...guesses, result];

        return c.json({
            guesses: updatedGuesses,
            currentGuess: result,
            isComplete: result.every(r => r === 0)
        });

    } catch (error) {
        return handleError(c, error as Error);
    }
});

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const OPTIONS = handler;