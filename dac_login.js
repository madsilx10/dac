const { ethers } = require("ethers");
const fs = require("fs");
const readline = require("readline");

// ===== CONFIG =====
const WALLET_FILE = "wallet.txt";
const BASE = "https://interstellar.dachain.io";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
// ==================

function loadWallets() {
  return fs.readFileSync(WALLET_FILE, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

function buildHeaders(cookie = "") {
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
  };
}

function parseCookies(existing = "", setCookieArr = []) {
  const jar = {};
  existing.split(";").forEach((c) => {
    const [k, v] = c.trim().split("=");
    if (k) jar[k.trim()] = v?.trim() ?? "";
  });
  setCookieArr.forEach((c) => {
    const [kv] = c.split(";");
    const [k, v] = kv.split("=");
    if (k) jar[k.trim()] = v?.trim() ?? "";
  });
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function buildSiweMessage(address, nonce) {
  const now = new Date();
  const exp = new Date(now.getTime() + 60 * 60 * 1000);
  return [
    `interstellar.dachain.io wants you to sign in with your Ethereum account:`,
    address,
    "",
    `URI: ${BASE}`,
    `Version: 1`,
    `Chain ID: 1`,
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

async function loginWallet(pk, idx, total) {
  const wallet = new ethers.Wallet(pk);
  const address = ethers.utils.getAddress(await wallet.getAddress());
  console.log(`\n[${idx + 1}/${total}] ${address}`);

  let cookie = "";

  try {
    const { json: nonceJson, setCookie: c1 } = await post(
      `${BASE}/api/v1/auth/siwe/nonce/`,
      { signer: address },
      cookie
    );
    cookie = parseCookies(cookie, c1);

    const nonce = nonceJson?.data?.nonce;
    if (!nonce) throw new Error("Nonce gagal: " + JSON.stringify(nonceJson));
    console.log(`  nonce: ${nonce}`);

    const message = buildSiweMessage(address, nonce);
    const signature = await wallet.signMessage(message);

    const { json: siweJson, setCookie: c2, status } = await post(
      `${BASE}/api/v1/auth/siwe/`,
      { message, signature },
      cookie
    );
    cookie = parseCookies(cookie, c2);

    if (!siweJson?.success) throw new Error(`Status ${status}: ` + JSON.stringify(siweJson));

    const user = siweJson.data?.user;
    console.log(`  ✓ Login OK | id: ${user?.id} | status: ${user?.status}`);

    return { address, cookie, user };

  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    return null;
  }
}

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans.trim()); }));
}

async function main() {
  const allKeys = loadWallets();
  const total = allKeys.length;
  console.log(`Wallet loaded: ${total}`);
  console.log(`\nPilih mode:`);
  console.log(`  1 = 1 akun (pilih index)`);
  console.log(`  2 = semua akun`);
  console.log(`  3 = dari index X sampai akhir`);

  const mode = await ask("\nPilihan (1/2/3): ");

  let keys = [];

  if (mode === "1") {
    const idx = await ask(`Index akun (1-${total}): `);
    const i = parseInt(idx) - 1;
    if (isNaN(i) || i < 0 || i >= total) return console.error("Index tidak valid.");
    keys = [{ pk: allKeys[i], idx: i }];

  } else if (mode === "2") {
    keys = allKeys.map((pk, i) => ({ pk, idx: i }));

  } else if (mode === "3") {
    const from = await ask(`Mulai dari index (1-${total}): `);
    const start = parseInt(from) - 1;
    if (isNaN(start) || start < 0 || start >= total) return console.error("Index tidak valid.");
    keys = allKeys.slice(start).map((pk, i) => ({ pk, idx: start + i }));
    console.log(`Jalanin ${keys.length} akun (index ${start + 1} sampai ${total})`);

  } else {
    return console.error("Pilihan tidak valid.");
  }

  const sessions = [];
  for (let i = 0; i < keys.length; i++) {
    const result = await loginWallet(keys[i].pk, keys[i].idx, total);
    if (result) sessions.push(result);
    if (i < keys.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  fs.writeFileSync("sessions.json", JSON.stringify(sessions, null, 2));
  console.log(`\n=== Done: ${sessions.length}/${keys.length} OK → sessions.json ===`);
}

main().catch(console.error);
