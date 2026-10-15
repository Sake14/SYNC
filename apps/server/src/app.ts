import express from 'express';

export function createApp() {
    const app = express();

    app.get("/health", (req, res) => {
        res.json({ status: "ok"});
    })

    return app;
}