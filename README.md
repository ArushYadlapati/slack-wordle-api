# Wordle API

This is a simple (but fairly complete) Wordle API built with [Hono](https://hono.dev/) and deployed on Vercel.
It provides endpoints to get the daily word, check guesses, and retrieve statistics. It uses 2 Mongo DB's to store info
about the leaderboard and the user's current guesses.

## Hosting
This API is hosted entirely on Vercel, with 2 MongoDB Atlas DB's for 2 free MongoDB Atlas cluster for data storage.
https://slack-wordle-api.vercel.app/api

## Getting Started

First, run the development server:

```bash
npm install
npm run start #vercel dev will run
```

Follow the setup guide to select a Vercel project.

Open [http://localhost:3000/api](http://localhost:3000/api) with your browser to see the result.

You can start editing the API by modifying `api/index.ts` and learn more by taking a look to the [API documentation](https://hono.dev/api/hono).

## Deploy on Vercel

The easiest way to deploy your Hono app is to use the [Vercel Platform](https://vercel.com/templates?search=hono).