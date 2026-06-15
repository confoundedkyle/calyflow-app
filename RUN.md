# Run Calyflow locally

**First time on this machine?** From the project root:

```bash
npm install
npm run setup    # boots local Supabase, writes .env.local, applies migrations, seeds
npm run dev      # start the app
```

`npm run setup` needs Docker running and the Supabase CLI installed — see the
[README](README.md#local-development) for the one-time prerequisites. It's
idempotent, so re-run it any time.

**Day to day** (stack already set up):

```bash
supabase start   # boot the local Supabase stack (data persists across stop/start)
npm run dev      # start the app — it talks to your local Supabase
```

Then open http://localhost:3000 and sign in with any email — single-workspace
mode, no password. Admins come from `ADMIN_EMAILS` in `.env.local`.

## Handy

- **Studio** (browse the local DB): http://127.0.0.1:54323
- **Mailpit** (catches outgoing emails): http://127.0.0.1:54324
- Stop when done: `npm run db:stop` (keeps data) · `colima stop` (frees RAM/CPU)
- Re-seed library data after a wipe: `npm run seed`
- Reset the DB to a clean schema: `npm run db:reset`
