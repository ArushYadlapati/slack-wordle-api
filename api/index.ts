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

app.get("/wordle/:field?", async (c: Context) => {
    const field = c.req.param("field");

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const date = `${year}-${month}-${day}`;

    try {
        const res = await fetch(`https://www.nytimes.com/svc/wordle/v2/${date}.json`);

        if (!res.ok) {
            return c.json({ error: `Failed to fetch Wordle data for ${date}` }, 400);
        }

        const data = await res.json();

        const allowedFields = {
            solution: data.solution,
            date: data.print_date,
            day: data.days_since_launch
        };

        if (!field) {
            return c.json(allowedFields);
        }

        if (!(field in allowedFields)) {
            return c.json({ error: `Invalid field requested: ${ field}` }, 400);
        }

        return c.json({ [field]: allowedFields[field as keyof typeof allowedFields] });
    }
    catch (error) {
        let errorMessage = "Internal Server Error";

        if (error instanceof Error) {
            errorMessage += " " + error.message;
        }

        return c.json({
            error: "Internal Server Error",
            details: errorMessage
        }, 500);
    }
});


const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const OPTIONS = handler;