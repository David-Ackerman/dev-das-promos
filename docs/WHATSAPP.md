# Automatic WhatsApp Channel posts

How to make the bot post every approved deal to a WhatsApp Channel by itself
(`WHATSAPP_MODE=evolution`). About 1 hour the first time, all free except the chip.

**How it works:** a small always-on server (free Oracle Cloud VM) runs
[Evolution API](https://github.com/EvolutionAPI/evolution-api), which stays logged
in to a dedicated WhatsApp number like WhatsApp Web does. When you tap ✅, the
Worker asks that server to post the deal (photo + text + tracked link) to the
channel.

**Risk:** this is unofficial (WhatsApp's own API can't post to Channels). WhatsApp
can ban the number without warning. That's why it runs on a separate chip: a ban
costs the chip and the channel, never your personal WhatsApp.

## 1. New number (WhatsApp Business)

1. Buy a prepaid chip (any carrier, ~R$ 15) and activate it.
2. Put it in any phone just to receive the SMS code, or keep it in a drawer if you
   pick "Call me" on a phone where it's active.
3. On your iPhone install **WhatsApp Business** (separate app, lives next to your
   normal WhatsApp) and register it with the new number.
4. Profile: name "Dev das Promos", the mascot as photo, a short description.
5. Settings → Account → **Two-step verification**: turn it on (PIN + email).
6. Keep the chip active: top it up every couple of months, or the carrier may
   recycle the number.

## 2. The channel

1. In **WhatsApp Business** → Updates → **+** → **Create channel**. Same name,
   photo and description as the profile.
2. Channel info → **Invite admins** → add your personal number, so you can also
   post by hand from your normal WhatsApp.
3. Copy the channel link (Channel info → Share): it goes in `SITE_WHATSAPP_URL`
   and your bios.
4. Post one message in the channel (a welcome text). Step 5 needs it.

## 3. Free server (Oracle Cloud)

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/), home
   region **Brazil East (São Paulo)**. It asks for a card for verification only;
   the "Always Free" resources below never charge.
2. Compute → Instances → **Create instance**:
   - Image: **Ubuntu 24.04**.
   - Shape: **Ampere VM.Standard.A1.Flex**, 1 OCPU, 6 GB. If it says "out of
     capacity", use **VM.Standard.E2.1.Micro** (also free; the setup adds swap).
   - Networking: keep "assign a public IPv4 address".
   - SSH keys: **Save private key** (you'll need the file).
3. Open the web ports: instance page → the subnet link → its **Default Security
   List** → **Add Ingress Rules**: source `0.0.0.0/0`, TCP, destination ports
   `80,443`.
4. Copy the instance's **public IP**.

## 4. Install Evolution API

From PowerShell on your PC (use the key file you saved):

```bash
ssh -i C:\path\to\ssh-key.key ubuntu@<PUBLIC_IP>
```

Then on the server:

```bash
git clone https://github.com/David-Ackerman/dev-das-promos.git
bash dev-das-promos/deploy/evolution/setup.sh
```

It installs Docker, opens the firewall, gives the server a free HTTPS address
(`<ip>.sslip.io`), starts everything and prints the three settings for GitHub.
Copy them.

To update later: `cd dev-das-promos && git pull && bash deploy/evolution/setup.sh`.

## 5. Connect the number and find the channel id

1. Open `https://<the address>/manager` in your browser. Evolution 2.4 asks for a
   **free one-time activation** (email + phone; it then sends Evolution's team
   usage counts and the server IP, never message content). Then log in with the
   address and the `EVOLUTION_API_KEY` that setup printed.
2. **Create instance** named `promos` (integration: Baileys) → it shows a QR code.
3. In **WhatsApp Business** on the iPhone: Settings → Linked devices → Link a
   device → scan the QR code.
4. Find the channel id (the server learned it from the message you posted in
   step 2.4). On the server:

   ```bash
   cd ~/dev-das-promos/deploy/evolution && set -a && . ./.env && set +a
   curl -s -X POST "https://$DOMAIN/chat/findChannels/promos" -H "apikey: $AUTHENTICATION_API_KEY" -H 'content-type: application/json' -d '{}'
   ```

   Copy the `remoteJid` ending in `@newsletter`. Empty list? Post another message
   in the channel and run it again.

## 6. Turn it on

GitHub → Settings → Environments → **production**:

| Type | Name | Value |
|---|---|---|
| Variable | `WHATSAPP_MODE` | `evolution` |
| Variable | `WHATSAPP_GROUP_IDS` | the `...@newsletter` id |
| Variable | `EVOLUTION_API_URL` | `https://<ip>.sslip.io` (from setup) |
| Variable | `EVOLUTION_INSTANCE` | `promos` |
| Secret | `EVOLUTION_API_KEY` | from setup |
| Variable | `SITE_WHATSAPP_URL` | the channel link |

Then run **Actions → Deploy** (or push). Approve one deal: it should show up in
the channel with its photo, and the admin message lists "WhatsApp …@newsletter"
as sent. Failures show up in the same message, and 🔁 retry only resends what failed.

`WHATSAPP_GROUP_IDS` takes several ids separated by commas, e.g. the channel plus
a group (`...@g.us`) where the new number is admin. In this mode the 📲 button
goes away.

## Keeping the number healthy

- Open **WhatsApp Business** on the phone at least once every 14 days, or
  WhatsApp disconnects linked devices (the bot then reports WhatsApp failures).
- Keep volume like a person: the queue already spaces posts (40 min, 6h–23h).
- Only post to your own channel and groups. Never message people from this number.
- If the number gets banned: get a new chip, create a new channel, repeat steps
  1, 2, 5 and 6 (the server stays).
