# loom-telegram-orders (retired)

This Worker used to relay configurator orders to the Telegram order chat. The
main backend now sends that notification itself after it saves the order, and
the storefront no longer calls this Worker.

`src/worker.js` answers every request with `410 Gone`. To retire it fully,
the owner runs from this directory:

```bash
wrangler delete            # removes the Worker and its secrets
```

Until then, deploying the current code (`wrangler deploy`) is enough to stop
it from forwarding anything.
