const { ethers } = require("ethers");
const fs = require("fs");
const readline = require("readline");

// ===== CONFIG =====
const WALLET_FILE = "wallet.txt";
const AKUN_FILE = "akun.txt";
const BASE = "https://interstellar.dachain.io";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
// ==================

function loadWallets() {
  return fs.readFileSync(WALLET_FILE, "utf-8")
    .split("\n").map(l => l.trim()).filter(l => l.length > 0);
}

function loadAkun() {
  const raw = fs.readFileSync(AKUN_FILE, "utf-8").trim();
  return raw.split(/\n\s*\n/).map((b, i) => {
    const lines = b.trim().split("\n").map(l => l.trim());
    if (lines.length < 2) throw new Error(`Akun ke-${i + 1} format salah`);
    return { authToken: lines[0], ct0: lines[1] };
  });
}

function getCsrf(cookie) {
  const m = cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : "";
}

function buildHeaders(cookie = "") {
  const csrf = getCsrf(cookie);
  return {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Origin": BASE,
    "Referer": BASE + "/",
    "User-Agent": UA,
    "Sec-Ch-Ua": '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
    "Sec-Ch-Ua-Mobile": "?1",
    "Sec-Ch-Ua-Platform": '"Android"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    ...(cookie ? { Cookie: cookie } : {}),
    ...(csrf ? { "X-Csrftoken": csrf } : {}),
  };
}

function buildTwitterHeaders(authToken, ct0) {
  return {
    "Accept": "*/*",
    "Authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://x.com",
    "Referer": "https://x.com/",
    "User-Agent": UA,
    "Sec-Ch-Ua": '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
    "Sec-Ch-Ua-Mobile": "?1",
    "Sec-Ch-Ua-Platform": '"Android"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "Cookie": `auth_token=${authToken}; ct0=${ct0}`,
    "X-Csrf-Token": ct0,
    "X-Twitter-Active-User": "yes",
    "X-Twitter-Auth-Type": "OAuth2Session",
    "X-Twitter-Client-Language": "id",
  };
}

