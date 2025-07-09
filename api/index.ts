import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import type { Context } from 'hono'


const app = new Hono().basePath("/api");

app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
        url.pathname = url.pathname.slice(0, -1);
        return c.redirect(url.toString(), 308);
    }
    await next();
})

app.get("/", (c: Context) => {
    return c.json({ message: "Wordle API for Slack" })
})

async function getWord() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const date = `${year}-${month}-${day}`;

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
        .filter((word) => word.trim() !== "")
        .map(word => word.trim().toLowerCase());
}

function error500Message(c: Context, error: Error) {
    let errorMessage = "Internal Server Error";

    errorMessage += " " + error.message;

    return c.json({
        error: "Internal Server Error",
        details: errorMessage
    }, 500);
}

app.get("/wordle/:field?", async (c: Context) => {
    try {
        const field = c.req.param("field");
        const { data, date } = await getWord();

        const allowedFields = {
            solution: data.solution,
            date: data.print_date,
            day: data.days_since_launch
        };

        if (!field) {
            return c.json(allowedFields);
        }

        if (!(field in allowedFields)) {
            return c.json({ error: `Invalid field requested: ${field}` }, 400);
        }

        return c.json({ [field]: allowedFields[field as keyof typeof allowedFields] });
    } catch (error) {
        error500Message(c, error as Error);
    }
});

app.get("/game", async (c: Context) => {
    const baseUrl = new URL(c.req.url).origin;
    const basePath = "/api/game";

    return c.json({});
})

app.get("/game/valid", async (c: Context) => {
    try {
        let word = c.req.query("word");

        if (!word) {
            return c.json({error: "Missing parameter"}, 400);
        }

        word = word.toLowerCase().trim();
        
    } catch (error) {
        error500Message(c, error as Error);
    }
})

app.get("/game/check", async (c: Context) => {
    try {
        let guess = c.req.query("guess");

        if (!guess) {
            return c.json({error: "Missing parameter"}, 400);
        }

        guess = guess.toLowerCase().trim();

        if (guess.length !== 5) {
            return c.json({}, 400);
        }

        if (!/^[a-z]+$/.test(guess)) {
            return c.json({}, 400);
        }

        const solution = (await getWord()).data.solution.toLowerCase();

        const result: number[] = [];
        const sL = solution.split("")
        const gL = guess.split("");
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
            guess,
            solution,
            result
        })

    } catch (error) {
        error500Message(c, error as Error);
    }
})

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const OPTIONS = handler;