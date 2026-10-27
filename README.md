# TalkHop ⚡ — Instant Random Chat & Live Video Call Engine

> **Developed by [VybronX Studios](https://vybronx.online)**  
> **Production URL:** [https://vybrant.vybronx.online](https://vybrant.vybronx.online)

---

## 📖 Executive Summary & Context

**TalkHop** is a high-performance, real-time anonymous stranger-chat platform supporting two distinct modes:
1. **Random Chat** — Instant text-only conversations with strangers worldwide (no camera/microphone requested or transmitted).
2. **Video Call** — Live peer-to-peer audio and video conversations with adaptive streaming and AI Safety Shield.

Featuring a dedicated post-verification mode selection screen and a slide-to-switch mode controller, TalkHop prioritizes **user privacy**, **consent-driven transitions**, **zero database storage**, and **on-device safety moderation**.

This document is structured to provide human developers and AI engineering agents with full architectural, security, and operational clarity.

---

## 🏛️ System Architecture

### Zero-Database Footprint (100% In-Memory RAM Queue)
- **Engine:** Node.js, Express, Socket.io (WebSocket with HTTP polling fallback).
- **Data Persistence:** **Zero database dependencies** (No MongoDB, PostgreSQL, or Redis required).
- **In-Memory State Maps:**
  - `userStates` (`socket.id` ➔ `{ ip, state, preferences, isVip, vipCode, partnerId }`): Tracks active connections and matching status.
  - `waitingQueue` (`Array<UserEntry>`): FIFO matchmaking queue filtered by priority tiers (VIP Female/Male/Country matches vs. random global).
  - `activePairs` (`socket.id` ➔ `partnerSocket.id`): Bi-directional active call tracking.
  - `vipPasses` (`code` ➔ `{ plan, durationMs, createdAt, expiresAt, activeSocketId }`): In-memory VIP pass registry with strict 1-device concurrency locking.
  - `bannedIPs` (`clientIP` ➔ `{ bannedAt, expiresAt, reason }`): Automated 24-hour IP ban registry.
  - `ipReports` (`clientIP` ➔ `Set<reportingIP>`): Threshold-based community reporting system (3 peer strikes ➔ 24-hour auto-ban).
- **Graceful Lifecycle:** Disconnections immediately release partner links, clean up queue slots, and unbind VIP concurrency locks.

---

## 💻 Frontend Architecture

- **Core Technologies:** Vanilla HTML5, Vanilla JavaScript (ES2022+), Tailwind CSS (via CDN).
- **WebRTC Protocol:** Direct browser-to-browser encrypted media streaming (`RTCPeerConnection`) with audio, video, and bidirectional DataChannels (`RTCDataChannel`).
- **Responsive & Mobile-First Design:**
  - Stacked video grid (16:9 aspect ratio, min-heights enforced) on mobile screens (`<= 768px`).
  - Flex-wrap dynamic container preventing video/chat squishing on laptop screens (100% zoom at `1280px` to `1440px`).
  - Pinned ephemeral chat with internal scrolling (`100dvh` viewport adaptation).
- **Mobile Camera Controls:**
  - Hardware camera switching (`flipCamera()`) toggles between front selfie (`'user'`) and rear lens (`'environment'`).
  - Uses `RTCRtpSender.replaceTrack(newVideoTrack)` on the active peer connection without renegotiating or dropping the live call.
  - Automatic horizontal mirror correction (`scaleX(1)` for back camera, `scaleX(-1)` for front camera).

---

## 🛡️ AI Safety Shield & Moderation Pipeline

Vybrant employs a client-side + server-side defense matrix:
1. **18+ Age Gate:** Compulsory modal verification saved to `sessionStorage` before camera or socket initialization.
2. **On-Device NSFW AI Shield:**
   - Client loads `@tensorflow/tfjs` and `nsfwjs` in background web workers.
   - Every 1.5 seconds during active video calls, an offscreen canvas extracts local video frames and classifies content.
   - If `Porn` or `Hentai` probability exceeds **65% (0.65)**:
     - Instantly blurs local and remote video displays.
     - Emits `nsfw_violation` payload to `server.js`.
     - Server immediately logs and records a **24-hour IP ban**.
     - Session disconnects and redirects violator to ban screen.
3. **First 3-Second Anti-Flash Blur:**
   - Incoming stranger video feeds are blurred with CSS backdrop filters (`backdrop-blur-2xl`) for the first 3 seconds of a call.
   - Features a live countdown and progress bar with an optional user bypass button ("⚡ Quick Reveal").
4. **Peer Reporting:**
   - 3 unique peer reports against an IP within active windows trigger an automatic 24-hour IP ban.

---

## 👑 VIP Micro-Pass & Monetization System

Vybrant implements a zero-subscription micro-pass model:
- **Available Plans:**
  - **1-Hour VIP Pass:** ₹19 (60 minutes of unrestricted priority matchmaking).
  - **12-Hour VIP Pass:** ₹39 (720 minutes with 83% discount).
- **VIP Capabilities:**
  - Specific Gender Filter (Priority matching with ♀️ Female or ♂️ Male strangers).
  - Global Country Filter (Priority matching with 98+ specific countries by 2-letter ISO code).
  - Priority FIFO Queue placement (skips standard queue).
- **1-Device Concurrency Lock:**
  - A VIP code can only be actively connected to a single socket/device at any given moment. Simultaneous duplicate uses are rejected with HTTP 409 Conflict.
- **Save & Redeem:**
  - Users receive a genuine 6-digit code (e.g., `VIP-7X92K`).
  - The [🎟️ Redeem] modal allows users to resume their countdown across browser sessions or tabs.

---

## 🔌 External Integrations & APIs

| Service | Purpose | Integration Details |
|---|---|---|
| **Metered.ca** | WebRTC STUN/TURN Relay | Global TURN servers (TCP/UDP on ports 80 and 443 + TLS) configured in `RTC_CONFIG` to guarantee connections across restrictive enterprise NATs, firewalls, and mobile cellular data. |
| **Razorpay** | Payment Gateway | `razorpay` npm SDK on server (`RZP_KEY_ID`, `RZP_KEY_SECRET`). `checkout.js` on client for UPI (Google Pay, PhonePe, Paytm), Cards, and NetBanking. Cryptographic HMAC-SHA256 signature verification (`POST /api/payment/verify`). |
| **cron-job.org** | Host Keep-Alive | Lightweight `GET /ping` route returning `{ status: "alive", time: Date.now() }` pinged every 5–10 minutes to prevent free cloud containers (e.g., Render) from idling. |

---

## 🔒 Secret Admin Command Center

Located at `public/admin.html` (accessible via `/admin` or `/admin.html`):
- **Authentication:** Environment variables `ADMIN_USER` (default: `admin`) and `ADMIN_PASS` (default: `vybrant777x`). Session tokens expire after 24 hours.
- **Telemetry Radar:** Live polling every 3 seconds returning:
  - Total online users, users in call, users in waiting queue.
  - Real-time country and gender demographic distributions.
  - Active and expired VIP micro-passes.
  - Currently active 24-hour banned IPs.
- **Action Controls:**
  - Generate custom promotional VIP codes (custom code string, validity duration, max uses, notes).
  - Revoke active VIP passes instantly.
  - Manual IP unban and ban controls.
  - Dynamic Sponsor Broadcast: Update live sponsor tags, messages, and call-to-action links pushed instantly to all connected clients via WebSockets.

---

## 🚀 Environment Variables

Create a `.env` file in the root directory (excluded by `.gitignore`):

```env
PORT=3000
ADMIN_USER=admin
ADMIN_PASS=your_super_secret_password
RZP_KEY_ID=rzp_live_your_key_id
RZP_KEY_SECRET=your_razorpay_secret_key
```

*Note: If Razorpay keys are omitted, the application runs automatically in instant sandbox mock payment mode for seamless local development.*

---

## 🛠️ Installation & Running Locally

```bash
# 1. Clone the repository
git clone https://github.com/vybronx/vybrant-p2p-engine.git
cd vybrant-p2p-engine

# 2. Install dependencies
npm install

# 3. Start local development server with file watch
npm run dev

# 4. Open in browser
http://localhost:3000
# Admin panel:
http://localhost:3000/admin.html
```

---

## 📄 License

Licensed under the **MIT License**. Developed by **VybronX Studios**.
