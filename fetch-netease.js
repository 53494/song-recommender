/**
 * fetch-netease.js —— 网易云音乐曲风歌单抓取脚本（可选，配套 song-recommender.html）
 *
 * 为什么需要它：
 *   静态 HTML 受浏览器同源策略限制，且 music.163.com 有反爬（460）/登录态/版权校验，
 *   前端不可能直接"爬"。所以由 Node 侧通过本地 API 服务取数，导出成静态 JS 供页面加载。
 *
 * 准备（一次）：
 *   git clone https://github.com/Binaryify/NeteaseCloudMusicApi.git
 *   cd NeteaseCloudMusicApi && npm install && node app.js      # 默认 http://localhost:3000
 *
 * 运行：
 *   node fetch-netease.js
 *   # 或指定地址：NETEASE_API=http://localhost:4000 node fetch-netease.js
 *
 * 产出：
 *   songs-data.js  →  window.__NETEASE_SONGS__ = [ ...120 首... ]
 *   然后在 song-recommender.html 中取消注释 <script src="songs-data.js"></script> 即可覆盖内置歌单。
 *
 * 注意：
 *   - 依赖第三方非官方接口，稳定性不受保证；仅供个人学习，勿高频请求、勿商用。
 *   - 网易云搜索结果不含可靠的发行年份，本脚本的 y 字段按年代段取代表年份，是近似值。
 *   - 抓取结果只含歌名/歌手，不含音频文件；试听请在页面里跳转网易云。
 */

const fs = require("fs");
const path = require("path");

const BASE = process.env.NETEASE_API || "http://localhost:3000";
const OUT = path.join(__dirname, "songs-data.js");
const PER_GROUP = 10;          // 每个「曲风 × 年代」组合取 10 首
const DELAY_MS = 180;          // 请求间隔，别把接口打挂

const GROUPS = [
  { g: "rnb", e: "1990", y: 1995, kws: ["90年代 R&B 经典", "1990s R&B", "陶喆 R&B"] },
  { g: "rnb", e: "2000", y: 2005, kws: ["2000年代 R&B", "方大同 R&B", "00s R&B"] },
  { g: "rnb", e: "2010", y: 2015, kws: ["2010年代 R&B", "2010s R&B", "华语 R&B 2015"] },

  { g: "jazz", e: "1990", y: 1995, kws: ["90年代 爵士", "Bossa Nova 90s", "Diana Krall"] },
  { g: "jazz", e: "2000", y: 2005, kws: ["Norah Jones 爵士", "2000年代 爵士", "王若琳 爵士"] },
  { g: "jazz", e: "2010", y: 2015, kws: ["2010年代 爵士", "Gregory Porter", "Robert Glasper"] },

  { g: "hiphop", e: "1990", y: 1995, kws: ["90年代 嘻哈 经典", "1990s hip hop", "2Pac Nas"] },
  { g: "hiphop", e: "2000", y: 2005, kws: ["2000年代 嘻哈", "Eminem Kanye 00s", "周杰伦 说唱"] },
  { g: "hiphop", e: "2010", y: 2015, kws: ["2010年代 嘻哈", "Kendrick Lamar", "中文说唱 2018"] },

  { g: "pop", e: "1990", y: 1995, kws: ["90年代 华语流行", "1990s pop", "张学友 王菲"] },
  { g: "pop", e: "2000", y: 2005, kws: ["2000年代 华语流行", "周杰伦 2004", "00s pop hits"] },
  { g: "pop", e: "2010", y: 2015, kws: ["2010年代 华语流行", "2010s pop", "Adele Taylor Swift"] }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasCJK = s => /[\u3400-\u9FFF]/.test(s || "");

async function search(keyword) {
  const url = `${BASE}/search?keywords=${encodeURIComponent(keyword)}&type=1&limit=30`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  const json = await res.json();
  const songs = json && json.result && json.result.songs;
  if (!Array.isArray(songs)) throw new Error(`返回结构异常: ${JSON.stringify(json).slice(0, 160)}`);
  return songs.map(s => ({
    t: s.name || "",
    a: (s.artists || []).map(x => x.name).join(" / ") || (s.alias || []).join("") || ""
  })).filter(s => s.t && s.a);
}

async function main() {
  // 先探活，避免跑一半才发现服务没起
  try {
    const r = await fetch(`${BASE}/search?keywords=test&type=1&limit=1`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (err) {
    console.error(`\n[×] 连不上 ${BASE} —— ${err.message}`);
    console.error("    先启动 NeteaseCloudMusicApi：");
    console.error("    git clone https://github.com/Binaryify/NeteaseCloudMusicApi.git");
    console.error("    cd NeteaseCloudMusicApi && npm install && node app.js\n");
    process.exit(1);
  }

  const all = [];
  const seen = new Set();

  for (const grp of GROUPS) {
    const bucket = [];
    for (const kw of grp.kws) {
      try {
        const list = await search(kw);
        for (const s of list) {
          const key = (s.t + "|" + s.a).toLowerCase();
          if (seen.has(key) || bucket.length >= PER_GROUP) continue;
          seen.add(key);
          bucket.push({
            t: s.t,
            a: s.a,
            g: grp.g,
            e: grp.e,
            y: grp.y,                                  // 年代段代表年份（近似）
            l: hasCJK(s.t) || hasCJK(s.a) ? "zh" : "en"
          });
        }
      } catch (err) {
        console.warn(`[!] 跳过关键词「${kw}」：${err.message}`);
      }
      await sleep(DELAY_MS);
      if (bucket.length >= PER_GROUP) break;
    }
    console.log(`[✓] ${grp.g.padEnd(6)} ${grp.e}  →  ${bucket.length} 首`);
    all.push(...bucket);
  }

  if (all.length === 0) {
    console.error("\n[×] 一首都没抓到，未生成文件。检查服务状态或 Cookie 配置。\n");
    process.exit(1);
  }

  const body = `/* 由 fetch-netease.js 自动生成 · ${new Date().toISOString()} */\n` +
               `/* y 为年代段代表年份（近似值），接口未提供可靠发行年份 */\n` +
               `window.__NETEASE_SONGS__ = ${JSON.stringify(all, null, 2)};\n`;
  fs.writeFileSync(OUT, body, "utf8");
  console.log(`\n[✓] 共 ${all.length} 首 → ${OUT}`);
  console.log("    下一步：在 song-recommender.html 里取消注释 <script src=\"songs-data.js\"></script>\n");
}

main().catch(err => { console.error("[×] 抓取失败：", err); process.exit(1); });
