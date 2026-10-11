# Deploying to AWS, step by step

A self-contained runbook to take das-promos from zero to live on AWS
today, with real marketplace/publisher credentials and correctly-built
affiliate links -- not mocks. Follow it in order; Part 1 (credentials)
has the longest lead time (marketplace approval can take days), so start
it first even if you do Parts 2-3 in parallel.

If you want the broader picture (managed-services alternative, Oracle
Cloud, general checklist) see `docs/deployment.md` -- this doc is the
AWS-specific, credentials-included version of the same "cheapest path:
one VM" approach, using your existing AWS credit.

## What you'll end up with

- One AWS EC2 instance running Postgres + Redis + `apps/api` + Caddy together
  (via `infra/docker/docker-compose.prod.yml`), including the
  self-scheduled ingest → score → publish routine.
- `apps/web` (public site) and `apps/admin` (dashboard) on Vercel Pro or
  Enterprise, or another commercial-use host.
- Real Telegram posting, with a real affiliate link on every post. X can
  be enabled later when its credentials and budget are available.

## Part 0: what actually works for real affiliate links today

Read this before choosing which marketplaces to launch with -- the
providers are not all equal on this specific point.

| Marketplace | Real product data | Real affiliate link | Verdict |
|---|---|---|---|
| **Shopee** | Yes (Affiliate Open API) | Yes -- `generateShortLink` mutation returns a real tracked Shopee short link server-side | **Ready.** Include in the automated loop. |
| **Amazon** | Yes (Creators API) | Yes -- preserve the API-vended `detailPageURL` exactly; the provider validates its Brazilian Amazon host and configured `tag`, while `/go/:code` records channel attribution | **Ready after a live account check** of API access, the returned tag, destination, and price. |
| **Mercado Livre** | Yes (official API) | **No.** `buildAffiliateUrl()` deliberately throws -- Mercado Livre has no public, documented API for generating affiliate links; its affiliate program issues short links through a manual web portal. | **Not ready for the automated loop.** `SCHEDULE_MARKETPLACES` accepts only Amazon and Shopee, which have server-side affiliate-link generation. Mercado Livre offers can be ingested manually, but cannot be published through the automatic flow until a supported affiliate-link workflow exists. |