function parseCookies(existing = "", setCookieArr = []) {
  const jar = {};
  existing.split(";").forEach(c => {
    const [k, v] = c.trim().split("=");
    if (k) jar[k.trim()] = v?.trim() ?? "";
  });
  setCookieArr.forEach(c => {
    const [kv] = c.split(";");
    const [k, v] = kv.split("=");
    if (k) jar[k.trim()] = v?.trim() ?? "";
  });
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function parseQS(url) {
  const u = new URL(url);
  const out = {};
  u.searchParams.forEach((v, k) => out[k] = v);
  return out;
}

function buildSiweMessage(address, nonce) {
  const now = new Date();
  const exp = new Date(now.getTime() + 2 * 60 * 1000);
  return [
    `interstellar.dachain.io wants you to sign in with your Ethereum account:`,
    address,
    "",
    "",
    `URI: ${BASE}`,
    `Version: 1`,
    `Chain ID: 21892`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${exp.toISOString()}`,
  ].join("\n");
}

async function post(url, body, cookie) {
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(cookie),
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const json = await res.json();
  return { json, setCookie, status: res.status };
}

// ── STEP 1: Login SIWE ──
async function loginWallet(pk, idx, total) {
  const wallet = new ethers.Wallet(pk);
  const address = typeof ethers.utils !== "undefined"
    ? ethers.utils.getAddress(wallet.address)
    : ethers.getAddress(wallet.address);

  console.log(`\n[${idx + 1}/${total}] ${address}`);
  let cookie = "";

  try {
    const { json: nonceJson, setCookie: c1 } = await post(
      `${BASE}/api/v1/auth/siwe/nonce/`, { signer: address }, cookie
    );
    cookie = parseCookies(cookie, c1);

    const nonce = nonceJson?.data?.nonce;
    if (!nonce) throw new Error("Nonce gagal: " + JSON.stringify(nonceJson));
    console.log(`  nonce: ${nonce}`);

    const message = buildSiweMessage(address, nonce);
    const signature = await wallet.signMessage(message);

    const { json: siweJson, setCookie: c2, status } = await post(
      `${BASE}/api/v1/auth/siwe/`, { message, signature }, cookie
    );
    cookie = parseCookies(cookie, c2);

    if (!siweJson?.success) throw new Error(`Status ${status}: ` + JSON.stringify(siweJson));

    const user = siweJson.data?.user;
    console.log(`  ✓ Login OK | id: ${user?.id} | status: ${user?.status}`);
    return { address, cookie, user };

  } catch (err) {
    console.error(`  ✗ Login: ${err.message}`);
    return null;
  }
}

// ── STEP 1.5: Bind Referral ──
async function bindReferral(cookie) {
  try {
    const res = await fetch(`${BASE}/api/v1/referral/bind/`, {
      method: "POST",
      headers: buildHeaders(cookie),
      body: JSON.stringify({ code: "-MctRDSlX2" }),
    });
    const json = await res.json();
    if (json?.data?.bound) {
      console.log(`  ✓ Referral bound (referrer: ${json.data.referrer})`);
    } else {
      console.log(`  ~ Referral: ${JSON.stringify(json?.data)}`);
    }
  } catch (err) {
    console.error(`  ✗ Referral: ${err.message}`);
  }
}

// ── STEP 2: Connect X ──
async function connectX(session, akun, idx, total) {
  const { address, cookie } = session;
  const { authToken, ct0 } = akun;
  console.log(`  Konek X...`);

  try {
    // Start — dapat auth URL
    const startRes = await fetch(`${BASE}/api/v1/auth/social/x/start/`, {
      method: "POST",
      headers: buildHeaders(cookie),
      body: JSON.stringify({}),
    });
    const startJson = await startRes.json();
    const authUrl = startJson?.data?.authorization_url
      || startJson?.data?.auth_url
      || startJson?.data?.url;
    if (!authUrl) throw new Error("Gagal dapat auth_url: " + JSON.stringify(startJson));
    console.log(`  auth_url: ${authUrl}`)
    const params = parseQS(authUrl);
    console.log(`  params: ${JSON.stringify(params)}`);

    const { state, code_challenge, code_challenge_method, client_id } = params;
    const redirect_uri = params.redirect_uri || `${BASE}/api/v1/auth/social/x/callback/`;
    const scope = params.scope || "users.read tweet.read";

    // Approve di Twitter
    const twitterBody = new URLSearchParams({
      approval: "true",
      response_type: "code",
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge,
      code_challenge_method: code_challenge_method || "S256",
    });

    const approveRes = await fetch("https://api.x.com/2/oauth2/authorize", {
      method: "POST",
      headers: buildTwitterHeaders(authToken, ct0),
      body: twitterBody.toString(),
    });
    const approveJson = await approveRes.json();

    const redirectUrl = approveJson?.redirect_uri;
    if (!redirectUrl) throw new Error("Twitter approve gagal: " + JSON.stringify(approveJson));

    const cbParams = parseQS(redirectUrl);
    const code = cbParams.code;
    if (!code) throw new Error("Tidak ada code: " + redirectUrl);

    // Callback ke server
    const cbRes = await fetch(
      `${BASE}/api/v1/auth/social/x/callback/?state=${encodeURIComponent(cbParams.state || state)}&code=${encodeURIComponent(code)}`,
      { method: "GET", headers: buildHeaders(cookie), redirect: "manual" }
    );

    if (cbRes.status === 302 || cbRes.status === 200) {
      console.log(`  ✓ X connected!`);
      return true;
    } else {
      const body = await cbRes.text();
      throw new Error(`Callback ${cbRes.status}: ${body.slice(0, 200)}`);
    }

  } catch (err) {
    console.error(`  ✗ X: ${err.message}`);
    return false;
  }
}

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans.trim()); }));
}

async function main() {
  const allKeys = loadWallets();
  const allAkun = loadAkun();
  const total = allKeys.length;

  if (allKeys.length !== allAkun.length) {
    console.warn(`⚠ wallet (${allKeys.length}) vs akun X (${allAkun.length}) beda jumlah`);
  }
  const count = Math.min(allKeys.length, allAkun.length);

  console.log(`Wallet: ${allKeys.length} | Akun X: ${allAkun.length}`);
  console.log(`\nPilih mode:`);
  console.log(`  1 = 1 akun`);
  console.log(`  2 = semua akun`);
  console.log(`  3 = dari index X sampai akhir`);

  const mode = await ask("\nPilihan (1/2/3): ");
  let targets = [];

  if (mode === "1") {
    const idx = await ask(`Index akun (1-${count}): `);
    const i = parseInt(idx) - 1;
    if (isNaN(i) || i < 0 || i >= count) return console.error("Index tidak valid.");
    targets = [i];
  } else if (mode === "2") {
    targets = Array.from({ length: count }, (_, i) => i);
  } else if (mode === "3") {
    const from = await ask(`Mulai dari index (1-${count}): `);
    const start = parseInt(from) - 1;
    if (isNaN(start) || start < 0 || start >= count) return console.error("Index tidak valid.");
    targets = Array.from({ length: count - start }, (_, i) => start + i);
    console.log(`Jalanin ${targets.length} akun (index ${start + 1}-${count})`);
  } else {
    return console.error("Pilihan tidak valid.");
  }

  let loginOk = 0, xOk = 0;
  for (let i = 0; i < targets.length; i++) {
    const idx = targets[i];
    const session = await loginWallet(allKeys[idx], idx, total);
    if (!session) continue;
    loginOk++;
    await bindReferral(session.cookie);
    const xResult = await connectX(session, allAkun[idx], idx, total);
    if (xResult) xOk++;
    if (i < targets.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n=== Done: Login ${loginOk}/${targets.length} | X ${xOk}/${targets.length} ===`);
}

main().catch(console.error);
