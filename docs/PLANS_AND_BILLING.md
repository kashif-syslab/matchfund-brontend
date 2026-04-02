# Plans, match limits & Stripe (MatchFund)

All **plan names, display prices, feature bullets, and enforcement numbers** (how many matches, how many recomputes per month, which filters are allowed) live in **one backend file**:

`Backend/src/config/subscriptionPlans.js`

The database stores **which plan a user is on** plus billing state: `User.subscriptionPlan`, `subscriptionStatus`, `subscriptionExpiresAt`, and optional Stripe ids. It still does **not** store limits. When you change the JS file, restart the API so limits and catalog text update everywhere.

---

## What to edit in `subscriptionPlans.js`

For each key under `PLANS` (`free`, `starter`, `pro`, `enterprise`):

| Field | Purpose |
|--------|---------|
| `label`, `priceLabel`, `billingNote`, `description`, `features` | Shown on the Billing page (via `GET /billing/plans`). |
| `limits.maxMatchesVisible` | Max rows returned on `/matches` after filtering. `null` = unlimited. |
| `limits.maxRefreshesPerMonth` | How many times the user may run a **full recompute** per UTC calendar month. `null` = unlimited. |
| `limits.allowMinScoreFilter` | If `false`, requests with `minScore` get `403`. |
| `limits.allowCheckSizeFilter` | If `false`, requests with `checkMin` / `checkMax` get `403`. |
| `stripePriceEnv` | Name of the **environment variable** that holds the Stripe **Price ID** (not the secret key). Use `null` for plans that are not sold via Checkout (e.g. Free). |

**Usage counters** (recomputes this month) are stored on the user document: `billingPeriodKey` (`YYYY-MM` UTC) and `matchRefreshCount`. You normally do not edit these by hand.

Paid plans also track:

- `subscriptionStatus` (`manual`, `trialing`, `active`, `past_due`, etc.)
- `subscriptionExpiresAt` (end of current paid period)
- `stripeCustomerId`
- `stripeSubscriptionId`
- `subscriptionCheckedAt` (last Stripe sync on authenticated requests)

---

## Stripe environment variables (`Backend/.env`)

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ENTERPRISE=price_...
CLIENT_ORIGIN=http://localhost:3000
```

- Create **Products** and recurring **Prices** in the [Stripe Dashboard](https://dashboard.stripe.com/).
- Copy each Price ID into the matching `STRIPE_PRICE_*` variable named in `stripePriceEnv` for that plan.
- If `STRIPE_SECRET_KEY` or a plan’s price ID is missing, **Pay with Stripe** will not appear for that plan; `POST /billing/subscribe` can still set the plan in **development** (see API response `note`).

---

## How enforcement works

1. **`GET /matches`**  
   - With **`refresh=1`**: runs a full recompute (subject to monthly quota), then returns matches.  
   - **Without** `refresh`: returns existing scored matches from the database (no quota cost).  
   - Results are **capped** to `maxMatchesVisible` for the user’s `subscriptionPlan`.  
   - Response includes **`planUsage`** (visible count, cap, refreshes used/remaining, etc.).

2. **`GET /billing/plans`** (authenticated)  
   Returns the same catalog as defined in `subscriptionPlans.js` plus `checkoutAvailable` per plan (derived from env), along with the signed-in user’s current `subscriptionStatus` and `subscriptionExpiresAt`.

3. **Expiry / renewal sync**
   - After successful Stripe Checkout, the API stores the Stripe subscription id and current period end.
   - On later authenticated requests, the API periodically re-checks Stripe and refreshes `subscriptionStatus` / `subscriptionExpiresAt`.
   - If the paid period has ended and Stripe no longer reports an active paid state, the user is automatically downgraded to `free`.

---

## Changing prices or limits (checklist)

1. Edit `Backend/src/config/subscriptionPlans.js` (numbers and/or marketing text).  
2. If you use Stripe, create new Prices in Stripe and update `.env` price IDs.  
3. Restart the Node API.  
4. Existing users keep their current `subscriptionPlan` value; they immediately get the **new limits** for that tier.

---

## Razorpay

Razorpay has been removed. Only Stripe (or local dev plan switching without Stripe) is supported.