Recommendation: launch `SCHEDULE_MARKETPLACES=shopee_br` today, add
`amazon_br` once you've verified one real ingestion looks right (Part
5), and leave `mercado_livre` out of the automated loop entirely until
either Mercado Livre ships a real affiliate API or you build a manual
lookup table (a `externalId -> portal-generated short link` mapping --
see `docs/roadmap.md`'s Mercado Livre note for the shape of that).

## Part 1: get real credentials

Every subsection below tells you exactly what to click/submit as a
human, what you get back, which `.env` var it becomes, and any
prerequisite or gotcha that isn't obvious from the provider's own docs.

### 1.1 Shopee Affiliate Open API

**Prerequisite**: an approved Shopee Affiliate account for your market.
If you don't have one yet, apply at your region's affiliate portal
(e.g. `affiliate.shopee.com.br` for Brazil) -- this is a manual review
that commonly takes something like 1-2 weeks, so start it now if you
haven't.

1. Log into your **Shopee Affiliate homepage** with the approved
   account.
2. Find the **"Open API"** section/menu item on that dashboard (naming
   and exact placement can vary by region/dashboard version -- look for
   "Open API", "API Access", or "Developer" in the account/settings
   area if it's not on the main nav).
3. Your **App ID** (numeric) and **App Secret** (a long string) are
   generated/shown there -- copy both. If the section shows an
   "activate"/"create app" step instead of credentials directly, follow
   that first.
4. Set in `.env`: `SHOPEE_APP_ID` and `SHOPEE_APP_SECRET`. The real
   provider uses the Affiliate Open API's `generateShortLink` mutation
   for tracked links, so it does not require a separate affiliate ID.
   `SHOPEE_AFFILIATE_ID` is optional and only affects the development
   mock's legacy URL builder.

**Caveat** (already in `docs/providers.md`): the exact GraphQL
schema/signature format this integration uses was verified against a
third-party-hosted mirror of Shopee's docs, not an authenticated console
session directly. It's internally consistent and corroborated across
sources, but if a real call fails with a schema-shaped error (unexpected
field name, signature rejected), that's the first place to check against
your own Shopee Open API console/docs link (usually linked from the same
Open API dashboard section).

### 1.2 Mercado Livre (product data only, not affiliate links)

1. Create an application at
   https://developers.mercadolivre.com.br/devcenter -- log in with the
   account that has the affiliate/associate program, click **"Create
   application"** (or go straight to
   https://developers.mercadolivre.com.br/devcenter/new-list-app), fill
   in the form (name, description), and register a **redirect URI**.
   **Mercado Livre requires this to be HTTPS -- plain `http://`
   (including `http://localhost:...`) is rejected outright**, even
   though you only need it for a one-time code capture and it never has
   to be a real running server. Two ways to get a valid HTTPS URL today
   with zero infrastructure:
   - **ngrok** (or any similar tunnel tool): `ngrok http 8080` prints a
     free `https://xxxx.ngrok-free.app` URL immediately -- use
     `https://xxxx.ngrok-free.app/callback` as the redirect URI. Nothing
     needs to actually be listening on port 8080; you're only going to
     read the `code` param off the browser's address bar after the
     redirect (it'll look like it failed to load -- that's fine).
   - If you've already completed Part 7 (DNS + TLS) below, use a real
     path under your own domain instead, e.g.
     `https://api.yourdomain.com/oauth-callback` -- same idea, no route
     handler required, you're just reading the address bar.
   The form also asks for a **logo/icon image** -- this is just a
   display asset for the app listing, not a verified brand requirement;
   any square PNG/JPG (roughly 512x512) satisfies it, it doesn't need to
   be a real logo. Submit. This gives you an **App ID** (client id) and
   **Client Secret**, shown on the application's detail page.
2. Visit, once, in a browser, logged into that same account:
   ```
   https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=$APP_ID&redirect_uri=$REDIRECT_URI
   ```
   Click **"Authorize"**/**"Allow"** on the consent screen. You'll be
   redirected to your redirect URI (it'll look like it failed to load if
   it's not a real server -- that's fine, look at the browser's address
   bar).
3. Copy the `code` query param from that redirect URL, then exchange it
   for tokens (the code is single-use and expires quickly, so do this
   right away):
   ```bash
   curl -X POST https://api.mercadolibre.com/oauth/token \
     -H 'accept: application/json' \
     -H 'content-type: application/x-www-form-urlencoded' \
     -d 'grant_type=authorization_code' \
     -d "client_id=$APP_ID" \
     -d "client_secret=$CLIENT_SECRET" \
     -d "code=$AUTH_CODE" \
     -d "redirect_uri=$REDIRECT_URI"
   ```
   Keep the `refresh_token` from the JSON response.
4. Set in `.env`: `MERCADO_LIVRE_APP_ID`, `MERCADO_LIVRE_CLIENT_SECRET`,
   `MERCADO_LIVRE_REFRESH_TOKEN`. **Mercado Livre rotates refresh
   tokens on every use.** The app keeps the rotated value in memory but
   never logs it; before restarting, repeat the authorization-code flow
   above and update the value in `.env` and the deployment secret source.
   See `docs/providers.md` for the recovery details.

Remember: this gets you real product/price data for Mercado Livre, not
automated affiliate links (Part 0) -- there is no step that gets you
those, because Mercado Livre doesn't expose one. Useful for manual
research, not for `SCHEDULE_MARKETPLACES` today.

**Don't try to automate the affiliate portal's internal endpoints as a
workaround** (e.g. anything under
`mercadolivre.com.br/affiliate-program/api/...` you might find via
browser dev tools while manually generating a link) -- these require a
logged-in browser session, not app credentials, aren't part of Mercado
Livre's documented API, can change or disappear with zero notice, and
automating them risks the affiliate account being flagged for using an
endpoint not intended for programmatic access. Manual, one-link-at-a-time
through the portal is genuinely the only supported option today.

### 1.3 Amazon Creators API

**Prerequisite, read this first**: you need an **already-approved Amazon
Associates account**, and Amazon's eligibility rules for API access are
real and enforced, not a formality:
- **Associates application review**: Amazon says it reviews an application
  after at least 3 qualifying sales within the first 180 days. Personal
  orders do not qualify ([Amazon application review](https://affiliate-program.amazon.com/help/node/topic/G8TW5AE9XL2VX9VM)).
- **Creators API access**: Amazon's current documentation requires at
  least 10 qualifying sales in the past 30 days and says access is lost
  after 30 consecutive days without qualified referring sales
  ([Creators API prerequisites](https://affiliate-program.amazon.com/creatorsapi/docs/),
  [API rates and access](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/api-rates)).
  Check the account's current eligibility in Associates Central before
  relying on Amazon ingestion; access rules and account status can change.

If you clear that bar:

1. Go to https://affiliate-program.amazon.com/creatorsapi and register
   under your Associates account -- this is a **separate registration**
   from PA-API; old PA-API access key/secret key do **not** carry over.
2. You get a **Credential ID** (client id) and **Credential Secret**.
3. Set in `.env`: `AMAZON_CREATORS_CLIENT_ID`,
   `AMAZON_CREATORS_CLIENT_SECRET`, and keep your existing
   `AMAZON_AFFILIATE_TAG` as the `partnerTag` used in API requests and
   validated against Amazon's vended product URL.
4. **Before enabling this in the scheduled loop**, do one manual test
   ingestion (Part 5). Confirm that the API returns offers, the preserved
   `detailPageURL` contains the configured tag and lands on the intended
   Brazilian product, and the price matches Amazon. Amazon documents the
   marketplace and response fields; live credentials, tag approval, and
   product results still need to be confirmed against your account.

### 1.4 Telegram

1. Open a chat with **@BotFather** on Telegram (search for it by that
   exact handle), send `/newbot`, then answer its two prompts: a display
   name, and a username ending in `bot`.
2. BotFather replies with your **bot token**
   (`TELEGRAM_BOT_TOKEN`, format `123456789:ABCdef...`) -- copy it.
3. Open (or create) the target **group or channel**, add the bot as a
   **member**, then promote it to **admin** with at least "Post
   Messages" permission (Channel/Group settings → Administrators → Add
   Admin → search for your bot's username).
4. Get the **chat id** (`TELEGRAM_CHAT_ID`): post any message in the
   group/channel, then visit
   `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser (with
   your real token in the URL) and read the numeric `chat.id` field from
   the JSON response -- it'll be negative for groups/channels, which is
   normal, keep the minus sign. If `getUpdates` returns an empty
   `result: []`, send another message in the chat first (Telegram only
   returns updates it hasn't delivered yet) and reload. Alternatively,
   forward any message from the channel to **@userinfobot** or
   **@RawDataBot**, which reply with the chat id directly.
5. Set in `.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

### 1.5 X (Twitter)

**Cost note, read this first**: X discontinued its free developer tier
for new signups in February 2026 -- API access is now pay-per-use
(reported pricing: roughly $0.015 per post, or ~$0.20 per post if it
contains a link -- and every post this app makes contains the `/go/:code`
affiliate link). At 4 posts/day that's on the order of **$20-25/month**,
not free. Verify current pricing yourself at
https://developer.x.com/en/portal/products before committing, since this
changes periodically; budget for it either way, and skip X entirely
(leave its env vars blank; production skips the X channel) if
that cost isn't justified yet.

**Already posting to X from an n8n workflow?** If that workflow already
works, you likely already have a Consumer Key/Secret + Access
Token/Secret pair from the X Developer Portal with Read+Write access --
that's the exact same OAuth 1.0a user-context credential shape this
app's `XPublisher` uses (`packages/content-engine/src/publishers/x-publisher.ts`).
Reuse those four values directly in `.env` (step 4 below) instead of
creating a new App -- no code changes needed, and since they're already
posting successfully from n8n, whatever access tier they're on already
works, so there's nothing to re-verify about pricing/tier first.

1. Go to https://developer.x.com, sign up for developer access if you
   haven't (this now includes setting up billing for the pay-per-use
   plan), and create a **Project**, then an **App** inside that project.
2. Open the App's settings → **"User authentication settings"** → click
   **"Set up"** (or "Edit") → set **App permissions** to **"Read and
   Write"** (posting needs write access) → save. **Do this before
   generating tokens** -- tokens generated while permissions were
   Read-only keep that reduced scope even after you change the setting
   later, and you'd have to regenerate them.
3. Go to the App's **"Keys and tokens"** tab:
   - Under **"Consumer Keys"**, generate/reveal the **API Key** and
     **API Key Secret**.
   - Under **"Authentication Tokens"**, generate the **Access Token**
     and **Access Token Secret** (make sure you do this *after* step 2,
     so they're issued with Read+Write access).
4. Set in `.env`: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
   `X_ACCESS_TOKEN_SECRET`.

### 1.6 OpenRouter (optional -- AI-generated post copy)

Skip this entirely if the deterministic template copy is fine; nothing
else depends on it, and it's the one integration here with a genuinely
free tier.

1. Sign up and get a key at https://openrouter.ai/keys.
2. Pick a **currently free** model (slug ends in `:free`) from
   https://openrouter.ai/models?max_price=0 -- this list changes over
   time (models are added/retired every few months), there's no safe
   hardcoded default anywhere in this codebase on purpose.
3. Set in `.env`: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`.

## Part 2: launch the AWS EC2 instance (infrastructure as code, console-driven)

Instead of clicking through the EC2 launch wizard by hand, the instance,
its security group, and the IAM plumbing GitHub Actions needs are all
defined as CloudFormation templates in `infra/aws/` and applied for you.
The only two things you personally click through are a key pair (AWS
requires downloading its private half once, so this can't be automated)
and one CloudFormation stack -- everything after that, including the
instance itself, is created automatically by pushing to GitHub. The AWS
provisioning flow is console-driven; the optional lookup commands below
can run from your computer or AWS CloudShell.

**Prerequisite:** this small single-VM template uses the account's default
VPC and a default subnet in the selected region; it does not create a
separate VPC. Confirm a default VPC exists in the VPC console before
continuing. If it was deleted, create a default VPC in that region first.
AWS notes that CloudFormation security-group creation fails when no VPC
is specified and no default VPC exists ([security group reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-securitygroup.html));
default VPCs include public subnets and an internet gateway
([default VPC reference](https://docs.aws.amazon.com/vpc/latest/userguide/default-vpc.html)).

Before deploying the bootstrap stack, make sure the GitHub repository
already exists so you can read its immutable numeric IDs for the OIDC
trust policy. For a new repository, create it empty now (do not push the
project yet, so Actions cannot run before AWS variables are configured):

```bash
gh repo create YOUR_GITHUB_OWNER/dev-das-promos --private
gh api repos/YOUR_GITHUB_OWNER/dev-das-promos --jq '{owner_id: .owner.id, repository_id: .id}'
```

Replace `YOUR_GITHUB_OWNER` with your GitHub username or organization.
If the repository already exists, skip the create command and run only
the `gh api` command.

1. **Create a key pair** (EC2 console → **Key Pairs** → **Create key
   pair** → name it `dev-das-promos`, type `ED25519`, format `.pem` →
   **Create**). Your browser downloads the private key automatically --
   move it somewhere durable, e.g. `~/.ssh/dev-das-promos.pem`, and
   `chmod 400` it. You'll use this once in Part 3 for the initial Docker
   install; after that, GitHub Actions deploys over SSM, not SSH.

2. **Find your public IP** (visit https://whatismyip.com) so SSH access
   can be locked to just you, e.g. `203.0.113.42/32`.

3. **Deploy the one-time bootstrap stack** -- this creates the GitHub
   OIDC trust and the IAM roles everything else depends on, and only
   ever needs to run once:
   - Open the **CloudFormation console** → **Create stack** → **With new
     resources (standard)** → **Upload a template file** → select
     `infra/aws/bootstrap.yaml` from this repo → **Next**.
   - Stack name: `dev-das-promos-bootstrap`.
   - Parameter **GitHubRepo**: your `owner/repo`, e.g.
     `David-Ackerman/dev-das-promos`.
   - Parameters **GitHubRepositoryOwnerId** and **GitHubRepositoryId**:
     use the numeric IDs returned by the `gh api` command above.
     These stable IDs let the trust policy support GitHub's legacy and
     immutable OIDC subject formats while remaining restricted to this
     repository and its `main` branch. GitHub documents the immutable
     subject format in its [OIDC reference](https://docs.github.com/en/actions/reference/security/oidc).
   - Click through **Next** twice, check the box acknowledging
     CloudFormation may create IAM resources with custom names, then
     **Submit**.
   - Wait for status **CREATE_COMPLETE** (a minute or two), then open the
     stack's **Outputs** tab and copy `GitHubActionsRoleArn`,
     `Ec2SsmInstanceProfileName`, `PostgresBackupBucketName`, and
     `PostgresBackupBucketRegion` -- you'll need the first two in step 4
     and the bucket values when enabling backups.

   If `dev-das-promos-bootstrap` already exists, choose **Update stack**
   and upload the current `infra/aws/bootstrap.yaml` before continuing.
   Keep the existing `GitHubRepo` value and provide both repository IDs.
   This updates the OIDC trust and adds the private backup bucket and
   narrowly-scoped S3 access without replacing the instance profile. The
   GitHub role's EC2 termination, security-group changes, and Elastic IP
   operations are restricted to resources with the project's `Name` tags;
   resource tags can only be applied during creation with the approved
   project names. EC2 launches must create the tagged project instance and
   are limited to `t3.small`; security groups and Elastic IPs must also be
   created with their approved project names. Elastic IP association and
   disassociation also require the target instance's project tag. The role
   can manage that association only for a project-tagged instance. Start,
   stop, and instance-attribute changes are also limited to that tagged
   instance so CloudFormation can apply an approved instance-type update.
   The role can send only `AWS-RunShellScript` to an EC2 instance tagged
   `Name=dev-das-promos`; it can read SSM command status for deployment.

4. **Set repository variables on GitHub** (your repo → **Settings** →
   **Secrets and variables** → **Actions** → **Variables** tab → **New
   repository variable**, one at a time). None of these are secret --
   the OIDC trust condition in `bootstrap.yaml` is what actually
   restricts who can use the role, not secrecy of these values:

   | Variable | Value |
   |---|---|
   | `AWS_ROLE_ARN` | the `GitHubActionsRoleArn` output from step 3 |
   | `AWS_REGION` | the region you deployed the bootstrap stack in, e.g. `us-east-2` |
   | `EC2_KEY_PAIR_NAME` | `dev-das-promos` (from step 1) |
   | `SSH_ALLOWED_CIDR` | your IP from step 2, e.g. `203.0.113.42/32` |
   | `EC2_SSM_INSTANCE_PROFILE_NAME` | the `Ec2SsmInstanceProfileName` output from step 3 |
   | `EC2_AMI_ID` | A region-specific Ubuntu 22.04 AMI ID, pinned as described below |
   | `PRODUCTION_DEPLOY_ENABLED` | `false` until the one-time EC2 setup in Part 3 is complete; set to `true` afterward |

   For a **new** stack, get the current Ubuntu 22.04 AMI ID in the same
   region and save it as `EC2_AMI_ID`:

   ```bash
   aws ssm get-parameter \
     --name /aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id \
     --region <AWS_REGION> --query Parameter.Value --output text
   ```

   For an **existing** stack, pin the AMI currently running before
   updating the CloudFormation template. This avoids replacing the EC2
   instance (and its local Postgres volume) as part of this change:

   ```bash
   INSTANCE_ID=$(aws cloudformation describe-stacks \
     --stack-name dev-das-promos-infra \
     --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
   aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
     --query "Reservations[0].Instances[0].ImageId" --output text
   ```

   Keep that ID in `EC2_AMI_ID` for routine infrastructure changes.
   Changing the AMI intentionally replaces the VM; treat that as a
   migration with a verified database backup and planned service downtime.
   The stack's Elastic IP remains the DNS target across the replacement.

   The stack allocates an Elastic IP so stopping and starting the EC2
   instance does not change the API address. AWS currently charges
   **US$0.005/hour for an in-use public IPv4 address**; see
   [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/).
   That is only the public IPv4 line item. The `t3.small` instance,
   20 GB `gp3` root volume, S3 backup storage/requests, and data transfer
   are billed separately and depend on region and usage. Estimate the
   complete stack for the selected region with the
   [AWS Pricing Calculator](https://calculator.aws/) before creating it;
   the public IPv4 rate is also listed in
   [AWS's announcement](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/).

5. **Push the initial commit** after the repository variables are set.
   Use this only when the GitHub repository is new and empty:

   ```bash
   # Only if this local repository has no commits yet:
   git add .
   git commit -m "Initial commit"
   git remote add origin git@github.com:YOUR_GITHUB_OWNER/dev-das-promos.git
   git branch -M main
   git push -u origin main
   ```

   Replace `YOUR_GITHUB_OWNER` with your GitHub username or organization.
   The example above assumes a private repository; create it public instead
   only if that is your deliberate choice. If the GitHub repository already
   contains project history, keep its existing remote and submit the current
   changes through the normal pull-request workflow instead of using this
   initial-push command.

   Push the repo to `main`. The workflow runs CI and applies
   `infra/aws/infra.yaml`, creating the EC2 instance + security group.
   App deployment stays skipped while `PRODUCTION_DEPLOY_ENABLED=false`,
   so the new host is not treated as ready before the one-time setup in
   Part 3. Check the workflow summary for the instance ID and public IP,
   or the CloudFormation console → stack `dev-das-promos-infra` →
   **Outputs**. The deploy workflow reads the current instance ID from
   this stack; you do not need to copy it into a GitHub variable.

6. **Protect `main` and require CI before merging.** In GitHub, open
   **Settings → Rules → Rulesets** (or **Branches → Branch protection
   rules**), create a rule targeting `main`, and enable **Require a pull
   request before merging** and **Require status checks to pass before
   merging**. Select the check **Validate application / validate** after
   the first pull request has run CI. Keep the rule active for
   administrators and do not allow bypasses for routine changes. The
   deployment workflow applies AWS infrastructure and deploys the app
   from pushes to `main`, so this gate must be in place before normal
   project changes are merged.

From here on, **changing instance type, opening a port, or resizing disk
is just editing `infra/aws/infra.yaml` and pushing** -- GitHub Actions
reapplies it. You should not need to touch the EC2 or CloudFormation
console again after this for routine changes.

### One-time manual setup on the instance itself

CloudFormation created the box; it still needs Docker installed once
before the app can run there (SSM can run commands remotely, but this
one-time OS setup is easiest over a direct SSH session so you can see
what's happening). SSH in using the key pair and public IP from step 5
above:

```bash
ssh -i ~/.ssh/dev-das-promos.pem ubuntu@<public-ip-from-step-5>
sudo apt-get update
sudo apt-get install -y awscli ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu jammy stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu
exit
```

Reconnect over SSH before continuing so the new Docker group membership
is active for the `ubuntu` account.

## Part 3: deploy the app

The SSM rollout fetches the exact commit from `origin`, so a private GitHub
repository needs read access from the EC2 instance. Use a repository-scoped,
read-only **deploy key**. Its private half stays on EC2; do not use a personal
access token or GitHub Actions secret for this fetch.

1. SSH into the instance and create a dedicated key as `ubuntu`:

   ```bash
   ssh -i ~/.ssh/dev-das-promos.pem ubuntu@<public-ip-from-step-5>
   install -m 700 -d ~/.ssh
   ssh-keygen -q -t ed25519 -N '' -C 'das-promos EC2 read-only deploy key' \
     -f ~/.ssh/das-promos-deploy
   ```

2. Add the public key (`cat ~/.ssh/das-promos-deploy.pub`) in the GitHub
   repository under **Settings → Deploy keys → Add deploy key**. Name it
   `das-promos EC2 read-only`; leave **Allow write access** unchecked.
   GitHub deploy keys are repository-scoped and read-only unless write
   access is explicitly enabled ([GitHub docs](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)).

3. Pin GitHub's published Ed25519 host key, set the SSH client to use only
   this deploy key, and clone with the SSH remote. The key below is from
   GitHub's [published SSH fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints);
   check that page before updating it if GitHub rotates its host key.
   Replace `YOUR_GITHUB_USERNAME` in the two Git commands with the owner
   of the private repository.

   ```bash
   printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' \
     >> ~/.ssh/known_hosts
   chmod 600 ~/.ssh/known_hosts ~/.ssh/das-promos-deploy
   chmod 644 ~/.ssh/das-promos-deploy.pub
   cat >> ~/.ssh/config <<'EOF'
   Host github.com
     HostName github.com
     User git
     IdentityFile ~/.ssh/das-promos-deploy
     IdentitiesOnly yes
     StrictHostKeyChecking yes
   EOF
   chmod 600 ~/.ssh/config
   ssh -T git@github.com || true
   git ls-remote git@github.com:YOUR_GITHUB_USERNAME/dev-das-promos.git HEAD
   git clone git@github.com:YOUR_GITHUB_USERNAME/dev-das-promos.git
   cd dev-das-promos
   cp .env.example .env
   chmod 600 .env
   nano .env   # fill in every value from Part 1, plus the generated secrets below
   ```

   `ssh -T` confirms authentication with a message that GitHub does not
   provide shell access; the command may exit nonzero because deploy keys
   only grant Git operations. The SSH clone sets `origin` to the URL that
   `deploy.yml` uses for future fetches. Keep the EC2 deploy key read-only
   and remove it from GitHub when the instance is retired.

Generate real secrets for these -- **never use the `.env.example`
placeholders**:

```bash
openssl rand -hex 32   # run 4 times, use one output each for:
# AUTH_SECRET, INTERNAL_API_TOKEN, ADMIN_PASSWORD, POSTGRES_PASSWORD
```

Set `ADMIN_EMAIL` to your real email. Set `API_HOST` to the DNS name of
the API, e.g. `api.example.com`, and create its A record pointing to the
static `PublicIp` output from the `dev-das-promos-infra` CloudFormation
stack **before starting Caddy**. Set `API_URL` and
`NEXT_PUBLIC_API_URL` to `https://api.example.com`, `ADMIN_URL` to
`https://admin.example.com`, `PUBLIC_WEB_URL` to `https://example.com`,
and `SESSION_COOKIE_DOMAIN` to `.example.com`. The admin and API must
share that parent domain for server-rendered admin pages to receive the
session cookie. Leave `DATABASE_URL`/`REDIS_URL` as the local defaults;
Compose overrides them to container-network names. Use a hex value for
`POSTGRES_PASSWORD` so it is safe in the database URL.
Production API startup also rejects a PostgreSQL URL password shorter than
32 characters, so use the generated 64-character hex value above.

Bring the stack up and run migrations:

```bash
docker compose -f infra/docker/docker-compose.prod.yml config --quiet
docker compose -f infra/docker/docker-compose.prod.yml up -d --wait --wait-timeout 120 postgres redis
docker compose -f infra/docker/docker-compose.prod.yml build api
docker compose -f infra/docker/docker-compose.prod.yml run --rm --no-deps api \
  sh -c "cd /app/packages/database && pnpm exec tsx src/migrate.ts"
docker compose -f infra/docker/docker-compose.prod.yml up -d --no-build
```

Confirm it's alive:

```bash
curl https://api.example.com/ready
# {"status":"ready"}
```

### Create the admin login

Create only the admin account, against this fresh, empty database:

```bash
docker compose -f infra/docker/docker-compose.prod.yml exec api \
  sh -c "cd /app/packages/database && pnpm exec tsx src/bootstrap-admin.ts"
```

This creates only your real admin login (`ADMIN_EMAIL`/`ADMIN_PASSWORD`
from `.env`) and is safe to repeat. Do not run the demo `db:seed` script
in production: it truncates domain tables and publishes mock deals.

### Configure a verified affiliate commission rate

Before ingesting or scoring deals, enter the rate shown in the approved
marketplace affiliate account. The demo seed rates are assumptions and
must not be copied into production. Rates use **basis points** in the
database (100 bps = 1%; 850 bps = 8.5%). This transaction expires the
currently active marketplace-wide default and inserts a new Shopee rate;
replace the required placeholder with the actual percentage from the
Shopee portal before running it:

```bash
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
psql -v ON_ERROR_STOP=1 -U das_promos -d das_promos <<'SQL'
\set commission_rate_percent REPLACE_WITH_NUMBER
SELECT (:'commission_rate_percent'::numeric > 0
        AND :'commission_rate_percent'::numeric <= 100) AS commission_rate_valid \gset
\if :commission_rate_valid
BEGIN;
UPDATE affiliate_programs
SET valid_until = now(), updated_at = now()
WHERE marketplace = 'shopee_br'
  AND category_id IS NULL
  AND valid_from <= now()
  AND (valid_until IS NULL OR valid_until > now());

INSERT INTO affiliate_programs (
  id, marketplace, category_id, commission_rate_bps,
  extra_commission_rate_bps, valid_from, valid_until, metadata
)
VALUES (
  gen_random_uuid()::text,
  'shopee_br',
  NULL,
  round(:'commission_rate_percent'::numeric * 100)::integer,
  0,
  now(),
  NULL,
  jsonb_build_object('verified_source', 'Shopee Affiliate portal')
);
COMMIT;

SELECT marketplace, commission_rate_bps, extra_commission_rate_bps,
       valid_from, valid_until
FROM affiliate_programs
WHERE marketplace = 'shopee_br'
ORDER BY valid_from DESC;
\else
\echo 'Commission rate must be greater than 0 and no more than 100 percent.'
SELECT 1 / 0;
\endif
SQL
```

For Amazon, add its verified rate using the same columns and the
`amazon_br` marketplace value only after that account is approved. If
rates differ by category, add category-scoped rows using the matching
`categories.id`; the scoring resolver prefers an active category row to
the marketplace-wide default. Re-evaluate existing deal candidates
after changing rates so their scores reflect the new commission.

If content generation fails before any publication row appears, open the
approved deal in the admin panel and use **Publish** to enqueue generation
again. For a publication already shown as `failed` or stale, use the retry
action on the Publications page instead. Either state may reflect a post
accepted before a timeout or response error; check the external channel
before confirming a retry to avoid a duplicate. If a newer ingestion
updated the offer, the retry regenerates its content from the current
offer snapshot before publishing.

After the one-time host setup is complete, the API returns ready, the admin
exists, and the backup timer is configured, change the GitHub repository
variable `PRODUCTION_DEPLOY_ENABLED` to `true`. This enables future pushes
to `main` to deploy the app after CI and infrastructure updates. To deploy
the current revision immediately, run **Actions → Deploy to AWS EC2 → Run
workflow**.

### Enable and verify off-instance database backups

The bootstrap stack creates a private, versioned S3 bucket and grants the
EC2 role access only to its `postgres/` prefix. Backups use server-side
AES-256 encryption; current objects expire after 90 days, with prior
versions retained for 30 more days. Configure and run the daily timer
before opening the site to traffic:

```bash
cd /home/ubuntu/dev-das-promos
printf 'BACKUP_S3_BUCKET=%s\nBACKUP_AWS_REGION=%s\n' \
  '<PostgresBackupBucketName output>' '<PostgresBackupBucketRegion output>' \
  | sudo tee /etc/das-promos-backup.env >/dev/null
sudo chown root:ubuntu /etc/das-promos-backup.env
sudo chmod 640 /etc/das-promos-backup.env
sudo install -o root -g root -m 644 infra/backup/das-promos-backup.service /etc/systemd/system/
sudo install -o root -g root -m 644 infra/backup/das-promos-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now das-promos-backup.timer
sudo systemctl start das-promos-backup.service
sudo journalctl -u das-promos-backup.service -n 30 --no-pager
aws --region '<PostgresBackupBucketRegion output>' s3 ls \
  "s3://<PostgresBackupBucketName output>/postgres/"
```

The backup service checks that the custom-format archive is readable by
`pg_restore` before uploading it. Confirm the service log reports an
uploaded backup and both the `.dump` and `.dump.sha256` objects appear in
S3. The timer persists through a
missed scheduled run and runs after the VM returns. The EC2 instance role
supplies AWS credentials; do not put access keys in the backup env file.

To rehearse recovery, download a chosen dump and its checksum, verify it,
restore it into a separate database, and inspect its tables before
removing that temporary database:

```bash
set -euo pipefail
RESTORE_DIR="$(mktemp -d /tmp/das-promos-restore.XXXXXX)"
RESTORE_DB="das_promos_restore_$(date -u +%Y%m%d%H%M%S)"
RESTORE_DB_CREATED=false
cleanup_restore() {
  if [ "${RESTORE_DB_CREATED}" = true ]; then
    docker compose -f /home/ubuntu/dev-das-promos/infra/docker/docker-compose.prod.yml \
      exec -T postgres dropdb -U das_promos --if-exists "${RESTORE_DB}" || true
  fi
  cd /
  rm -rf -- "${RESTORE_DIR}"
}
trap cleanup_restore EXIT
cd "${RESTORE_DIR}"
BACKUP_S3_BUCKET='<PostgresBackupBucketName output>'
BACKUP_AWS_REGION='<PostgresBackupBucketRegion output>'
BACKUP_NAME='das-promos-<UTC timestamp>'
aws --region "${BACKUP_AWS_REGION}" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/postgres/${BACKUP_NAME}.dump" .
aws --region "${BACKUP_AWS_REGION}" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/postgres/${BACKUP_NAME}.dump.sha256" .
sha256sum -c "${BACKUP_NAME}.dump.sha256"
docker compose -f /home/ubuntu/dev-das-promos/infra/docker/docker-compose.prod.yml \
  exec -T postgres createdb -U das_promos "${RESTORE_DB}"
RESTORE_DB_CREATED=true
docker compose -f /home/ubuntu/dev-das-promos/infra/docker/docker-compose.prod.yml \
  exec -T postgres pg_restore -U das_promos -d "${RESTORE_DB}" \
  --exit-on-error --no-owner --no-acl \
  < "${BACKUP_NAME}.dump"
docker compose -f /home/ubuntu/dev-das-promos/infra/docker/docker-compose.prod.yml \
  exec -T postgres psql -U das_promos -d "${RESTORE_DB}" -c '\dt'
```

The exit trap removes the isolated temporary database and local dump files
whether the restore succeeds or an intermediate command fails. Inspect the
table listing before the command block exits and performs that cleanup.

### Restore production after an incompatible migration

This is an operator-run recovery procedure, not part of routine deploys.
Use it only after identifying a verified backup and a previously CI-validated
application commit compatible with that backup. First set the GitHub
repository variable `PRODUCTION_DEPLOY_ENABLED` to `false` to prevent a
new app rollout, cancel any deploy workflow already in progress, and set
`SCHEDULE_ENABLED=false` in `/home/ubuntu/dev-das-promos/.env`. Check the
publication channels for any in-flight external post, then stop inbound
traffic and API workers before recovery. Keep the incident database; do not
drop it during recovery.

Download and checksum-verify the dump as in the rehearsal above. Restore it
to a new database and inspect it before swapping names:

```bash
set -euo pipefail
cd /home/ubuntu/dev-das-promos
RESTORE_DIR="$(mktemp -d /tmp/das-promos-production-restore.XXXXXX)"
RESTORE_DB="das_promos_restore_$(date -u +%Y%m%d%H%M%S)"
INCIDENT_DB="das_promos_incident_$(date -u +%Y%m%d%H%M%S)"
BACKUP_S3_BUCKET='<PostgresBackupBucketName output>'
BACKUP_AWS_REGION='<PostgresBackupBucketRegion output>'
BACKUP_NAME='das-promos-<UTC timestamp>'
docker compose -f infra/docker/docker-compose.prod.yml stop caddy api
cd "${RESTORE_DIR}"
aws --region "${BACKUP_AWS_REGION}" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/postgres/${BACKUP_NAME}.dump" .
aws --region "${BACKUP_AWS_REGION}" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/postgres/${BACKUP_NAME}.dump.sha256" .
sha256sum -c "${BACKUP_NAME}.dump.sha256"
cd /home/ubuntu/dev-das-promos
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  createdb -U das_promos "${RESTORE_DB}"
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  pg_restore -U das_promos -d "${RESTORE_DB}" --exit-on-error --no-owner --no-acl \
  < "${RESTORE_DIR}/${BACKUP_NAME}.dump"
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -U das_promos -d "${RESTORE_DB}" -c '\dt'
```

After confirming the restored tables/data, rename the current database aside
and promote the restored database. These commands intentionally retain the
incident database for rollback. Run these in the same shell session as the
restore commands so `RESTORE_DB` and `INCIDENT_DB` still name the databases
you inspected:

```bash
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U das_promos -d postgres \
  -c "ALTER DATABASE das_promos WITH ALLOW_CONNECTIONS false"
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U das_promos -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'das_promos' AND pid <> pg_backend_pid()"
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U das_promos -d postgres \
  -c "ALTER DATABASE das_promos RENAME TO ${INCIDENT_DB}"
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U das_promos -d postgres \
  -c "ALTER DATABASE ${RESTORE_DB} RENAME TO das_promos"
```

Check out the known-good commit (the full CI-validated SHA recorded by the
deploy workflow), rebuild the API, then start API and Caddy and verify
`https://api.<domínio>/ready` before reopening traffic. Replace the SHA below
with that reviewed commit. Do not run a migration from the incompatible
release against the restored database:

```bash
cd /home/ubuntu/dev-das-promos
git fetch origin
git checkout --detach <CI-validated-known-good-SHA>
docker compose -f infra/docker/docker-compose.prod.yml build api
docker compose -f infra/docker/docker-compose.prod.yml up -d --no-build api caddy
curl --fail --silent --show-error https://api.<domínio>/ready
```

If the restored API cannot start, stop it and reverse the database rename
using the same shell variables. This returns to the pre-restore database:

```bash
docker compose -f /home/ubuntu/dev-das-promos/infra/docker/docker-compose.prod.yml stop caddy api
docker compose -f /home/ubuntu/dev-das-promos/infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U das_promos -d postgres \
  -c "ALTER DATABASE das_promos WITH ALLOW_CONNECTIONS false"
docker compose -f /home/ubuntu/dev-das-promos/infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U das_promos -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'das_promos' AND pid <> pg_backend_pid()"
docker compose -f /home/ubuntu/dev-das-promos/infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U das_promos -d postgres \
  -c "ALTER DATABASE ${INCIDENT_DB} WITH ALLOW_CONNECTIONS true"
docker compose -f /home/ubuntu/dev-das-promos/infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U das_promos -d postgres \
  -c "ALTER DATABASE das_promos RENAME TO ${RESTORE_DB}"
docker compose -f /home/ubuntu/dev-das-promos/infra/docker/docker-compose.prod.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U das_promos -d postgres \
  -c "ALTER DATABASE ${INCIDENT_DB} RENAME TO das_promos"
```

Keep `SCHEDULE_ENABLED=false` and deployment disabled until the recovered
version and data are confirmed. Remove the temporary download only after
recovery evidence is recorded; delete either database only after an operator
has confirmed the system is stable and the incident data is no longer needed.

## Part 3.5: how the GitHub Actions deployment fits together

Part 2 already had you push this repo to GitHub and set up everything
AWS-side. The deploy workflow runs CI, applies infrastructure, then deploys
the application in order. Both AWS jobs authenticate via the OIDC role
from `bootstrap.yaml` -- no AWS access keys or SSH keys are stored in
GitHub; the repo-scoped read-only GitHub deploy key stays on the EC2 host:

- **`.github/workflows/deploy.yml`** ("Deploy to AWS EC2") -- runs on
  every push to `main` and can be run manually. It first calls CI (lint,
  typecheck, tests, workspace build, production Compose validation and API
  image build), then
  calls `.github/workflows/infra.yml` to apply `infra/aws/infra.yaml` and
  report the instance ID/public IP.
  The SSM app rollout runs only when the repository variable
  `PRODUCTION_DEPLOY_ENABLED` is `true`; it stays skipped during initial
  host setup. Once enabled, **AWS Systems Manager (SSM) Run Command**
  fetches and checks out the exact commit that passed CI, migrates the
  database before starting the new API, and checks `/ready` over the
  container network. This ordering handles
  commits that change both application and infrastructure without
  concurrent deploy workflows. SSM uses AWS's own control plane -- no
  inbound SSH connection is needed.
- **`.github/workflows/infra.yml`** is the reusable CloudFormation step
  called by deploy.yml. It applies instance type, disk, and security group
  changes before the application rollout. It also uses the pinned
  `EC2_AMI_ID` value, so routine stack changes cannot silently select a
  newer Ubuntu image and replace the database host.

To apply infra and deploy on demand without pushing a new commit, use
**Actions → Deploy to AWS EC2 → Run workflow** on `main`. Production
infrastructure and application jobs are restricted to `main`; dispatching
the workflow from another branch runs CI only.

The CI workflow also runs for pull requests. Require its check before
merging to `main`. Review the CloudFormation diff before merging any
infrastructure changes.

**If you skipped ahead**: everything both workflows depend on --
pushing to GitHub, deploying `bootstrap.yaml`, and setting the 7 repo
variables -- is in Part 2 above. Do that first if you haven't.

## Part 4: deploy `apps/web` and `apps/admin`

Do this now, before verification, so the next part can use the real
admin dashboard instead of raw `curl` for the admin-only steps.

1. This site uses affiliate links for revenue, so Vercel Hobby is not
   permitted for production; Vercel requires commercial deployments to
   use Pro or Enterprise. Review the current
   [Vercel plan terms](https://vercel.com/docs/limits/fair-use-guidelines)
   and [pricing](https://vercel.com/pricing), including usage charges,
   before choosing a plan. Alternatively, host both Next.js apps on a
   commercial-use platform that supports long-lived or server-rendered
   Next.js applications.
2. Import the repo into Vercel as two separate projects, root directory
   set to `apps/web` and `apps/admin` respectively. Attach custom
   domains under the same parent domain as the API (e.g. `example.com`
   and `admin.example.com`).
3. On each, set env vars: `API_URL` and `NEXT_PUBLIC_API_URL` both
   pointing at `https://api.example.com`. Set the API's `ADMIN_URL` and
   `PUBLIC_WEB_URL` to the final HTTPS addresses for these projects.
   On the `apps/web` project, set `NEXT_PUBLIC_SITE_URL` to its final
   canonical origin, e.g. `https://example.com`; this is used for canonical
   page URLs, `sitemap.xml`, and `robots.txt`.
   Set `PUBLIC_OPERATOR_NAME` and `PUBLIC_CONTACT_EMAIL` on the public web app
   to the real operator identity and a monitored privacy contact. Production
   builds require both; the values are displayed on `/privacy`.
   The Vercel build uses its injected variables instead of the ignored
   repository `.env`; builds fail clearly if the app's required API URL
   variables are missing or malformed.
4. Deploy. `apps/admin` is where you'll actually monitor/approve deals
   day to day; `apps/web` is the public SEO-facing site.
5. Log into `apps/admin` with `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env`.

## Part 5: verify each real integration with a manual ingestion (do this before enabling the schedule)

Trigger ingestion for one marketplace via the API using your
`INTERNAL_API_TOKEN`:

```bash
curl -X POST https://api.example.com/internal/ingestion/run \
  -H "X-Internal-Token: $INTERNAL_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"marketplace": "shopee_br"}'
# {"queued": true, "marketplace": "shopee_br"}
```

This enqueues ingestion; scoring happens automatically a few seconds
later. Check what landed, either via `/deals` in the admin dashboard, or
directly:

```bash
docker compose -f infra/docker/docker-compose.prod.yml exec postgres \
  psql -U das_promos -d das_promos -c \
  "select slug, deal_score, status from deal_candidates order by created_at desc limit 5;"
```

In the admin dashboard, approve a `pending` deal (or find one that's
already `auto_approved`), then click **Publish** to check the **actual
affiliate link**, not just that the job ran.

Verify in order:
1. The message actually arrives in your Telegram group/channel.
2. The deal appears at `https://<PUBLIC_WEB_HOST>/deal/<slug>` only after
   the web publication succeeds, and its **Ver oferta** button has its own
   web-channel redirect. A Telegram-only publication must not expose the
   public deal page or supply the website's CTA redirect.
3. The link in that message resolves through `/go/:code` (this app's
   own redirect, tracked) and lands on the real Shopee product page --
   for Shopee specifically, the destination stored is already a real
   Shopee-issued short link from `generateShortLink`, so clicking
   through should land you on Shopee with the affiliate attribution
   already baked in by Shopee's own redirect, not a query param you
   have to eyeball.
4. For Amazon, click through and confirm the preserved API-vended URL
   lands on the intended product with `?tag=<your AMAZON_AFFILIATE_TAG>`
   intact. The application's `/go/:code` redirect measures the channel
   without changing Amazon's URL.
5. If X is configured, its post appears on your account.
6. Back in the admin deal detail page, publication status per channel
   should read `published`, not `failed`.

If a channel shows `failed`, check the `errorMessage` on that
publication row (visible in the admin deal detail page) before assuming
credentials are wrong -- it'll usually say exactly what the marketplace
or Telegram/X API rejected.

## Part 6: turn on the automated routine

Edit `.env` on the EC2 instance:

```bash
SCHEDULE_ENABLED=true
SCHEDULE_TIMES=13:00                      # UTC; expand only after the first run succeeds
SCHEDULE_MARKETPLACES=shopee_br          # add amazon_br once Part 5 verifies it
SCHEDULE_PUBLISH_DELAY_MINUTES=15
SCHEDULE_PUBLISH_LIMIT=1
```

Restart and confirm it registered:

```bash
docker compose -f infra/docker/docker-compose.prod.yml up -d
docker compose -f infra/docker/docker-compose.prod.yml logs api | grep scheduler
# [scheduler] registered 1 ingest+publish cycle(s)/day for [shopee_br] at UTC times [...]
```

In production, the API refuses to start with scheduling enabled unless all
configured marketplaces have real API and affiliate credentials and at least
one external publisher (Telegram or X) has real credentials. Keep the schedule
off until the manual publication cycle in Part 5 succeeds.
Manual content generation also refuses to use a marketplace without its real
API and affiliate credentials; this prevents demo or stale imported candidates
from being published with mock links.

From here it runs unattended: ingest each configured time, publish the
best-scoring ready deals `SCHEDULE_PUBLISH_DELAY_MINUTES` later, using
whatever was most recently ingested -- nothing stale gets republished
(`docs/architecture.md`, README's "Automated posting routine" section).

## Part 7: verify DNS + TLS

- Caddy is part of `docker-compose.prod.yml`. The EC2 security group
  exposes only ports 80/443 for public HTTP/HTTPS; port 4000 stays on
  the Docker network. Caddy obtains the certificate once `API_HOST`
  resolves to the VM and ports 80/443 are reachable.
- Confirm `https://<API_HOST>/ready` returns 200 and an HTTP request
  redirects to HTTPS. Confirm the dashboard login works under its custom
  domain, including a hard refresh on a protected page.

## Troubleshooting

- **A marketplace ingestion job fails immediately**: check
  `docker compose ... logs api` for the actual thrown error message --
  every real provider throws a descriptive error rather than failing
  silently (wrong credentials, expired Mercado Livre refresh token,
  rate limiting, etc.).
- **Mercado Livre appears in `SCHEDULE_MARKETPLACES`**: startup rejects
  it with a configuration error. Only Amazon and Shopee currently support
  automatic affiliate-link generation; see Part 0.
- **Scheduler doesn't seem to fire**: confirm the times are in UTC, not
  your local timezone, and check
  `docker compose ... logs api | grep scheduler` shows the registration
  line after every restart (it's safe/idempotent to see it repeat).
- **AI content generation never seems to kick in**: check
  `AI_CONTENT_DAILY_LIMIT` hasn't been exhausted for the day, and that
  both `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` are set -- either one
  missing silently falls back to template content, by design.

## Pre-launch checklist

- [ ] GitHub `main` requires a pull request and the **Validate application / validate** CI check before merge
- [ ] Real credentials set for every marketplace/channel being launched;
      scheduled marketplaces limited to verified `shopee_br` and/or `amazon_br`
- [ ] Production migrations and `db:bootstrap-admin` run; demo `db:seed`
      never run against production
- [ ] Every production secret rotated from `.env.example` placeholders
- [ ] `apps/api` runs as a long-lived service; `/health` and `/ready` return
      200, and port 4000 is not publicly reachable
- [ ] TLS is live on every public domain; `apps/web` and `apps/admin` use
      the production API and a host/plan that permits commercial use
- [ ] Admin login survives a browser refresh on its final custom domain
- [ ] Daily PostgreSQL backup timer uploads a dump and checksum to S3, and
      restoration into a separate database has been rehearsed
- [ ] A code rollback through a revert PR has been rehearsed; incompatible
      migrations have a documented restore path using the verified backup
- [ ] A low-volume manual ingest → score → approve → publish → click cycle
      succeeds and the affiliate link reaches the correct product. **Amazon:**
      verify live credentials, the configured tag, returned product URL,
      and price against the real account before volume
- [ ] Choose one operating mode: n8n uses the production API and real
      `INTERNAL_API_TOKEN`; the self-scheduled routine uses
      `SCHEDULE_ENABLED=true`, real UTC times, and confirmed registration in logs
- [ ] Error monitoring and an availability alert are configured; today the
      API has Fastify logs but no integrated error-tracking service. The
      hourly `Check production availability` workflow needs repository
      variables `API_HEALTHCHECK_URL` (e.g. `https://api.example.com/ready`)
      and `PUBLIC_HEALTHCHECK_URL`. The account that last edits the schedule
      must watch the repository and enable GitHub Actions failure notifications.
