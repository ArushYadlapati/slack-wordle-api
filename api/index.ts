import { Hono } from "hono"
import { handle } from "hono/vercel"
import { cors } from 'hono/cors'
import type { Context } from "hono"

const app = new Hono().basePath("/api");

app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
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
        message: "Wordle API for Slack"
    });
})

async function getWord(timestamp?: string | number | Date) {
    let now: Date;

    if (timestamp) {
        if (typeof timestamp === "string" || typeof timestamp === "number") {
            const ts = new Date(Number.isNaN(+timestamp) ? timestamp : +timestamp);
            if (isNaN(ts.getTime())) {
                throw new Error("Invalid timestamp format: 400");
            }
            now = ts
        } else if (timestamp instanceof Date) {
            now = timestamp;
        } else {
            throw new Error("Invalid timestamp parameter type: 400");
        }
    } else {
        now = new Date();
    }

    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const date = `${ year }-${ month }-${ day }`;

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
        endpoints: [{
                path: "/valid",
                description: "Check if a word is valid (5 letters and in dictionary)",
                usage: "GET /api/game/valid?word=WORDS"
            },
            {
                path: "/check",
                description: "Check a guess against today's word",
                usage: "GET /api/game/check?word=WORDS"
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
            return c.json({ error: "Missing parameter word" }, 400);
        }

        word = cleanWord(word);

        const solution = (await getWord(timestamp)).data.solution.toLowerCase();

        const result: number[] = [];
        const sL = solution.split("");
        const gL = word.split("");
        const sY = new Array(5).fill(false);

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

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const OPTIONS = handler;